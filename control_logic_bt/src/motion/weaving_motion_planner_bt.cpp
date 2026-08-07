#include "control_logic_bt/motion/weaving_motion_planner_bt.hpp"

#include <moveit/robot_state/robot_state.h>
#include <tf2_eigen/tf2_eigen.hpp>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <set>
#include <thread>

static constexpr const char *GROUP = "robot_manipulator";
static constexpr const char *BASE = "base_link";
static constexpr const char *EE = "end";

using namespace std::chrono_literals;

namespace control_logic_bt
{

// =============================================================================
// free helpers -- weave-shape math (ported verbatim from weaving_trajectory_node.cpp)
// =============================================================================
namespace
{

const std::set<std::string> kValidShapes = {
    "sine", "triangle", "zigzag", "square", "sawtooth", "trapezoid", "circular", "figure8"};

// UI dashboards commonly format preset names with hyphens/underscores/spaces
// and mixed case ("zig-zag", "Figure 8", "SAW_TOOTH"). Normalize before
// validating/matching so those all resolve to the same canonical shape name
// instead of silently failing weave_shape validation.
std::string normalizeShapeName(const std::string &s)
{
  std::string out;
  out.reserve(s.size());
  for (unsigned char c : s)
  {
    if (c == '-' || c == '_' || c == ' ')
      continue;
    out += static_cast<char>(std::tolower(c));
  }
  return out;
}

Vec3W normalizeV(const Vec3W &v)
{
  const double n = std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (n < 1e-9)
    return {1, 0, 0};
  return {v[0] / n, v[1] / n, v[2] / n};
}

Vec3W cross(const Vec3W &a, const Vec3W &b)
{
  return {a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]};
}

double dot(const Vec3W &a, const Vec3W &b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

Vec3W sub(const Vec3W &a, const Vec3W &b) { return {a[0] - b[0], a[1] - b[1], a[2] - b[2]}; }

double triangleWave(double phase) { return (2.0 / M_PI) * std::asin(std::sin(phase)); }
double squareWave(double phase) { return std::sin(phase) >= 0.0 ? 1.0 : -1.0; }
double sawtoothWave(double phase)
{
  double x = std::fmod(phase / M_PI, 2.0);
  if (x < 0)
    x += 2.0;
  return x - 1.0;
}
double trapezoidWave(double phase) { return std::max(-1.0, std::min(1.0, triangleWave(phase) * 1.6)); }

// Returns (ds_local, dw_local): ds = offset ALONG the start->end line,
// dw = offset ACROSS it (weave direction). "circular"/"figure8" use both axes.
std::pair<double, double> shapeOffset(const std::string &shape, double phase, double amplitude)
{
  if (shape == "sine")
    return {0.0, amplitude * std::sin(phase)};
  if (shape == "triangle" || shape == "zigzag")
    return {0.0, amplitude * triangleWave(phase)};
  if (shape == "square")
    return {0.0, amplitude * squareWave(phase)};
  if (shape == "sawtooth")
    return {0.0, amplitude * sawtoothWave(phase)};
  if (shape == "trapezoid")
    return {0.0, amplitude * trapezoidWave(phase)};
  if (shape == "circular")
    return {amplitude * std::sin(phase), amplitude * (1.0 - std::cos(phase))};
  if (shape == "figure8")
    return {amplitude * 0.6 * std::sin(2.0 * phase), amplitude * std::sin(phase)};
  return {0.0, amplitude * std::sin(phase)};
}

} // namespace

// =============================================================================
// WeavingMotionPlanner
// =============================================================================

// =============================================================================
// WeavingMotionPlanner -- static singleton storage (see header for why)
// =============================================================================

std::once_flag WeavingMotionPlanner::s_init_flag_;
rclcpp::Node::SharedPtr WeavingMotionPlanner::s_node_;
std::shared_ptr<moveit::planning_interface::MoveGroupInterface> WeavingMotionPlanner::s_move_group_;
std::shared_ptr<tf2_ros::Buffer> WeavingMotionPlanner::s_tf_buffer_;
std::shared_ptr<tf2_ros::TransformListener> WeavingMotionPlanner::s_tf_listener_;
rclcpp::Publisher<std_msgs::msg::Float64MultiArray>::SharedPtr WeavingMotionPlanner::s_status_pub_;
rclcpp::Publisher<visualization_msgs::msg::MarkerArray>::SharedPtr WeavingMotionPlanner::s_marker_pub_;
rclcpp::Subscription<sensor_msgs::msg::JointState>::SharedPtr WeavingMotionPlanner::s_joint_state_sub_;
std::mutex WeavingMotionPlanner::s_joint_state_mutex_;
sensor_msgs::msg::JointState::SharedPtr WeavingMotionPlanner::s_latest_joint_state_;

WeavingMotionPlanner::WeavingMotionPlanner(const std::string &name, const BT::NodeConfiguration &config)
    : BT::StatefulActionNode(name, config)
{
  // Intentionally does NO ROS/MoveIt work here. BT.CPP constructs every
  // node in the tree immediately at tree-build time -- both the XML
  // validation pass and the real run -- which happens at process startup,
  // well before the operator ever sets /start_bt. Doing the heavy work
  // (robot model load, MoveGroupInterface, TF listener) in the constructor
  // would mean it happens on launch regardless of Start; doing it lazily in
  // ensureSingletonReady() (called from onStart()) means it only happens
  // the first time this node is actually ticked into RUNNING -- i.e. only
  // after Start is pressed and this branch of the tree is reached.
  // One-time cost: the very first real activation in the process pays for
  // the robot model load before it starts moving; every activation after
  // that (including of other WeavingMotionPlanner instances) reuses the
  // already-built singleton instantly.
}

void WeavingMotionPlanner::ensureSingletonReady()
{
  std::call_once(s_init_flag_, []()
  {
    s_node_ = rclcpp::Node::make_shared("weaving_bt_node");

    s_move_group_ = std::make_shared<moveit::planning_interface::MoveGroupInterface>(s_node_, GROUP);
    s_move_group_->setPoseReferenceFrame(BASE);
    s_move_group_->setEndEffectorLink(EE);

    s_tf_buffer_ = std::make_shared<tf2_ros::Buffer>(s_node_->get_clock());
    s_tf_listener_ = std::make_shared<tf2_ros::TransformListener>(*s_tf_buffer_);

    s_status_pub_ = s_node_->create_publisher<std_msgs::msg::Float64MultiArray>("~/status", 10);
    s_marker_pub_ = s_node_->create_publisher<visualization_msgs::msg::MarkerArray>("~/weaving_marker", 10);

    // Independent /joint_states subscription with SensorDataQoS (best-effort)
    // -- deliberately NOT relying on MoveGroupInterface's internal
    // CurrentStateMonitor, which subscribes with its own QoS (reliable by
    // default) and can silently never match a best-effort publisher like a
    // typical ros2_control joint_state_broadcaster. A best-effort reader can
    // receive from a best-effort OR reliable writer either way, so this
    // works regardless of what the actual publisher's QoS turns out to be.
    s_joint_state_sub_ = s_node_->create_subscription<sensor_msgs::msg::JointState>(
        "/joint_states", rclcpp::SensorDataQoS(),
        [](sensor_msgs::msg::JointState::SharedPtr msg)
        {
          std::lock_guard<std::mutex> lock(s_joint_state_mutex_);
          s_latest_joint_state_ = msg;
        });

    RCLCPP_INFO(s_node_->get_logger(),
                "[WeavingMotionPlanner] singleton initialised group=%s base=%s ee=%s",
                GROUP, BASE, EE);
  });

  node_ = s_node_;
  move_group_ = s_move_group_;
  tf_buffer_ = s_tf_buffer_;
  tf_listener_ = s_tf_listener_;
  status_pub_ = s_status_pub_;
  marker_pub_ = s_marker_pub_;
  base_frame_ = BASE;
  ee_frame_ = EE;
}

void WeavingMotionPlanner::drainCallbacks(int iterations, int sleep_ms) const
{
  // No persistent background spinner exists for node_ -- MoveGroupInterface
  // services its own action clients (plan/execute) internally regardless,
  // but topic-based reads (getCurrentState() via /joint_states, tf_buffer_
  // via /tf, /tf_static) need node_ spun externally or they never receive
  // anything. rclcpp::spin_some(node_) is a free-function convenience that
  // creates its own temporary executor internally -- safe to call
  // repeatedly from any single thread, matching PilzMotionPlanner's proven
  // "drain callbacks" pattern in this package.
  for (int i = 0; i < iterations; ++i)
  {
    rclcpp::spin_some(node_);
    if (i + 1 < iterations)
      std::this_thread::sleep_for(std::chrono::milliseconds(sleep_ms));
  }
}

BT::PortsList WeavingMotionPlanner::providedPorts()
{
  return {
      BT::InputPort<std::string>("start_weld", "TF frame name of the taught weld start point"),
      BT::InputPort<std::string>("end_weld", "TF frame name of the taught weld end point"),
      BT::InputPort<std::string>("weave_shape", "sine",
                                  "sine|triangle|zigzag|square|sawtooth|trapezoid|circular|figure8"),
      BT::InputPort<double>("amplitude_mm", 1.0, "weave amplitude (half-width, peak from centerline) [mm]"),
      BT::InputPort<double>("weave_pitch_mm", 1.5, "distance along the seam between weave cycles [mm] -- keep small/tight for welding"),
      BT::InputPort<double>("forward_speed", 0.02, "travel speed from start_weld to end_weld [m/s]"),
      BT::InputPort<double>("vel_scale", 0.15, "MoveGroupInterface max velocity scaling factor"),
      BT::InputPort<double>("accel_scale", 0.15, "MoveGroupInterface max acceleration scaling factor"),
      BT::OutputPort<double>("achieved_fraction", "Cartesian path fraction achieved by computeCartesianPath"),
      BT::OutputPort<double>("travelled_mm", "distance actually travelled [mm]"),
  };
}

bool WeavingMotionPlanner::readPorts()
{
  getInput("start_weld", start_weld_);
  getInput("end_weld", end_weld_);
  getInput("weave_shape", weave_shape_);
  weave_shape_ = normalizeShapeName(weave_shape_);
  getInput("amplitude_mm", amplitude_mm_);
  getInput("weave_pitch_mm", weave_pitch_mm_);
  getInput("forward_speed", forward_speed_);
  getInput("vel_scale", vel_scale_);
  getInput("accel_scale", accel_scale_);

  if (start_weld_.empty() || end_weld_.empty())
  {
    RCLCPP_ERROR(node_->get_logger(), "[%s] start_weld and end_weld are required (TF frame names)",
                 name().c_str());
    return false;
  }
  if (!kValidShapes.count(weave_shape_))
  {
    RCLCPP_ERROR(node_->get_logger(), "[%s] invalid weave_shape='%s'", name().c_str(), weave_shape_.c_str());
    return false;
  }
  if (amplitude_mm_ <= 0.0)
  {
    RCLCPP_ERROR(node_->get_logger(), "[%s] amplitude_mm must be > 0", name().c_str());
    return false;
  }
  if (weave_pitch_mm_ <= 0.0)
  {
    RCLCPP_ERROR(node_->get_logger(), "[%s] weave_pitch_mm must be > 0", name().c_str());
    return false;
  }
  if (weave_pitch_mm_ > kWideWeldWarningMm)
  {
    RCLCPP_WARN(node_->get_logger(),
                "[%s] weave_pitch_mm=%.1fmm is wide for a weld weave (typical is 1-8mm). "
                "Still executing -- lower weave_pitch_mm if you wanted closer waves.",
                name().c_str(), weave_pitch_mm_);
  }
  if (amplitude_mm_ > weave_pitch_mm_ / 2.0) // both already in mm -- no unit juggling needed
  {
    RCLCPP_WARN(node_->get_logger(),
                "[%s] amplitude_mm=%.2fmm is large relative to weave_pitch_mm=%.1fmm -- waves may look "
                "jagged/self-overlapping rather than a clean close ripple. Consider amplitude_mm <= "
                "~%.2fmm for this pitch.",
                name().c_str(), amplitude_mm_, weave_pitch_mm_, weave_pitch_mm_ / 4.0);
  }
  if (forward_speed_ <= 0.0)
  {
    RCLCPP_ERROR(node_->get_logger(), "[%s] forward_speed must be > 0", name().c_str());
    return false;
  }

  // amplitude_ (meters, used by the wave math) is derived from the
  // amplitude_mm_ port -- nothing about units is left implicit.
  amplitude_ = amplitude_mm_ / 1000.0;

  // period is a derived quantity, not a port: it's whatever time it takes to
  // travel one weave_pitch_mm at forward_speed. Nothing about the weave's
  // spacing is hardcoded -- you set the physical pitch directly, and the
  // timing follows from that plus your travel speed.
  period_ = (weave_pitch_mm_ / 1000.0) / forward_speed_;

  return true;
}

bool WeavingMotionPlanner::lookupTaughtFrame(const std::string &frame, Eigen::Isometry3d &out) const
{
  drainCallbacks(); // /tf and /tf_static won't arrive at all unless node_ is spun first
  try
  {
    auto tf = tf_buffer_->lookupTransform(base_frame_, frame, tf2::TimePointZero,
                                           tf2::durationFromSec(kTfTimeout));
    out = tf2::transformToEigen(tf);
    return true;
  }
  catch (const tf2::TransformException &e)
  {
    RCLCPP_ERROR(node_->get_logger(), "[%s] TF lookup %s->%s failed: %s", name().c_str(),
                 base_frame_.c_str(), frame.c_str(), e.what());
    return false;
  }
}

std::pair<double, double> WeavingMotionPlanner::localPointAt(double t) const
{
  const double phase = 2.0 * M_PI * t / period_;
  const auto [ds, dw] = shapeOffset(weave_shape_, phase, amplitude_);
  const double s_baseline = forward_speed_ * t;
  return {s_baseline + ds, dw};
}

// ---- MoveIt helpers ---------------------------------------------------------

bool WeavingMotionPlanner::actualEEPoint(geometry_msgs::msg::Point &out, double wait) const
{
  (void)wait; // buildCurrentRobotState() reads an already-cached value, no wait needed
  drainCallbacks(1); // single quick nudge -- this is called frequently during execution tracking
  moveit::core::RobotStatePtr rs;
  if (!buildCurrentRobotState(rs))
    return false;
  const Eigen::Isometry3d T = rs->getGlobalLinkTransform(ee_frame_);
  out.x = T.translation().x();
  out.y = T.translation().y();
  out.z = T.translation().z();
  return true;
}

bool WeavingMotionPlanner::buildCurrentRobotState(moveit::core::RobotStatePtr &out) const
{
  sensor_msgs::msg::JointState::SharedPtr js;
  {
    std::lock_guard<std::mutex> lock(s_joint_state_mutex_);
    js = s_latest_joint_state_;
  }
  if (!js || js->name.empty() || js->position.empty())
    return false;

  out = std::make_shared<moveit::core::RobotState>(move_group_->getRobotModel());
  out->setToDefaultValues();
  moveit::core::jointStateToRobotState(*js, *out);
  out->update();
  return true;
}

bool WeavingMotionPlanner::waitForCurrentRobotState(moveit::core::RobotStatePtr &out) const
{
  // Uses OUR OWN independently-tracked /joint_states cache (see the CURRENT
  // STATE note above the class) instead of MoveGroupInterface's built-in
  // CurrentStateMonitor -- that internal monitor's default QoS is a common
  // real-world mismatch against ros2_control's joint_state_broadcaster and
  // can silently never receive anything at all. Retry with active
  // draining: DDS topic discovery + first-message delivery can take a beat
  // right after the singleton was just built.
  const int max_attempts = 5;
  for (int attempt = 0; attempt < max_attempts; ++attempt)
  {
    drainCallbacks();
    if (buildCurrentRobotState(out))
      return true;
    if (attempt + 1 < max_attempts)
    {
      RCLCPP_WARN(node_->get_logger(),
                  "[%s] no /joint_states received yet (attempt %d/%d), retrying...",
                  name().c_str(), attempt + 1, max_attempts);
      std::this_thread::sleep_for(std::chrono::milliseconds(300));
    }
  }

  // Don't just fail quietly -- tell the operator exactly what to check.
  // "No publisher at all" and "publisher exists but nothing arrived" are
  // two completely different problems with two completely different fixes,
  // and this distinguishes them instead of leaving you to guess.
  const size_t n_pub = node_->count_publishers("/joint_states");
  if (n_pub == 0)
  {
    RCLCPP_ERROR(node_->get_logger(),
                 "[%s] DIAGNOSIS: no publisher exists on /joint_states at all (count=0). "
                 "Your robot driver / ros2_control joint_state_broadcaster (or simulation) is "
                 "not running. Start it FIRST, then press Start on the tree.",
                 name().c_str());
  }
  else
  {
    RCLCPP_ERROR(node_->get_logger(),
                 "[%s] DIAGNOSIS: %zu publisher(s) exist on /joint_states, but this node's own "
                 "SensorDataQoS subscriber still received nothing. This is unusual (best-effort "
                 "should match almost anything) -- check: (1) the publisher is actually calling "
                 "publish() (ros2 topic hz /joint_states), (2) topic name/namespace matches "
                 "exactly (this node listens on the absolute name /joint_states), (3) DDS "
                 "discovery isn't blocked (firewall, ROS_DOMAIN_ID mismatch, multiple machines).",
                 name().c_str(), n_pub);
  }
  return false;
}

void WeavingMotionPlanner::ensureJointLimits()
{
  if (limits_ready_)
    return;

  auto robot_model = move_group_->getRobotModel();
  if (!robot_model)
  {
    RCLCPP_ERROR(node_->get_logger(), "[%s] ensureJointLimits: no robot model available", name().c_str());
    return;
  }
  const auto *jmg = robot_model->getJointModelGroup(GROUP);
  if (!jmg)
  {
    RCLCPP_ERROR(node_->get_logger(), "[%s] ensureJointLimits: joint model group '%s' not found",
                 name().c_str(), GROUP);
    return;
  }

  for (const auto *jm : jmg->getActiveJointModels())
  {
    const auto &bounds = jm->getVariableBounds(jm->getName());
    joint_vel_limit_[jm->getName()] = bounds.velocity_bounded_ ? bounds.max_velocity_ : 0.0;
    joint_accel_limit_[jm->getName()] = bounds.acceleration_bounded_ ? bounds.max_acceleration_ : 0.0;
  }
  limits_ready_ = true;

  RCLCPP_INFO(node_->get_logger(), "[%s] joint limits cached (%zu joints)", name().c_str(),
              joint_vel_limit_.size());
}

double WeavingMotionPlanner::stampConstantSpeedTiming(moveit_msgs::msg::RobotTrajectory &traj, double dt_nominal)
{
  ensureJointLimits();

  auto &jt = traj.joint_trajectory;
  const size_t n = jt.points.size();
  const size_t nj = jt.joint_names.size();
  if (n < 2 || nj == 0)
    return dt_nominal;

  // Look up limits per trajectory joint (in the trajectory's own joint order,
  // which may differ from getActiveJointModels()'s order), scaled by the
  // ports. A limit of 0 (unbounded/unknown) is skipped, not treated as "0".
  std::vector<double> vlim(nj, 0.0), alim(nj, 0.0);
  for (size_t j = 0; j < nj; ++j)
  {
    auto itv = joint_vel_limit_.find(jt.joint_names[j]);
    auto ita = joint_accel_limit_.find(jt.joint_names[j]);
    vlim[j] = (itv != joint_vel_limit_.end()) ? itv->second * vel_scale_ : 0.0;
    alim[j] = (ita != joint_accel_limit_.end()) ? ita->second * accel_scale_ : 0.0;
  }

  double dt = dt_nominal;

  // Iteratively find the smallest uniform dt-stretch that keeps every joint's
  // required velocity/acceleration (under our OWN intended constant-speed
  // schedule) within its scaled limit. Converges in a couple of passes since
  // velocity scales as 1/k and acceleration as 1/k^2 under a uniform stretch
  // by factor k.
  for (int pass = 0; pass < 5; ++pass)
  {
    double worst_ratio = 1.0;

    for (size_t j = 0; j < nj; ++j)
    {
      double prev_v = 0.0;
      for (size_t i = 0; i + 1 < n; ++i)
      {
        const double dq = jt.points[i + 1].positions[j] - jt.points[i].positions[j];
        const double v = dq / dt;
        if (vlim[j] > 1e-9)
          worst_ratio = std::max(worst_ratio, std::fabs(v) / vlim[j]);
        if (alim[j] > 1e-9)
        {
          const double a = (v - prev_v) / dt;
          worst_ratio = std::max(worst_ratio, std::sqrt(std::fabs(a) / alim[j]));
        }
        prev_v = v;
      }
    }

    if (worst_ratio <= 1.0 + 1e-3)
      break;
    dt *= worst_ratio;
  }

  if (dt > dt_nominal * 1.001)
  {
    RCLCPP_WARN(node_->get_logger(),
                "[%s] joint velocity/acceleration limits force a %.2fx slowdown -- "
                "effective weave speed is %.1f%% of requested (tight segment, e.g. near a "
                "wrist singularity or large reorientation). Reduce amplitude/forward_speed, "
                "raise vel_scale/accel_scale if the hardware allows it, or accept the slower pace.",
                name().c_str(), dt / dt_nominal, 100.0 * dt_nominal / dt);
  }

  // Stamp our own schedule -- i*dt -- instead of whatever computeCartesianPath
  // assigned. This is what actually makes forward travel speed constant:
  // execution now follows exactly the time axis the waypoints were generated
  // against, rather than a generic joint-space heuristic.
  for (size_t i = 0; i < n; ++i)
  {
    const double t = i * dt;
    jt.points[i].time_from_start = rclcpp::Duration::from_seconds(t);
    jt.points[i].velocities.assign(nj, 0.0);
    jt.points[i].accelerations.assign(nj, 0.0);
  }

  // Central-difference velocities/accelerations (zero at the very first/last
  // waypoint -- the motion starts and ends at rest, as any discrete
  // plan-then-execute move must). This gives the controller a real profile
  // to track instead of just chasing bare positions.
  for (size_t j = 0; j < nj; ++j)
  {
    for (size_t i = 0; i < n; ++i)
    {
      double v = 0.0;
      if (i > 0 && i + 1 < n)
        v = (jt.points[i + 1].positions[j] - jt.points[i - 1].positions[j]) / (2.0 * dt);
      jt.points[i].velocities[j] = v;
    }
    for (size_t i = 0; i < n; ++i)
    {
      double a = 0.0;
      if (i == 0)
        a = (jt.points[1].velocities[j] - 0.0) / dt;
      else if (i + 1 == n)
        a = (0.0 - jt.points[n - 2].velocities[j]) / dt;
      else
        a = (jt.points[i + 1].velocities[j] - jt.points[i - 1].velocities[j]) / (2.0 * dt);
      jt.points[i].accelerations[j] = a;
    }
  }

  return dt;
}

// ---- visualization -----------------------------------------------------------

visualization_msgs::msg::Marker WeavingMotionPlanner::makeFigureMarker(
    const std::vector<geometry_msgs::msg::Pose> &wps) const
{
  visualization_msgs::msg::Marker line;
  line.header.frame_id = base_frame_;
  line.header.stamp = node_->now();
  line.ns = "weaving_planned";
  line.id = 0;
  line.type = visualization_msgs::msg::Marker::LINE_STRIP;
  line.action = visualization_msgs::msg::Marker::ADD;
  line.scale.x = std::max(kMarkerScale * 0.3, 0.001);
  line.color.r = 1.0;
  line.color.g = 0.0;
  line.color.b = 0.0;
  line.color.a = 1.0;
  line.pose.orientation.w = 1.0;
  for (const auto &p : wps)
  {
    geometry_msgs::msg::Point pt;
    pt.x = p.position.x;
    pt.y = p.position.y;
    pt.z = p.position.z;
    line.points.push_back(pt);
  }
  return line;
}

void WeavingMotionPlanner::publishAll(const std::vector<geometry_msgs::msg::Point> &actual,
                                       const geometry_msgs::msg::Point &cursor, bool have_cursor)
{
  visualization_msgs::msg::MarkerArray arr;
  if (!figure_marker_.points.empty())
  {
    figure_marker_.header.stamp = node_->now();
    arr.markers.push_back(figure_marker_);
  }
  if (actual.size() >= 2)
  {
    visualization_msgs::msg::Marker line;
    line.header.frame_id = base_frame_;
    line.header.stamp = node_->now();
    line.ns = "weaving_actual";
    line.id = 2;
    line.type = visualization_msgs::msg::Marker::LINE_STRIP;
    line.action = visualization_msgs::msg::Marker::ADD;
    line.scale.x = std::max(kMarkerScale * 0.35, 0.0012);
    line.color.r = 0.0;
    line.color.g = 1.0;
    line.color.b = 0.25;
    line.color.a = 1.0;
    line.pose.orientation.w = 1.0;
    line.points = actual;
    arr.markers.push_back(line);
  }
  if (have_cursor)
  {
    visualization_msgs::msg::Marker dot;
    dot.header.frame_id = base_frame_;
    dot.header.stamp = node_->now();
    dot.ns = "weaving_cursor";
    dot.id = 1;
    dot.type = visualization_msgs::msg::Marker::SPHERE;
    dot.action = visualization_msgs::msg::Marker::ADD;
    dot.scale.x = dot.scale.y = dot.scale.z = kMarkerScale;
    dot.color.r = 1.0;
    dot.color.g = 1.0;
    dot.color.b = 0.0;
    dot.color.a = 1.0;
    dot.pose.position = cursor;
    dot.pose.orientation.w = 1.0;
    arr.markers.push_back(dot);
  }
  if (!arr.markers.empty())
    marker_pub_->publish(arr);
}

void WeavingMotionPlanner::publishStatus(double t, double s_d, double w_d, double s_a, double w_a,
                                          double s_baseline, double target_mm)
{
  const double percent = std::min(100.0, (s_baseline * 1000.0 / std::max(target_mm, 1e-9)) * 100.0);
  const double remaining_mm = std::max(0.0, target_mm - s_baseline * 1000.0);
  std_msgs::msg::Float64MultiArray status;
  status.data = {
      t, s_d * 1000.0, w_d * 1000.0, s_a * 1000.0, w_a * 1000.0,
      (s_d - s_a) * 1000.0, (w_d - w_a) * 1000.0,
      percent, remaining_mm, target_mm,
  };
  status_pub_->publish(status);
}

// ---- lifecycle ----------------------------------------------------------------

BT::NodeStatus WeavingMotionPlanner::onStart()
{
  ensureSingletonReady(); // lazy: first real activation in the process pays for this once

  if (!readPorts())
    return BT::NodeStatus::FAILURE;

  move_group_->setMaxVelocityScalingFactor(vel_scale_);
  move_group_->setMaxAccelerationScalingFactor(accel_scale_);

  achieved_fraction_ = 0.0;
  stop_requested_.store(false); // fresh start every activation

  RCLCPP_INFO(node_->get_logger(),
              "[%s] start_weld=%s end_weld=%s shape=%s amplitude=%.2fmm pitch=%.2fmm "
              "(period=%.3fs derived) speed=%.1fmm/s",
              name().c_str(), start_weld_.c_str(), end_weld_.c_str(), weave_shape_.c_str(),
              amplitude_mm_, weave_pitch_mm_, period_, forward_speed_ * 1000);

  // Launch the blocking sample->plan->execute pipeline in the background,
  // same threading pattern as PilzMotionPlanner: onRunning() just polls the
  // future so the BT tick loop never blocks.
  exec_future_ = std::async(std::launch::async, [this]()
                             { return runWeave(); });

  return BT::NodeStatus::RUNNING;
}

BT::NodeStatus WeavingMotionPlanner::onRunning()
{
  if (!exec_future_.valid())
  {
    RCLCPP_ERROR(node_->get_logger(), "[%s] onRunning: future invalid", name().c_str());
    return BT::NodeStatus::FAILURE;
  }

  if (exec_future_.wait_for(0ms) != std::future_status::ready)
    return BT::NodeStatus::RUNNING;

  const bool result = exec_future_.get();

  setOutput("achieved_fraction", achieved_fraction_);
  setOutput("travelled_mm", target_mm_);

  RCLCPP_INFO(node_->get_logger(), "[%s] onRunning: future ready -- %s", name().c_str(),
              result ? "SUCCESS" : "FAILURE");
  return result ? BT::NodeStatus::SUCCESS : BT::NodeStatus::FAILURE;
}

void WeavingMotionPlanner::onHalted()
{
  // Set FIRST, before either branch: this is what stops the continuous
  // back-and-forth loop from starting another leg (graceful case), and what
  // tells the execute() retry loop not to retry after an intentional stop
  // (immediate case) rather than treating it like a genuine failure.
  stop_requested_.store(true);

  // Fail-safe default: ANY halt we can't positively identify as a graceful
  // reset is treated as urgent -- immediate stop, no exceptions. Only the
  // explicit "RESET" value (set by main.cpp right before a
  // RESET_TREE_REQUEST-driven haltTree()) gets graceful treatment. Missing/
  // unset/anything-else all fall through to the immediate-stop branch.
  std::string halt_reason;
  bool graceful = false;
  if (config().blackboard && config().blackboard->get<std::string>("halt_reason", halt_reason))
    graceful = (halt_reason == "RESET");

  if (graceful)
  {
    RCLCPP_WARN(node_->get_logger(),
                "[%s] graceful stop (RESET) -- letting the current weld leg finish naturally, "
                "will NOT start another leg. (halt_reason='%s')",
                name().c_str(), halt_reason.c_str());
    // Deliberately do NOT call move_group_->stop() here -- just wait below
    // for the already-launched execute() to finish on its own.
  }
  else
  {
    RCLCPP_WARN(node_->get_logger(), "[%s] halted (halt_reason='%s') -- stopping motion immediately",
                name().c_str(), halt_reason.empty() ? "<unset>" : halt_reason.c_str());
    move_group_->stop(); // safe to call while execute() is in flight on the async thread
  }

  if (exec_future_.valid())
    exec_future_.wait();
}

// ---- the pipeline: look up taught points -> sample -> plan -> execute --------

bool WeavingMotionPlanner::runOneLeg(const std::string &leg_start_frame, const std::string &leg_end_frame)
{
  auto logger = node_->get_logger();

  Eigen::Isometry3d T_start, T_end;
  if (!lookupTaughtFrame(leg_start_frame, T_start) || !lookupTaughtFrame(leg_end_frame, T_end))
    return false;

  const Vec3W start_pos = {T_start.translation().x(), T_start.translation().y(), T_start.translation().z()};
  const Vec3W end_pos = {T_end.translation().x(), T_end.translation().y(), T_end.translation().z()};

  const double separation = std::sqrt(dot(sub(end_pos, start_pos), sub(end_pos, start_pos)));
  if (separation < kMinSeparationM)
  {
    RCLCPP_ERROR(logger,
                 "[%s] %s and %s are only %.2f mm apart (< %.2f mm) -- "
                 "check the taught points, not executing.",
                 name().c_str(), leg_start_frame.c_str(), leg_end_frame.c_str(), separation * 1000.0,
                 kMinSeparationM * 1000.0);
    return false;
  }

  // ---- HARD PRE-FLIGHT: refuse to run unless the robot is ALREADY at this
  // leg's start point. No auto-navigate-to-start motion is ever bundled
  // into this node -- if the operator (or, for a later leg in continuous
  // mode, the previous leg) hasn't left the robot there, fail loudly and
  // tell them, rather than silently planning an extra "get to start" leg.
  //
  // IMPORTANT: both sides of this comparison go through the exact same TF
  // lookup path (lookupTaughtFrame, base_frame_ -> requested frame). Do NOT
  // compare against RobotState::getGlobalLinkTransform() here -- that
  // reports poses in the robot MODEL's root frame, which is not guaranteed
  // to be identical to base_frame_ depending on the URDF/SRDF virtual joint
  // setup, and a mismatch there would show a systematic "not at start"
  // error even when the robot is genuinely at the taught point. ----
  Eigen::Isometry3d T_current;
  if (!lookupTaughtFrame(ee_frame_, T_current))
  {
    RCLCPP_ERROR(logger, "[%s] could not read current robot state (TF %s->%s) to verify start position",
                 name().c_str(), base_frame_.c_str(), ee_frame_.c_str());
    return false;
  }
  const Vec3W current_pos = {T_current.translation().x(), T_current.translation().y(),
                              T_current.translation().z()};
  const double start_pos_err = std::sqrt(dot(sub(current_pos, start_pos), sub(current_pos, start_pos)));
  const Eigen::Quaterniond q_current(T_current.rotation());
  const Eigen::Quaterniond q_start_taught(T_start.rotation());
  const double start_ang_err = q_current.angularDistance(q_start_taught);

  if (start_pos_err > kStartPoseTolM || start_ang_err > kStartOrientationTolRad)
  {
    RCLCPP_ERROR(logger,
                 "[%s] robot is NOT at this leg's start ('%s') -- refusing to auto-move there. "
                 "Position off by %.2fmm (tol %.2fmm), orientation off by %.2fdeg (tol %.2fdeg). "
                 "Jog/position the robot to '%s' yourself, then retry.",
                 name().c_str(), leg_start_frame.c_str(), start_pos_err * 1000.0, kStartPoseTolM * 1000.0,
                 start_ang_err * 180.0 / M_PI, kStartOrientationTolRad * 180.0 / M_PI, leg_start_frame.c_str());
    return false;
  }

  origin_ = start_pos;
  forward_dir_ = normalizeV(sub(end_pos, start_pos));

  // Weave ("sideways") direction: this leg's start frame's taught local
  // Y-axis, projected perpendicular to the travel direction (Gram-Schmidt)
  // so it's exactly orthogonal even if the taught orientation isn't
  // perfectly square to the line. Tool orientation for the whole leg is
  // held at this same taught orientation throughout.
  const Eigen::Quaterniond q_start(T_start.rotation());
  orientation_msg_ = tf2::toMsg(q_start);
  const Eigen::Vector3d y_axis_eigen = T_start.rotation() * Eigen::Vector3d::UnitY();
  Vec3W y_axis = {y_axis_eigen.x(), y_axis_eigen.y(), y_axis_eigen.z()};

  Vec3W weave_raw = sub(y_axis, {forward_dir_[0] * dot(y_axis, forward_dir_),
                                  forward_dir_[1] * dot(y_axis, forward_dir_),
                                  forward_dir_[2] * dot(y_axis, forward_dir_)});
  if (std::sqrt(dot(weave_raw, weave_raw)) < 1e-6)
  {
    // This leg's start frame's Y-axis happens to be (nearly) parallel to
    // the travel direction -- fall back to its Z-axis instead so we never
    // divide by ~zero.
    const Eigen::Vector3d z_axis_eigen = T_start.rotation() * Eigen::Vector3d::UnitZ();
    Vec3W z_axis = {z_axis_eigen.x(), z_axis_eigen.y(), z_axis_eigen.z()};
    weave_raw = sub(z_axis, {forward_dir_[0] * dot(z_axis, forward_dir_),
                             forward_dir_[1] * dot(z_axis, forward_dir_),
                             forward_dir_[2] * dot(z_axis, forward_dir_)});
    RCLCPP_WARN(logger,
                "[%s] '%s''s local Y-axis is ~parallel to the travel line; "
                "falling back to its Z-axis for the weave direction.",
                name().c_str(), leg_start_frame.c_str());
  }
  weave_dir_ = normalizeV(weave_raw);

  target_mm_ = separation * 1000.0;
  t_end_ = separation / forward_speed_;
  const int n = std::max(kMinWaypoints,
                         std::min(kMaxWaypoints, static_cast<int>(std::round(t_end_ * kWaypointRateHz))));

  RCLCPP_INFO(logger, "[%s] leg %s->%s: sampling %d waypoints (wave=%s, distance=%.1fmm)", name().c_str(),
              leg_start_frame.c_str(), leg_end_frame.c_str(), n, weave_shape_.c_str(), target_mm_);

  std::vector<geometry_msgs::msg::Pose> waypoints;
  waypoints.reserve(n + 1);
  for (int i = 0; i <= n; ++i)
  {
    const double t = t_end_ * static_cast<double>(i) / static_cast<double>(n);
    const auto [u, v] = localPointAt(t);
    geometry_msgs::msg::Pose p;
    p.position.x = origin_[0] + forward_dir_[0] * u + weave_dir_[0] * v;
    p.position.y = origin_[1] + forward_dir_[1] * u + weave_dir_[1] * v;
    p.position.z = origin_[2] + forward_dir_[2] * u + weave_dir_[2] * v;
    p.orientation = orientation_msg_;
    waypoints.push_back(p);
  }

  if (kPublishMarkers)
  {
    figure_marker_ = makeFigureMarker(waypoints);
    visualization_msgs::msg::MarkerArray arr;
    arr.markers.push_back(figure_marker_);
    marker_pub_->publish(arr);
  }

  // computeCartesianPath() resamples our waypoint polyline at eef_step
  // intervals internally -- it does NOT necessarily solve IK exactly at
  // each waypoint we hand it. If eef_step is coarser than the weave's own
  // geometry (amplitude or pitch), MoveIt's own resampling grid can step
  // right over the oscillation and flatten it out, no matter how finely we
  // sampled it ourselves above. So eef_step must shrink with the weave's
  // actual size instead of staying at a fixed constant -- otherwise a
  // small, tight weave (which is exactly what real welding needs) gets
  // silently smoothed away by MoveIt's internal interpolation.
  const double pitch = weave_pitch_mm_ / 1000.0;
  const double weave_feature_size = std::min(amplitude_, pitch / 2.0);
  double eef_step = std::min(kEefStep, weave_feature_size / 8.0);
  eef_step = std::max(eef_step, kMinEefStep); // floor: avoid pathological over-sampling / numerical noise

  RCLCPP_INFO(logger, "[%s] pitch=%.2fmm amplitude=%.2fmm -> eef_step=%.3fmm (was fixed at %.1fmm)",
              name().c_str(), pitch * 1000.0, amplitude_mm_, eef_step * 1000.0, kEefStep * 1000.0);

  moveit_msgs::msg::RobotTrajectory trajectory;
  drainCallbacks();

  // Explicitly feed OUR OWN reliably-tracked current state in, instead of
  // letting computeCartesianPath() silently fall back to
  // MoveGroupInterface's internal CurrentStateMonitor -- which is exactly
  // the QoS-troubled path that fails to ever receive /joint_states in the
  // first place (see the CURRENT STATE note above the class).
  moveit::core::RobotStatePtr start_state;
  if (waitForCurrentRobotState(start_state))
  {
    move_group_->setStartState(*start_state);
  }
  else
  {
    RCLCPP_ERROR(logger,
                 "[%s] no reliable current state available to seed computeCartesianPath -- "
                 "falling back to MoveGroupInterface's own current-state fetch, which is likely "
                 "to fail the same way (see the DIAGNOSIS log just above).",
                 name().c_str());
    move_group_->setStartStateToCurrentState();
  }

  const double fraction = move_group_->computeCartesianPath(waypoints, eef_step, kJumpThreshold, trajectory);
  achieved_fraction_ = fraction;

  RCLCPP_INFO(logger, "[%s] Cartesian path: %.1f%% achieved", name().c_str(), fraction * 100.0);

  if (fraction < kMinFraction)
  {
    RCLCPP_ERROR(logger,
                 "[%s] only %.1f%% reachable (need %.1f%%) -- not executing. "
                 "Reduce amplitude, or re-teach %s/%s to a roomier pose. "
                 "(deterministic -- not retried)",
                 name().c_str(), fraction * 100.0, kMinFraction * 100.0, leg_start_frame.c_str(),
                 leg_end_frame.c_str());
    return false;
  }

  // Stamp our own constant-forward-speed schedule onto the trajectory
  // (see stampConstantSpeedTiming for why this replaces naive stretching),
  // safety-clamped against real joint velocity/acceleration limits.
  const double dt_nominal = t_end_ / static_cast<double>(n);
  const double dt_used = stampConstantSpeedTiming(trajectory, dt_nominal);

  double duration = 0.0;
  if (!trajectory.joint_trajectory.points.empty())
    duration = dt_used * static_cast<double>(trajectory.joint_trajectory.points.size() - 1);

  // ---- execute with retry (mirrors PilzMotionPlanner's attempt loop) ----
  for (int attempt = 0; attempt < kMaxAttempts; ++attempt)
  {
    if (attempt > 0)
    {
      RCLCPP_WARN(logger, "[%s] execute retry %d/%d", name().c_str(), attempt, kMaxAttempts - 1);
      std::this_thread::sleep_for(150ms);
    }

    RCLCPP_INFO(logger, "[%s] executing...", name().c_str());

    drainCallbacks(); // matches PilzMotionPlanner: nudge callbacks right before committing to execute()

    std::atomic<bool> exec_done{false};
    moveit::core::MoveItErrorCode exec_result;
    std::thread exec_thread([&]()
                             {
      exec_result = move_group_->execute(trajectory);
      exec_done.store(true, std::memory_order_release); });

    std::vector<geometry_msgs::msg::Point> actual;
    actual.reserve(1024);
    geometry_msgs::msg::Point last_ee;
    bool have_ee = false;

    const double sample_dt = 0.03; // ~33 Hz
    const double wall_timeout = duration * 1.5 + 5.0;
    const auto t0 = std::chrono::steady_clock::now();
    double next = 0.0;

    while (!exec_done.load(std::memory_order_acquire))
    {
      const double elapsed = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();

      if (kPublishMarkers && elapsed >= next)
      {
        geometry_msgs::msg::Point ee;
        if (actualEEPoint(ee, 0.05))
        {
          actual.push_back(ee);
          last_ee = ee;
          have_ee = true;
        }
        publishAll(actual, last_ee, have_ee);

        double s_a = 0.0, w_a = 0.0;
        if (have_ee)
        {
          s_a = (last_ee.x - origin_[0]) * forward_dir_[0] + (last_ee.y - origin_[1]) * forward_dir_[1] +
                (last_ee.z - origin_[2]) * forward_dir_[2];
          w_a = (last_ee.x - origin_[0]) * weave_dir_[0] + (last_ee.y - origin_[1]) * weave_dir_[1] +
                (last_ee.z - origin_[2]) * weave_dir_[2];
        }
        const double t_frac = duration > 1e-6 ? std::min(elapsed, duration) : elapsed;
        const double t_query = t_frac * (t_end_ / std::max(duration, 1e-9));
        const auto [s_d, w_d] = localPointAt(std::min(t_query, t_end_));
        publishStatus(elapsed, s_d, w_d, s_a, w_a, forward_speed_ * std::min(t_query, t_end_), target_mm_);

        next += sample_dt;
      }
      if (elapsed >= wall_timeout)
        break;
      std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }

    exec_thread.join();

    if (exec_result == moveit::core::MoveItErrorCode::SUCCESS)
    {
      if (attempt > 0)
        RCLCPP_INFO(logger, "[%s] recovered on attempt %d", name().c_str(), attempt);
      RCLCPP_INFO(logger, "[%s] leg COMPLETE (%s->%s) -- %.1f mm travelled.", name().c_str(),
                  leg_start_frame.c_str(), leg_end_frame.c_str(), target_mm_);
      return true;
    }

    if (stop_requested_.load())
    {
      // Intentional stop (onHalted() called move_group_->stop()), not a
      // real failure -- don't retry, that would fight the stop request.
      RCLCPP_WARN(logger, "[%s] execute() ended by stop request -- not retrying.", name().c_str());
      return false;
    }

    RCLCPP_ERROR(logger, "[%s] execute() FAILED code=%d attempt=%d", name().c_str(), exec_result.val, attempt);
  }

  RCLCPP_ERROR(logger, "[%s] exhausted all %d execute retries", name().c_str(), kMaxAttempts);
  return false;
}

bool WeavingMotionPlanner::runWeave()
{
  // Single one-way pass: start_weld -> end_weld, then done. No automatic
  // reversal, no repeating -- runOneLeg() still has the full pipeline
  // (pre-flight check, plan, execute-with-retry, and it still respects
  // stop_requested_ during execute() so an immediate halt doesn't retry
  // after an intentional stop).
  return runOneLeg(start_weld_, end_weld_);
}

} // namespace control_logic_bt