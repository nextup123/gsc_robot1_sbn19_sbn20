#pragma once

#include <behaviortree_cpp_v3/action_node.h>
#include <moveit/move_group_interface/move_group_interface.h>
#include <moveit/robot_trajectory/robot_trajectory.h>
#include <moveit/trajectory_processing/time_optimal_trajectory_generation.h>
#include <geometry_msgs/msg/pose.hpp>
#include <rclcpp/rclcpp.hpp>
#include <tf2_eigen/tf2_eigen.hpp>
#include <yaml-cpp/yaml.h>
#include <unordered_map>
#include <future>
#include <atomic>
#include <thread>

class PlanAndExecutePoseHybrid : public BT::StatefulActionNode
{
public:
  PlanAndExecutePoseHybrid(const std::string& name, const BT::NodeConfiguration& config);
  ~PlanAndExecutePoseHybrid() override;

  static BT::PortsList providedPorts();

  // StatefulActionNode interface
  BT::NodeStatus onStart() override;
  BT::NodeStatus onRunning() override;
  void onHalted() override;

private:
  enum class State
  {
    IDLE,
    PLANNING_JOINT,
    PLANNING_CARTESIAN,
    EXECUTING
  };

  void loadJointTargetsFromYaml(const std::string& filepath);

  bool planJointSpace(const std::vector<double>& joint_values,
                      double speed_factor, double accel_factor);
  bool planCartesianSpace(const std::vector<double>& joint_values,
                          double eef_step, double speed_factor, double accel_factor);
  bool executePlan();
  void reset();

  rclcpp::Node::SharedPtr node_;
  std::shared_ptr<moveit::planning_interface::MoveGroupInterface> move_group_;

  // Background executor that spins node_ so the CurrentStateMonitor receives
  // /joint_states. Without this, getCurrentState() always times out.
  rclcpp::executors::SingleThreadedExecutor::SharedPtr executor_;
  std::thread spin_thread_;

  std::unordered_map<std::string, std::vector<double>> joint_targets_;

  // State tracking
  State current_state_ = State::IDLE;
  std::string current_target_name_;
  bool use_cartesian_ = false;
  double speed_factor_ = 1.0;
  double accel_factor_ = 1.0;   // NEW: acceleration scaling factor
  std::vector<double> current_joint_values_;

  // Halt handling: when true, onHalted() lets the current motion finish
  // instead of aborting it mid-path.
  std::atomic<bool> halt_requested_{false};

  // Async operation futures
  std::shared_future<bool> planning_future_;
  std::shared_future<bool> execution_future_;

  // Stored plan
  moveit::planning_interface::MoveGroupInterface::Plan stored_plan_;

  double eef_step_ = 0.05;   // 5 cm — coarser waypoints, smoother motion
};