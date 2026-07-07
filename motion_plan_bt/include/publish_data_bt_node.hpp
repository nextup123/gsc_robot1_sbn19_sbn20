#pragma once

#include <behaviortree_cpp_v3/action_node.h>
#include <rclcpp/rclcpp.hpp>
#include <variant>

#include <std_msgs/msg/string.hpp>
#include <std_msgs/msg/bool.hpp>
#include <std_msgs/msg/int32.hpp>

class PublishDataOnTopic : public BT::SyncActionNode
{
public:
  PublishDataOnTopic(const std::string& name, const BT::NodeConfiguration& config);

  BT::NodeStatus tick() override;
  static BT::PortsList providedPorts();

private:
  rclcpp::Node::SharedPtr ros_node_;

  // Define all possible publishers here
  rclcpp::Publisher<std_msgs::msg::Bool>::SharedPtr bool_pub_;
  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr string_pub_;
  rclcpp::Publisher<std_msgs::msg::Int32>::SharedPtr int32_pub_;

  std::string type_;
  std::string topic_name_;
  bool initialized_ = false;
};
