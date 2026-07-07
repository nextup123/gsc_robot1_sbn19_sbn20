#pragma once

#include "behaviortree_cpp_v3/control_node.h"
#include "rclcpp/rclcpp.hpp"
#include "std_msgs/msg/bool.hpp"
#include <atomic>

class StartControlNode : public BT::ControlNode
{
public:
    StartControlNode(const std::string& name, const BT::NodeConfiguration& config, rclcpp::Node::SharedPtr node);
    ~StartControlNode() override = default;

    static BT::PortsList providedPorts();

    BT::NodeStatus tick() override;
    void halt() override;

private:
    void startCallback(const std_msgs::msg::Bool::SharedPtr msg);
    void resetCallback(const std_msgs::msg::Bool::SharedPtr msg);

    rclcpp::Node::SharedPtr node_;
    rclcpp::Subscription<std_msgs::msg::Bool>::SharedPtr start_subscription_;
    rclcpp::Subscription<std_msgs::msg::Bool>::SharedPtr reset_subscription_;
    rclcpp::Publisher<std_msgs::msg::Bool>::SharedPtr start_active_publisher_;

    std::atomic_bool start_triggered_;
    std::atomic_bool reset_requested_;
};