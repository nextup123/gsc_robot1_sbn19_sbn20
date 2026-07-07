#pragma once

#include <behaviortree_cpp_v3/condition_node.h>
#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/bool.hpp>
#include <atomic>
#include <string>

class CheckBoolTopic : public BT::ConditionNode
{
public:
    CheckBoolTopic(const std::string& name, const BT::NodeConfiguration& config);

    static BT::PortsList providedPorts();

    BT::NodeStatus tick() override;

private:
    // node_ grabbed lazily on first tick, NOT in constructor
    rclcpp::Node::SharedPtr node_;
    rclcpp::Subscription<std_msgs::msg::Bool>::SharedPtr sub_;

    std::string last_topic_;

    std::atomic<bool> latest_value_{false};
    std::atomic<bool> has_message_{false};
};