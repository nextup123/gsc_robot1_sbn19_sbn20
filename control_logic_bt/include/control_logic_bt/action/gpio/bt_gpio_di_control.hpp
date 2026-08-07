#pragma once

#include "behaviortree_cpp_v3/action_node.h"
#include <rclcpp/rclcpp.hpp>
#include <control_msgs/msg/dynamic_interface_group_values.hpp>
#include <mutex>
#include <string>
#include <unordered_map>

namespace bt_control
{

/**
 * @brief Stateful action node that polls a digital input on a GPIO device.
 *
 * Subscribes once (in the constructor) to
 * /nextup_gpio_command_controller/gpio_states, which reports every GPIO
 * device's interfaces in one DynamicInterfaceGroupValues message
 * (interface_groups[i] <-> interface_values[i]). The latest values are
 * cached per gpio_id/interface_name so onRunning() can look up
 * gpio_id_ + "di" + di_id_ without re-parsing the whole message each tick.
 */
class GpioDiControl : public BT::StatefulActionNode
{
public:
    GpioDiControl(const std::string& name,
                  const BT::NodeConfiguration& config,
                  const rclcpp::Node::SharedPtr& node);

    static BT::PortsList providedPorts();

    BT::NodeStatus onStart() override;
    BT::NodeStatus onRunning() override;
    void onHalted() override;

private:
    void gpioStateCallback(
        const control_msgs::msg::DynamicInterfaceGroupValues::SharedPtr msg);

    bool readCurrentState(bool& out_state) const;

    rclcpp::Node::SharedPtr node_;
    rclcpp::Subscription<control_msgs::msg::DynamicInterfaceGroupValues>::SharedPtr subscription_;

    mutable std::mutex state_mutex_;
    // gpio_id -> (interface_name -> value)
    std::unordered_map<std::string, std::unordered_map<std::string, double>> gpio_states_;

    // Cached tick inputs
    std::string gpio_id_;
    std::string di_id_;
    std::string status_name_;
    bool expected_status_{false};
    int wait_time_{200};

    bool first_tick_;
    double last_progress_log_ms_;
    rclcpp::Time start_time_;
};

}  // namespace bt_control
