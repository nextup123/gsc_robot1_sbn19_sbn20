#ifndef CONTROL_LOGIC_BT__MOTION__PLAN_AND_EXECUTE_NODE_HPP_
#define CONTROL_LOGIC_BT__MOTION__PLAN_AND_EXECUTE_NODE_HPP_

#include <atomic>
#include <chrono>
#include <cmath>
#include <future>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include <behaviortree_cpp_v3/action_node.h>

#include <rclcpp/rclcpp.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <geometry_msgs/msg/pose.hpp>
#include <moveit_msgs/msg/robot_trajectory.hpp>

#include <moveit/move_group_interface/move_group_interface.h>
#include <moveit/robot_state/robot_state.h>
#include <moveit/robot_trajectory/robot_trajectory.h>
#include <moveit/trajectory_processing/time_optimal_trajectory_generation.h>

#include <yaml-cpp/yaml.h>

class PlanAndExecutePoseHybrid : public BT::StatefulActionNode
{
public:
  PlanAndExecutePoseHybrid(const std::string& name, const BT::NodeConfiguration& config);
  ~PlanAndExecutePoseHybrid() override;

  static BT::PortsList providedPorts();

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

  // ---- core helpers ----
  void reset();
  double trajectoryDuration() const;
  void abandonInFlight();

  bool planJointSpace(const std::vector<double>& joint_values,
                      double speed_factor, double accel_factor);
  bool planCartesianSpace(const std::vector<double>& joint_values,
                          double eef_step, double speed_factor, double accel_factor);
  bool executePlan();

  void loadJointTargetsFromYaml(const std::string& filepath);

  // ---- stall detection (the only execution watchdog) ----
  void jointStateCallback(const sensor_msgs::msg::JointState::SharedPtr msg);
  bool armIsMoving();                 // true if joints changed since last check
  void resetProgressTracking();

  // ---- ROS / MoveIt ----
  rclcpp::Node::SharedPtr node_;
  std::shared_ptr<moveit::planning_interface::MoveGroupInterface> move_group_;
  rclcpp::executors::SingleThreadedExecutor::SharedPtr executor_;
  std::thread spin_thread_;

  rclcpp::Subscription<sensor_msgs::msg::JointState>::SharedPtr joint_state_sub_;

  // ---- joint-state snapshot shared with the executor thread ----
  std::mutex js_mutex_;
  std::vector<double> latest_positions_;
  bool have_joint_state_{false};

  // last positions the tick thread compared against.
  // Touched only by armIsMoving() / resetProgressTracking(), which are called
  // from onRunning() and onHalted(). BT.CPP v3 never runs those concurrently.
  std::vector<double> last_seen_positions_;

  // ---- state machine ----
  State current_state_{State::IDLE};
  std::atomic<bool> halt_requested_{false};

  std::shared_future<bool> planning_future_;
  std::shared_future<bool> execution_future_;

  std::mutex abandoned_mutex_;
  std::vector<std::shared_future<bool>> abandoned_futures_;

  moveit::planning_interface::MoveGroupInterface::Plan stored_plan_;

  // ---- inputs ----
  std::string current_target_name_;
  std::vector<double> current_joint_values_;
  std::map<std::string, std::vector<double>> joint_targets_;
  bool use_cartesian_{false};
  double speed_factor_;
  double accel_factor_;
  double eef_step_{0.01};

  // ---- timing ----
  std::chrono::steady_clock::time_point phase_start_;
  std::chrono::steady_clock::time_point exec_started_;
  std::chrono::steady_clock::time_point last_progress_;

  // ---- tuning constants ----
  static constexpr double kPlanTimeoutSec    = 20.0;

  // Execution watchdog: fail only if the arm has not moved for this long.
  // Speed-independent by design — an external speed override on the drives
  // means trajectory time_from_start bears no relation to real elapsed time,
  // so any duration-based deadline is invalid here.
  static constexpr double kStallTimeoutSec   = 3.0;

  // Grace period after execute() is issued, before stall detection arms.
  // Covers action-goal round-trip and controller acceptance latency.
  static constexpr double kExecStartGraceSec = 2.0;

  // Any joint moving more than this counts as progress (rad).
  // Raise toward 5e-4 if encoder noise causes false "still moving".
  static constexpr double kMotionEpsilonRad  = 1e-4;
};

#endif  // CONTROL_LOGIC_BT__MOTION__PLAN_AND_EXECUTE_NODE_HPP_