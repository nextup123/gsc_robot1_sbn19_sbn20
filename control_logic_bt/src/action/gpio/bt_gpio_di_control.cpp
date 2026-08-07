#include "control_logic_bt/action/gpio/bt_gpio_di_control.hpp"

#include <rclcpp/rclcpp.hpp>

namespace bt_control
{

GpioDiControl::GpioDiControl(
    const std::string& name,
    const BT::NodeConfiguration& config,
    const rclcpp::Node::SharedPtr& node)
    : BT::StatefulActionNode(name, config),
      node_(node),
      first_tick_(true),
      last_progress_log_ms_(0.0)
{
    RCLCPP_INFO(node_->get_logger(),
                "Initializing GpioDiControl node '%s'...", name.c_str());

    subscription_ =
        node_->create_subscription<control_msgs::msg::DynamicInterfaceGroupValues>(
            "/nextup_gpio_command_controller/gpio_states", 10,
            std::bind(&GpioDiControl::gpioStateCallback, this, std::placeholders::_1));
}

BT::PortsList GpioDiControl::providedPorts()
{
    return {
        BT::InputPort<std::string>("gpio_id"),
        BT::InputPort<std::string>("di_id"),
        BT::InputPort<std::string>("status_name"),
        BT::InputPort<bool>("expected_status"),
        BT::InputPort<int>("wait_time")
    };
}

// -------------------------
// Callback
// -------------------------
void GpioDiControl::gpioStateCallback(
    const control_msgs::msg::DynamicInterfaceGroupValues::SharedPtr msg)
{
    std::lock_guard<std::mutex> lock(state_mutex_);

    size_t count = std::min(msg->interface_groups.size(), msg->interface_values.size());
    for (size_t i = 0; i < count; ++i)
    {
        const auto& group_name = msg->interface_groups[i];
        const auto& iv = msg->interface_values[i];

        auto& group_map = gpio_states_[group_name];
        size_t n = std::min(iv.interface_names.size(), iv.values.size());
        for (size_t j = 0; j < n; ++j)
        {
            group_map[iv.interface_names[j]] = iv.values[j];
        }
    }
}

bool GpioDiControl::readCurrentState(bool& out_state) const
{
    std::lock_guard<std::mutex> lock(state_mutex_);

    auto group_it = gpio_states_.find(gpio_id_);
    if (group_it == gpio_states_.end())
        return false;

    auto value_it = group_it->second.find("di" + di_id_);
    if (value_it == group_it->second.end())
        return false;

    out_state = value_it->second != 0.0;
    return true;
}

// -------------------------
// onStart
// -------------------------
BT::NodeStatus GpioDiControl::onStart()
{
    std::string gpio_id;
    std::string di_id;
    int wait_time = 200;  // default
    bool expected_status = false;
    std::string status_name;

    if (!getInput("gpio_id", gpio_id) ||
        !getInput("di_id", di_id) ||
        !getInput("status_name", status_name) ||
        !getInput("expected_status", expected_status))
    {
        RCLCPP_ERROR(node_->get_logger(),
                     "Missing required input for node '%s'",
                     name().c_str());
        return BT::NodeStatus::FAILURE;
    }

    getInput("wait_time", wait_time);

    if (gpio_id.empty() || di_id.empty() || wait_time < 0)
    {
        RCLCPP_ERROR(node_->get_logger(),
                     "Invalid inputs in '%s': gpio_id='%s', di_id='%s', wait_time=%d",
                     name().c_str(), gpio_id.c_str(), di_id.c_str(), wait_time);
        return BT::NodeStatus::FAILURE;
    }

    // Cache values
    gpio_id_ = gpio_id;
    di_id_ = di_id;
    expected_status_ = expected_status;
    status_name_ = status_name;
    wait_time_ = wait_time;

    start_time_ = node_->now();
    first_tick_ = true;
    last_progress_log_ms_ = 0.0;

    return BT::NodeStatus::RUNNING;
}

// -------------------------
// onRunning
// -------------------------
BT::NodeStatus GpioDiControl::onRunning()
{
    bool current_state = false;
    bool have_state = readCurrentState(current_state);

    if (!have_state)
    {
        RCLCPP_WARN(node_->get_logger(),
                    "%s → no data yet for gpio_id='%s' di%s, waiting...",
                    name().c_str(), gpio_id_.c_str(), di_id_.c_str());
    }

    double elapsed_ms = (node_->now() - start_time_).seconds() * 1000.0;

    // First tick: Always log start and initial condition
    if (first_tick_)
    {
        RCLCPP_INFO(node_->get_logger(),
                    "%s check started → %s (di%s on gpio '%s', expected=%d)",
                    name().c_str(), status_name_.c_str(), di_id_.c_str(),
                    gpio_id_.c_str(), expected_status_);

        if (have_state && current_state == expected_status_)
        {
            RCLCPP_INFO(node_->get_logger(),
                        "%s → CONDITION ALREADY MET (di%s=%d), succeeded in %.1f ms",
                        name().c_str(), di_id_.c_str(), current_state, elapsed_ms);
        }
        else
        {
            RCLCPP_WARN(node_->get_logger(),
                        "%s → CONDITION NOT MET yet (di%s=%d), waiting up to %d ms...",
                        name().c_str(), di_id_.c_str(), current_state, wait_time_);
        }
        first_tick_ = false;
    }

    // Timeout
    if (elapsed_ms >= wait_time_)
    {
        if (have_state && current_state == expected_status_)
        {
            RCLCPP_INFO(node_->get_logger(),
                        "%s → CONDITION MET after %.1f ms → SUCCESS",
                        name().c_str(), elapsed_ms);
            return BT::NodeStatus::SUCCESS;
        }
        else
        {
            RCLCPP_ERROR(node_->get_logger(),
                         "%s → TIMEOUT: di%s=%d (expected=%d) after %d ms → FAILURE",
                         name().c_str(), di_id_.c_str(), current_state, expected_status_, wait_time_);
            return BT::NodeStatus::FAILURE;
        }
    }

    // Periodic progress log while waiting (every 1 second)
    if (!have_state || current_state != expected_status_)
    {
        if (elapsed_ms - last_progress_log_ms_ >= 1000.0)
        {
            RCLCPP_INFO(node_->get_logger(),
                        "%s → still waiting: di%s=%d (expected=%d), elapsed=%.1f ms",
                        name().c_str(), di_id_.c_str(), current_state, expected_status_, elapsed_ms);
            last_progress_log_ms_ = elapsed_ms;
        }
    }
    // Condition met during waiting
    else if (!first_tick_)
    {
        RCLCPP_INFO(node_->get_logger(),
                    "%s → CONDITION MET after %.1f ms → SUCCESS",
                    name().c_str(), elapsed_ms);
        return BT::NodeStatus::SUCCESS;
    }

    return BT::NodeStatus::RUNNING;
}

// -------------------------
// onHalted
// -------------------------
void GpioDiControl::onHalted()
{
    RCLCPP_INFO(node_->get_logger(),
                "GpioDiControl node '%s' halted", name().c_str());
}

}  // namespace bt_control
