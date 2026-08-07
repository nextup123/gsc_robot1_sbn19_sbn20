#pragma once

#include <behaviortree_cpp_v3/action_node.h>
#include <rclcpp/rclcpp.hpp>

#include <nextup_joint_interfaces/msg/nextup_safety_command.hpp>

class RunwayProtection : public BT::SyncActionNode
{
public:
  RunwayProtection(const std::string& name, const BT::NodeConfiguration& config);

  BT::NodeStatus tick() override;
  static BT::PortsList providedPorts();

private:
  rclcpp::Node::SharedPtr ros_node_;
  rclcpp::Publisher<nextup_joint_interfaces::msg::NextupSafetyCommand>::SharedPtr safety_pub_;
};
