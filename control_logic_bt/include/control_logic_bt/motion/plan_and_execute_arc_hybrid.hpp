#pragma once

#include <behaviortree_cpp_v3/action_node.h>

#include <rclcpp/rclcpp.hpp>
#include <moveit/move_group_interface/move_group_interface.h>
#include <moveit_msgs/msg/robot_trajectory.hpp>

#include <yaml-cpp/yaml.h>
#include <Eigen/Geometry>

#include <unordered_map>
#include <vector>
#include <string>
#include <memory>

class PlanAndExecuteArcHybrid : public BT::SyncActionNode
{
public:
  PlanAndExecuteArcHybrid(
    const std::string& name,
    const BT::NodeConfiguration& config);

  static BT::PortsList providedPorts();
  BT::NodeStatus tick() override;

private:
  // ===== Core Cartesian planning (UNCHANGED) =====
  bool executeCurvedCartesianMultiJointTargets(
    const std::vector<std::vector<double>>& joints_list,
    moveit::planning_interface::MoveGroupInterface::Plan& plan);

  // ===== Joint-6 oscillation (UNCHANGED) =====
  void applyJoint6Oscillation(
    moveit_msgs::msg::RobotTrajectory& traj,
    double cw_deg,
    double ccw_deg,
    double freq_hz);

  // ===== TOTG-based retiming (STATE-INDEPENDENT) =====
  bool retimeTrajectory(
    moveit_msgs::msg::RobotTrajectory& traj,
    double speed_factor);

  // ===== YAML loader (UNCHANGED) =====
  bool loadJointTargetsFromYaml(const std::string& path);

private:
  rclcpp::Node::SharedPtr node_;
  std::shared_ptr<
    moveit::planning_interface::MoveGroupInterface> move_group_;

  std::unordered_map<std::string, std::vector<double>> joint_targets_;
};