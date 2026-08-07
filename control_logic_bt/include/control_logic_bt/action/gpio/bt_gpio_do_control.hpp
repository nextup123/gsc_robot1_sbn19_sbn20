#pragma once

#include "behaviortree_cpp_v3/action_node.h"
#include <rclcpp/rclcpp.hpp>
#include <control_msgs/msg/dynamic_interface_group_values.hpp>
#include <mutex>
#include <string>

namespace bt_control
{

/**
 * @brief Async action node that drives a digital output on a GPIO device
 *        via the /nextup_gpio_command_controller/commands topic.
 *
 * Unlike the driver-based DoControl node (one publisher per driver_id, one
 * fixed topic per driver), GPIO devices all share a single command topic and
 * are disambiguated by gpio_id + do_id inside the message payload, so a
 * single publisher is created once in the constructor.
 */
class GpioDoControl : public BT::AsyncActionNode
{
public:
    GpioDoControl(const std::string& name,
                  const BT::NodeConfiguration& config,
                  const rclcpp::Node::SharedPtr& node);

    static BT::PortsList providedPorts();

    BT::NodeStatus tick() override;

private:
    void publish_value(const std::string& gpio_id, const std::string& do_id,
                        bool value, const std::string& control_name);

    rclcpp::Node::SharedPtr node_;
    rclcpp::Publisher<control_msgs::msg::DynamicInterfaceGroupValues>::SharedPtr publisher_;
    std::mutex publisher_mutex_;
};

}  // namespace bt_control
