#pragma once

#include <behaviortree_cpp_v3/control_node.h>
#include <std_msgs/msg/bool.hpp>
#include <rclcpp/rclcpp.hpp>
#include <atomic>

/// Utility class for pause control (topic-based)
class PauseControlUtil
{
public:
  static void set_node(rclcpp::Node::SharedPtr node);
  static void callback(const std_msgs::msg::Bool::SharedPtr msg);
  static void wait_if_paused();
  static bool is_paused();

private:
  static rclcpp::Node::SharedPtr node_;
  static rclcpp::Subscription<std_msgs::msg::Bool>::SharedPtr sub_;
  static std::atomic<bool> paused_;
};

/// BT Control Node that uses PauseControlUtil before ticking children
class PauseControlNode : public BT::ControlNode
{
public:
  PauseControlNode(const std::string& name, const BT::NodeConfiguration& config);
  static BT::PortsList providedPorts();
  BT::NodeStatus tick() override;
};
