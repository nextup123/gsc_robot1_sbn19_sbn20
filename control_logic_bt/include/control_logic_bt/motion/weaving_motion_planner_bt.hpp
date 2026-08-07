#pragma once

// =============================================================================
// weaving_motion_planner_bt.hpp
//
// BT.CPP v3 StatefulActionNode: a straight-line weld weave between two taught
// TF frames (start_weld -> end_weld), with a sinusoidal-or-other weave
// oscillation overlaid, executed via MoveGroupInterface::computeCartesianPath()
// + execute() on a background thread (same architecture as PilzMotionPlanner
// in this package: own internally-owned rclcpp::Node + MoveGroupInterface
// built once in the constructor, std::async launches the blocking plan/
// execute work, onRunning() polls the returned future).
//
// This is the stripped-down, production version -- no base_shape, no
// tool-relative axis selection, no arbitrary travel distance. The path is
// always the straight line between two taught points, and the weave rides
// on the plane defined by that line's tangent and the start frame's
// orientation (see localPointAt()).
//
// WAVE SHAPES: sine, triangle, zigzag, square, sawtooth, trapezoid, circular,
// figure8.
//
// CONSTANT SPEED: forward_speed is enforced for real, not just requested --
// see stampConstantSpeedTiming() in the .cpp. The executed trajectory is
// stamped with the exact schedule the waypoints were generated against
// (rather than trusting computeCartesianPath's own generic joint-space
// timing), safety-clamped against real per-joint velocity/acceleration
// limits (scaled by vel_scale/accel_scale) with a uniform slowdown + warning
// if a segment would otherwise exceed them.
//
// TOOL ORIENTATION: held constant for the whole weld, taken from the
// start_weld frame's taught orientation (not whatever the arm happens to be
// holding at runtime) -- the weave's sideways ("weave") direction is that
// frame's local Y-axis, projected perpendicular to the start->end line.
//
// Status mapping:
//   RUNNING  - waypoints sampled/planned, execute() in flight
//   SUCCESS  - achieved fraction >= kMinFraction AND execute() returned SUCCESS
//   FAILURE  - bad weave_shape name, start_weld/end_weld TF lookup failed,
//              start/end points too close together, computeCartesianPath
//              achieved fraction below kMinFraction (deterministic -- not
//              retried), or execute() failed on every retry attempt
//
// onHalted() calls move_group_->stop() and waits for the in-flight future so
// a BT reset/abort can never leave an execute() call running unsupervised.
//
// SHARED SINGLETON NOTE: main.cpp builds the BT tree TWICE (once to validate
// the XML, once to actually run it), which means this constructor runs
// twice too. Building a fresh rclcpp::Node + MoveGroupInterface each time is
// wasteful (reloads the whole robot model) and can hang the second time
// (duplicate node name, /robot_description parameter-service contention
// while the first instance is still tearing down). So node_/move_group_/
// tf_buffer_/tf_listener_ are process-wide singletons here -- built exactly
// ONCE no matter how many times the tree gets constructed or how many
// WeavingMotionPlanner nodes exist in the XML.
//
// SPINNING: no persistent background executor thread. MoveGroupInterface
// services its own action clients (plan/execute) internally regardless, but
// topic-based reads -- getCurrentState() (needs /joint_states) and our own
// tf2_ros::TransformListener (needs /tf, /tf_static) -- need node_ spun
// externally to ever receive anything. This uses the same pattern already
// proven in this package's PilzMotionPlanner: explicit rclcpp::spin_some()
// calls right before anything that needs fresh topic data (see
// drainCallbacks()), rather than a separate persistent spinner thread
// running concurrently with everything else touching the same node.
//
// CURRENT STATE: does NOT rely on MoveGroupInterface's built-in
// CurrentStateMonitor for reading the robot's current joint state.
// CurrentStateMonitor subscribes to /joint_states with its own internal QoS
// (reliable by default) -- a very common real-world MoveIt2 + ros2_control
// gotcha is a QoS mismatch against a joint_state_broadcaster, which causes
// the subscription to NEVER match at the DDS layer (zero messages received,
// ever, even though the topic clearly has a publisher). Instead, this node
// keeps its own direct /joint_states subscription with rclcpp::SensorDataQoS
// (best-effort -- compatible with a best-effort OR reliable publisher
// either way), builds a moveit::core::RobotState from that independently,
// and explicitly feeds it to MoveGroupInterface via setStartState() before
// planning -- rather than letting computeCartesianPath() silently depend on
// the same QoS-troubled internal monitor. See buildCurrentRobotState().
// =============================================================================

#include <behaviortree_cpp_v3/action_node.h>

#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/float64_multi_array.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <visualization_msgs/msg/marker.hpp>
#include <visualization_msgs/msg/marker_array.hpp>
#include <moveit/move_group_interface/move_group_interface.h>
#include <moveit/robot_state/conversions.h>
#include <moveit_msgs/msg/robot_trajectory.hpp>
#include <tf2_ros/buffer.h>
#include <tf2_ros/transform_listener.h>
#include <Eigen/Geometry>

#include <array>
#include <atomic>
#include <future>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

namespace control_logic_bt
{

using Vec3W = std::array<double, 3>;

class WeavingMotionPlanner : public BT::StatefulActionNode
{
public:
  explicit WeavingMotionPlanner(const std::string &name, const BT::NodeConfiguration &config);

  static BT::PortsList providedPorts();

  BT::NodeStatus onStart() override;
  BT::NodeStatus onRunning() override;
  void onHalted() override;

private:
  // ---- setup ----
  // Lazily builds the process-wide singleton (node_/move_group_/tf_buffer_/
  // tf_listener_/publishers + spin thread) on first call, then just copies
  // the shared_ptrs into this instance. Called from onStart() -- NOT the
  // constructor -- so the heavy work only happens on first real execution
  // (post Start-button), not at tree-build/process-startup time. See the
  // singleton note above the class and the comment in the .cpp constructor.
  void ensureSingletonReady();
  bool readPorts();
  bool lookupTaughtFrame(const std::string &frame, Eigen::Isometry3d &out) const;
  // Explicit rclcpp::spin_some(node_) x2 with a short pause between, matching
  // PilzMotionPlanner's proven pattern. Call this right before anything that
  // needs fresh topic data (current joint state, TF) -- there is no
  // persistent background spinner, so nothing else services this node's
  // subscriptions otherwise.
  void drainCallbacks(int iterations = 2, int sleep_ms = 30) const;

  // ---- wave math ----
  std::pair<double, double> localPointAt(double t) const;

  // ---- MoveIt helpers ----
  bool actualEEPoint(geometry_msgs::msg::Point &out, double wait) const;
  // Retries (with active draining + rich diagnosis on final failure) to get
  // a full RobotState from our independent /joint_states cache. Used to
  // seed computeCartesianPath()'s start state -- the one place where a
  // clear diagnosis on failure matters most.
  bool waitForCurrentRobotState(moveit::core::RobotStatePtr &out) const;
  // Builds a moveit::core::RobotState from OUR OWN independently-tracked
  // /joint_states cache (see the CURRENT STATE note above the class) --
  // bypasses MoveGroupInterface's built-in CurrentStateMonitor entirely.
  // Returns false if no joint_states message has been received yet.
  bool buildCurrentRobotState(moveit::core::RobotStatePtr &out) const;

  // ---- constant-speed time parameterization ----
  // Fetches per-joint velocity/acceleration limits from the robot model once
  // (cached across activations). Populates joint_vel_limit_/joint_accel_limit_.
  void ensureJointLimits();
  // Stamps every waypoint's time_from_start at its ORIGINALLY-INTENDED time
  // (i*dt_nominal -- the exact schedule used to generate the waypoint via
  // localPointAt(t)), instead of trusting computeCartesianPath's own generic
  // joint-space timing. If any joint would need to exceed its (vel_scale_/
  // accel_scale_-scaled) limit to hit that schedule, the whole trajectory is
  // uniformly slowed down just enough to stay safe (iterative refinement),
  // and a warning is logged with the resulting slowdown factor. Also fills
  // in velocities/accelerations via central finite differences so the
  // controller tracks a smooth profile rather than bare positions. Returns
  // the final (possibly stretched) per-waypoint dt actually used.
  double stampConstantSpeedTiming(moveit_msgs::msg::RobotTrajectory &traj, double dt_nominal);

  // ---- visualization (gated by the kPublishMarkers internal constant) ----
  visualization_msgs::msg::Marker makeFigureMarker(const std::vector<geometry_msgs::msg::Pose> &wps) const;
  void publishAll(const std::vector<geometry_msgs::msg::Point> &actual,
                   const geometry_msgs::msg::Point &cursor, bool have_cursor);
  void publishStatus(double t, double s_d, double w_d, double s_a, double w_a,
                      double s_baseline, double target_mm);

  // ---- the async worker run from onStart() ----
  // Entry point: a single one-way pass, start_weld->end_weld, then done.
  // No automatic reversal, no repeating. (runOneLeg() below still respects
  // stop_requested_ during execute(), so an intentional stop is never
  // mistaken for a real failure and retried.)
  bool runWeave();
  // Does one pass from leg_start_frame to leg_end_frame (a single taught-
  // frame-to-taught-frame weld weave). This is the actual pipeline: TF
  // lookups, pre-flight check, sample/plan/execute. Called once per leg by
  // runWeave() above; leg_start_frame/leg_end_frame are whichever of
  // start_weld_/end_weld_ apply to the current direction.
  bool runOneLeg(const std::string &leg_start_frame, const std::string &leg_end_frame);

  rclcpp::Node::SharedPtr node_;
  std::shared_ptr<moveit::planning_interface::MoveGroupInterface> move_group_;
  std::shared_ptr<tf2_ros::Buffer> tf_buffer_;
  std::shared_ptr<tf2_ros::TransformListener> tf_listener_;

  rclcpp::Publisher<std_msgs::msg::Float64MultiArray>::SharedPtr status_pub_;
  rclcpp::Publisher<visualization_msgs::msg::MarkerArray>::SharedPtr marker_pub_;

  // ---- process-wide singletons (built once via std::call_once in the
  // constructor; node_/move_group_/tf_buffer_/tf_listener_/status_pub_/
  // marker_pub_ above are just shared_ptr copies pointing at these) ----
  static std::once_flag s_init_flag_;
  static rclcpp::Node::SharedPtr s_node_;
  static std::shared_ptr<moveit::planning_interface::MoveGroupInterface> s_move_group_;
  static std::shared_ptr<tf2_ros::Buffer> s_tf_buffer_;
  static std::shared_ptr<tf2_ros::TransformListener> s_tf_listener_;
  static rclcpp::Publisher<std_msgs::msg::Float64MultiArray>::SharedPtr s_status_pub_;
  static rclcpp::Publisher<visualization_msgs::msg::MarkerArray>::SharedPtr s_marker_pub_;

  // ---- independent /joint_states cache (bypasses CurrentStateMonitor's
  // QoS-troubled internal subscription -- see CURRENT STATE note above) ----
  static rclcpp::Subscription<sensor_msgs::msg::JointState>::SharedPtr s_joint_state_sub_;
  static std::mutex s_joint_state_mutex_;
  static sensor_msgs::msg::JointState::SharedPtr s_latest_joint_state_;

  // ---- ports, re-read every onStart() ----
  std::string start_weld_, end_weld_; // TF frame names of the two taught points
  std::string weave_shape_{"sine"};
  double amplitude_mm_{1.0}; // PORT, millimeters -- what you actually type in the UI
  double amplitude_{0.001};  // derived: amplitude_mm_/1000, meters -- used internally by the wave math, NOT a port
  double forward_speed_{0.02};
  double weave_pitch_mm_{1.5}; // distance along the seam between weave cycles [mm] -- direct control, nothing hardcoded
  double period_{0.0};         // derived: (weave_pitch_mm_/1000) / forward_speed_, NOT a port
  double vel_scale_{0.15}, accel_scale_{0.15};

  // Set by onHalted(), checked by the execute() retry loop inside
  // runOneLeg() -- so an intentional stop is skipped, not retried like a
  // real failure. Reset to false at the top of every onStart().
  std::atomic<bool> stop_requested_{false};

  // ---- fixed internal defaults (not exposed as ports; edit here to tune) ----
  static constexpr double kEefStep = 0.005;
  static constexpr double kMinEefStep = 0.0003; // floor for the dynamic eef_step (see runWeave())
  static constexpr double kJumpThreshold = 0.0;
  static constexpr double kWaypointRateHz = 50.0;
  static constexpr int kMinWaypoints = 8;
  static constexpr int kMaxWaypoints = 4000;
  static constexpr int kMaxAttempts = 3;
  static constexpr double kStateWait = 2.0;
  static constexpr double kTfTimeout = 1.0;
  static constexpr double kMinFraction = 0.90;
  static constexpr double kMinSeparationM = 0.002; // start/end closer than this -> FAILURE
  // How close the robot must ALREADY be to start_weld before this node will
  // run -- exceeding either tolerance is a hard FAILURE, never an auto-move.
  static constexpr double kStartPoseTolM = 0.010;                // 10mm -- realistic manual jogging precision
  static constexpr double kStartOrientationTolRad = 0.0873;     // ~5 degrees
  static constexpr double kWideWeldWarningMm = 8.0; // weave_pitch_mm above this logs a "wide for welding" warning
  static constexpr bool kPublishMarkers = true; // enabled: welding needs a live view of the planned/actual weave path
  static constexpr double kMarkerScale = 0.015;

  // ---- run-time state for one activation ----
  Vec3W origin_{}, forward_dir_{}, weave_dir_{};
  geometry_msgs::msg::Quaternion orientation_msg_;
  double t_end_{0.0}, target_mm_{0.0};
  visualization_msgs::msg::Marker figure_marker_;
  std::string base_frame_, ee_frame_;

  std::future<bool> exec_future_;
  double achieved_fraction_{0.0};

  // ---- joint limit cache (built once via ensureJointLimits(), reused every activation) ----
  bool limits_ready_{false};
  std::unordered_map<std::string, double> joint_vel_limit_;   // rad/s or m/s per joint name; 0 = unbounded/unknown
  std::unordered_map<std::string, double> joint_accel_limit_; // rad/s^2 or m/s^2 per joint name; 0 = unbounded/unknown
};

} // namespace control_logic_bt