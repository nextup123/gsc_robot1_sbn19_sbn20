#include "control_logic_bt/action/runway_protection_node.hpp"

RunwayProtection::RunwayProtection(const std::string& name, const BT::NodeConfiguration& config)
    : BT::SyncActionNode(name, config)
{
  ros_node_ = rclcpp::Node::make_shared("runway_protection_bt_node_" + name);
  safety_pub_ = ros_node_->create_publisher<nextup_joint_interfaces::msg::NextupSafetyCommand>(
      "/nextup_safety_controller/commands", 10);
}

BT::PortsList RunwayProtection::providedPorts()
{
  return {
      BT::InputPort<bool>("active"),
      BT::InputPort<double>("j1_torque"),
      BT::InputPort<double>("j2_torque"),
      BT::InputPort<double>("j3_torque"),
      BT::InputPort<double>("j4_torque"),
      BT::InputPort<double>("j5_torque"),
      BT::InputPort<double>("j6_torque")
  };
}

BT::NodeStatus RunwayProtection::tick()
{
  bool active;
  if (!getInput("active", active)) {
    RCLCPP_ERROR(ros_node_->get_logger(), "Missing 'active' input");
    return BT::NodeStatus::FAILURE;
  }

  double j1, j2, j3, j4, j5, j6;
  if (!getInput("j1_torque", j1) || !getInput("j2_torque", j2) ||
      !getInput("j3_torque", j3) || !getInput("j4_torque", j4) ||
      !getInput("j5_torque", j5) || !getInput("j6_torque", j6)) {
    RCLCPP_ERROR(ros_node_->get_logger(), "Missing one or more joint torque inputs (j1_torque..j6_torque)");
    return BT::NodeStatus::FAILURE;
  }

  nextup_joint_interfaces::msg::NextupSafetyCommand msg;
  msg.header.stamp = ros_node_->get_clock()->now();
  msg.header.frame_id = "";
  msg.runway_protection = active;
  msg.max_torque = {j1, j2, j3, j4, j5, j6};

  safety_pub_->publish(msg);

  RCLCPP_INFO(ros_node_->get_logger(),
      "Published RunwayProtection: active=%s torque=[%.1f, %.1f, %.1f, %.1f, %.1f, %.1f]",
      active ? "true" : "false", j1, j2, j3, j4, j5, j6);

  return BT::NodeStatus::SUCCESS;
}
