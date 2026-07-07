/**
 * @file popup_msg_node.hpp
 * @author Adnan Alvi
 * @brief Behavior Tree node to publish a popup message with type and timeout.
 * @version 1.0
 * @date 2025-09-19
 * @company Nextup Robotics Private Limited
 * @designation Robotics Software Engineer
 */

#pragma once

#include <behaviortree_cpp_v3/action_node.h>
#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/string.hpp>

namespace bt_popup
{

class PopupMsgNode : public BT::SyncActionNode
{
public:

    PopupMsgNode(
        const std::string& name,
        const BT::NodeConfiguration& config);

    static BT::PortsList providedPorts();


    BT::NodeStatus tick() override;

private:
    rclcpp::Node::SharedPtr node_;

    rclcpp::Publisher<std_msgs::msg::String>::SharedPtr popup_publisher_;

    rclcpp::Publisher<std_msgs::msg::String>::SharedPtr status_publisher_;

    void publishStatus(const std::string& status);
};

} // namespace bt_popup