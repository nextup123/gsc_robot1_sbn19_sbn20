#pragma once

#include <behaviortree_cpp_v3/action_node.h>

#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/string.hpp>

class SubscribeToBlackboard : public BT::StatefulActionNode
{
public:
    SubscribeToBlackboard(const std::string& name,
                          const BT::NodeConfiguration& config);

    static BT::PortsList providedPorts();

    BT::NodeStatus onStart() override;

    BT::NodeStatus onRunning() override;

    void onHalted() override;

private:
    rclcpp::Node::SharedPtr node_;

    rclcpp::Subscription<std_msgs::msg::String>::SharedPtr sub_;

    std::string topic_;
    std::string key_;

    bool message_received_;

    std::string latest_msg_;
};