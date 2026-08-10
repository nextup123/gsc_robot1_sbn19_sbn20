#include "control_logic_bt/action/gpio/bt_gpio_do_control.hpp"
#include <rclcpp/rclcpp.hpp>
#include <thread>
#include <chrono>

namespace bt_control
{

// ---------------------------------------------------------------------------
// Static member definitions (exist exactly once for the whole process).
// All GpioDoControl instances share ONE publisher on the single shared
// commands topic, so N uses of this node in the tree no longer create N
// publishers.
// ---------------------------------------------------------------------------
rclcpp::Publisher<control_msgs::msg::DynamicInterfaceGroupValues>::SharedPtr GpioDoControl::publisher_ = nullptr;
std::mutex GpioDoControl::publisher_mutex_;

GpioDoControl::GpioDoControl(const std::string& name,
                             const BT::NodeConfiguration& config,
                             const rclcpp::Node::SharedPtr& node)
    : BT::AsyncActionNode(name, config), node_(node)
{
    RCLCPP_INFO(node_->get_logger(),
                "Initializing Async GpioDoControl BT node '%s'...", name.c_str());

    // Create the shared publisher only on the first instance. Subsequent
    // instances reuse it.
    std::lock_guard<std::mutex> lock(publisher_mutex_);
    if (!publisher_) {
        publisher_ = node_->create_publisher<control_msgs::msg::DynamicInterfaceGroupValues>(
            "/nextup_gpio_command_controller/commands", 10);
        RCLCPP_INFO(node_->get_logger(),
                    "GpioDoControl: created shared publisher on "
                    "/nextup_gpio_command_controller/commands");
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

void GpioDoControl::publish_value(const std::string& gpio_id, const std::string& do_id,
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
        publisher_->publish(msg);
    }

    RCLCPP_INFO(node_->get_logger(),
        "Published do%s = %s | control='%s' | gpio=%s",
        do_id.c_str(), value ? "true" : "false",
        control_name.c_str(), gpio_id.c_str());
}

BT::NodeStatus GpioDoControl::tick()
{
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

    bool expected_action;
    if (!getInput("expected_action", expected_action)) {
        RCLCPP_ERROR(node_->get_logger(), "Missing 'expected_action'");
        return BT::NodeStatus::FAILURE;
    }

    int push_wait = 250;
    if (type_of_control == "push" && !getInput("push_wait", push_wait)) {
        RCLCPP_WARN(node_->get_logger(), "No 'push_wait', using 250ms");
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

    // Execute (this runs in a separate thread, so blocking sleep is OK)
    if (type_of_control == "switch") {
        publish_value(gpio_id, do_id, expected_action, control_name);
        return BT::NodeStatus::SUCCESS;
    }
    else  // push
    {
        publish_value(gpio_id, do_id, true, control_name);
        // Blocking sleep inside the async thread – does NOT block the tree
        std::this_thread::sleep_for(std::chrono::milliseconds(push_wait));
        publish_value(gpio_id, do_id, false, control_name);
        return BT::NodeStatus::SUCCESS;
    }
}

}  // namespace bt_control