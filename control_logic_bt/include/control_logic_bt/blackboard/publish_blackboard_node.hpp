#pragma once

#include <behaviortree_cpp_v3/action_node.h>

#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/string.hpp>

class PublishBlackboard : public BT::SyncActionNode
{
public:
    PublishBlackboard(const std::string& name,
                      const BT::NodeConfiguration& config);

    static BT::PortsList providedPorts();

    BT::NodeStatus tick() override;

private:
    rclcpp::Node::SharedPtr node_;

    rclcpp::Publisher<std_msgs::msg::String>::SharedPtr pub_;
};