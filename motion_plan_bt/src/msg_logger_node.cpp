#include "msg_logger_node.hpp"
#include <iostream>

// Initialize static members
rclcpp::Node::SharedPtr MsgLoggerNode::node_ = nullptr;
rclcpp::Publisher<std_msgs::msg::String>::SharedPtr MsgLoggerNode::publisher_ = nullptr;
std::once_flag MsgLoggerNode::init_flag_;

MsgLoggerNode::MsgLoggerNode(const std::string &name, const BT::NodeConfiguration &config)
: BT::SyncActionNode(name, config)
{
  std::call_once(init_flag_, []() {
    node_ = rclcpp::Node::make_shared("msg_logger_node");

    publisher_ = node_->create_publisher<std_msgs::msg::String>(
      "/planning_logs", 10);
  });
}

BT::PortsList MsgLoggerNode::providedPorts()
{
  return {
    BT::InputPort<std::string>("msg_log")
  };
}

BT::NodeStatus MsgLoggerNode::tick()
{
  std::string msg;
  if (!getInput<std::string>("msg_log", msg)) {
    throw BT::RuntimeError("Missing required input [msg_log]");
  }

  // Print to terminal
  std::cout << "[MsgLoggerNode]: " << msg << std::endl;

  // Publish to ROS topic
  rclcpp::spin_some(node_);

  std_msgs::msg::String ros_msg;
  ros_msg.data = msg;
  publisher_->publish(ros_msg);

  return BT::NodeStatus::SUCCESS;
}
