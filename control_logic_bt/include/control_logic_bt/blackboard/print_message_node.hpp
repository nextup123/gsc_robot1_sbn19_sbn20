#pragma once
#include <behaviortree_cpp_v3/action_node.h>
#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/string.hpp>

class PrintMessage : public BT::SyncActionNode
{
public:
    PrintMessage(const std::string& name, const BT::NodeConfiguration& config);
    static BT::PortsList providedPorts();
    BT::NodeStatus tick() override;

    static void set_node(rclcpp::Node::SharedPtr node);  // ← add this

private:
    static rclcpp::Node::SharedPtr s_node_;              // ← static
    rclcpp::Publisher<std_msgs::msg::String>::SharedPtr publisher_;
};