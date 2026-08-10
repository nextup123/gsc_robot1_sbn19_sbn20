#include "control_logic_bt/action/gpio/bt_gpio_do_control.hpp"
#include <rclcpp/rclcpp.hpp>
#include <algorithm>
#include <chrono>
#include <thread>

namespace bt_control
{

// ---------------------------------------------------------------------------
// Static member definitions (exist exactly once for the whole process).
// All GpioDoControl instances share ONE publisher on the single shared
// commands topic. The publisher is reference-counted so it is torn down with
// the last instance rather than leaking / dangling across tree rebuilds.
// ---------------------------------------------------------------------------
rclcpp::Publisher<control_msgs::msg::DynamicInterfaceGroupValues>::SharedPtr
    GpioDoControl::publisher_ = nullptr;
std::mutex GpioDoControl::publisher_mutex_;
std::size_t GpioDoControl::instance_count_ = 0;

namespace
{
// Bounds for the push pulse width, in milliseconds. Values outside this range
// almost certainly indicate a misconfiguration; clamp rather than sleep for an
// absurd duration or (for negatives) skip the pulse entirely.
constexpr int kMinPushWaitMs = 1;
constexpr int kMaxPushWaitMs = 60'000;  // 60 s
constexpr int kDefaultPushWaitMs = 250;
}  // namespace

GpioDoControl::GpioDoControl(const std::string& name,
                             const BT::NodeConfiguration& config,
                             const rclcpp::Node::SharedPtr& node)
    : BT::AsyncActionNode(name, config), node_(node)
{
    if (!node_) {
        throw BT::RuntimeError(
            "GpioDoControl '" + name + "': null rclcpp::Node passed to constructor");
    }

    RCLCPP_INFO(node_->get_logger(),
                "Initializing Async GpioDoControl BT node '%s'...", name.c_str());

    // Create the shared publisher only on the first instance; subsequent
    // instances reuse it. instance_count_ tracks how many instances are alive
    // so the publisher can be destroyed with the last one.
    std::lock_guard<std::mutex> lock(publisher_mutex_);
    if (instance_count_ == 0 || !publisher_) {
        publisher_ = node_->create_publisher<control_msgs::msg::DynamicInterfaceGroupValues>(
            "/nextup_gpio_command_controller/commands", 10);
        RCLCPP_INFO(node_->get_logger(),
                    "GpioDoControl: created shared publisher on "
                    "/nextup_gpio_command_controller/commands");
    }
    ++instance_count_;
}

GpioDoControl::~GpioDoControl()
{
    std::lock_guard<std::mutex> lock(publisher_mutex_);
    if (instance_count_ > 0) {
        --instance_count_;
    }
    // When the last instance goes away, drop the publisher so it is not left
    // bound to a node that may itself be destroyed on a tree rebuild.
    if (instance_count_ == 0) {
        publisher_.reset();
    }
}

BT::PortsList GpioDoControl::providedPorts()
{
    return {
        BT::InputPort<std::string>("gpio_id"),
        BT::InputPort<std::string>("do_id"),
        BT::InputPort<std::string>("control_name"),
        BT::InputPort<std::string>("type_of_control"),
        BT::InputPort<bool>("expected_action"),
        BT::InputPort<int>("push_wait")
    };
}

void GpioDoControl::halt()
{
    halt_requested_.store(true);
    // Let the base class do its bookkeeping (marks the node as halted and
    // waits for the async thread to finish).
    BT::AsyncActionNode::halt();
}

bool GpioDoControl::publish_value(const std::string& gpio_id, const std::string& do_id,
                                  bool value, const std::string& control_name)
{
    control_msgs::msg::DynamicInterfaceGroupValues msg;
    msg.interface_groups = {gpio_id};

    control_msgs::msg::InterfaceValue iv;
    iv.interface_names = {"do" + do_id};
    iv.values = {value ? 1.0 : 0.0};
    msg.interface_values = {iv};

    {
        std::lock_guard<std::mutex> lock(publisher_mutex_);
        if (!publisher_) {
            RCLCPP_ERROR(node_->get_logger(),
                "GpioDoControl: shared publisher is null, cannot publish "
                "do%s (control='%s', gpio=%s)",
                do_id.c_str(), control_name.c_str(), gpio_id.c_str());
            return false;
        }
        publisher_->publish(msg);
    }

    RCLCPP_INFO(node_->get_logger(),
        "Published do%s = %s | control='%s' | gpio=%s",
        do_id.c_str(), value ? "true" : "false",
        control_name.c_str(), gpio_id.c_str());
    return true;
}

BT::NodeStatus GpioDoControl::tick()
{
    // Fresh tick: clear any stale halt flag from a previous run.
    halt_requested_.store(false);

    // Read inputs (in the async thread)
    std::string gpio_id;
    if (!getInput("gpio_id", gpio_id)) {
        RCLCPP_ERROR(node_->get_logger(), "Missing 'gpio_id'");
        return BT::NodeStatus::FAILURE;
    }

    std::string do_id;
    if (!getInput("do_id", do_id)) {
        RCLCPP_ERROR(node_->get_logger(), "Missing 'do_id'");
        return BT::NodeStatus::FAILURE;
    }

    std::string control_name;
    if (!getInput("control_name", control_name)) {
        RCLCPP_ERROR(node_->get_logger(), "Missing 'control_name'");
        return BT::NodeStatus::FAILURE;
    }

    std::string type_of_control;
    if (!getInput("type_of_control", type_of_control)) {
        RCLCPP_ERROR(node_->get_logger(), "Missing 'type_of_control'");
        return BT::NodeStatus::FAILURE;
    }

    bool expected_action = false;
    if (!getInput("expected_action", expected_action)) {
        RCLCPP_ERROR(node_->get_logger(), "Missing 'expected_action'");
        return BT::NodeStatus::FAILURE;
    }

    int push_wait = kDefaultPushWaitMs;
    if (type_of_control == "push" && !getInput("push_wait", push_wait)) {
        RCLCPP_WARN(node_->get_logger(), "No 'push_wait', using %d ms", kDefaultPushWaitMs);
        push_wait = kDefaultPushWaitMs;
    }

    // Validation
    if (gpio_id.empty()) {
        RCLCPP_ERROR(node_->get_logger(), "Invalid gpio_id (empty)");
        return BT::NodeStatus::FAILURE;
    }
    if (type_of_control != "push" && type_of_control != "switch") {
        RCLCPP_ERROR(node_->get_logger(), "Invalid type_of_control '%s'", type_of_control.c_str());
        return BT::NodeStatus::FAILURE;
    }
    if (do_id.empty()) {
        RCLCPP_ERROR(node_->get_logger(), "Invalid do_id (empty)");
        return BT::NodeStatus::FAILURE;
    }

    // Clamp the pulse width into a sane range so a bad config can't sleep
    // forever or skip the pulse.
    if (type_of_control == "push") {
        int clamped = std::clamp(push_wait, kMinPushWaitMs, kMaxPushWaitMs);
        if (clamped != push_wait) {
            RCLCPP_WARN(node_->get_logger(),
                        "push_wait=%d out of range [%d, %d], clamped to %d ms",
                        push_wait, kMinPushWaitMs, kMaxPushWaitMs, clamped);
            push_wait = clamped;
        }
    }

    // Bail out early if a halt landed while we were reading inputs.
    if (halt_requested_.load()) {
        RCLCPP_WARN(node_->get_logger(), "Halted before publishing, aborting tick");
        return BT::NodeStatus::FAILURE;
    }

    // Execute (this runs in a separate thread, so blocking sleep is OK)
    if (type_of_control == "switch") {
        if (!publish_value(gpio_id, do_id, expected_action, control_name)) {
            return BT::NodeStatus::FAILURE;
        }
        return BT::NodeStatus::SUCCESS;
    }
    else  // push
    {
        if (!publish_value(gpio_id, do_id, true, control_name)) {
            return BT::NodeStatus::FAILURE;
        }

        // Interruptible sleep: wake up promptly on halt instead of holding the
        // output asserted for the full pulse width. Poll in small slices.
        constexpr auto kSlice = std::chrono::milliseconds(10);
        auto remaining = std::chrono::milliseconds(push_wait);
        while (remaining.count() > 0 && !halt_requested_.load()) {
            auto step = std::min(kSlice, remaining);
            std::this_thread::sleep_for(step);
            remaining -= step;
        }

        // Always de-assert, even on halt, so we never leave the output stuck
        // high. (If leaving it high on halt is the desired behaviour instead,
        // guard this on !halt_requested_.)
        bool ok = publish_value(gpio_id, do_id, false, control_name);

        if (halt_requested_.load()) {
            RCLCPP_WARN(node_->get_logger(),
                        "Push interrupted by halt; output de-asserted");
            return BT::NodeStatus::FAILURE;
        }
        return ok ? BT::NodeStatus::SUCCESS : BT::NodeStatus::FAILURE;
    }
}

}  // namespace bt_control