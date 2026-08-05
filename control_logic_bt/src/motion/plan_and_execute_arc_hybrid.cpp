#include "control_logic_bt/motion/plan_and_execute_arc_hybrid.hpp"

#include <geometry_msgs/msg/pose.hpp>
#include <moveit/robot_state/robot_state.h>

#include <moveit/robot_trajectory/robot_trajectory.h>
#include <moveit/trajectory_processing/time_optimal_trajectory_generation.h>

#include <yaml-cpp/yaml.h>

#include <cmath>
#include <mutex>

#include <trajectory_msgs/msg/joint_trajectory.hpp>
#include <std_msgs/msg/string.hpp>

/* =========================================================
 * BT helper
 * ========================================================= */
namespace BT
{
  template <>
  inline std::vector<std::string> convertFromString(StringView str)
  {
    std::vector<std::string> out;
    auto parts = BT::splitString(str, ',');
    for (auto &p : parts)
      out.emplace_back(p);
    return out;
  }
}

/* ===================== Helpers ===================== */
static double deg2rad(double d)
{
  return d * M_PI / 180.0;
}

/* ===================== Shared node ===================== */
static std::shared_ptr<rclcpp::Node> g_node;
static std::mutex g_node_mutex;

static rclcpp::Publisher<trajectory_msgs::msg::JointTrajectory>::SharedPtr
    g_executed_traj_pub;

static rclcpp::Publisher<std_msgs::msg::String>::SharedPtr
    g_executed_traj_name_pub;

/* =========================================================
 * Constructor
 * ========================================================= */
PlanAndExecuteArcHybrid::PlanAndExecuteArcHybrid(
    const std::string &name,
    const BT::NodeConfiguration &config)
    : BT::SyncActionNode(name, config)
{
  std::lock_guard<std::mutex> lock(g_node_mutex);

  if (!g_node)
    g_node = rclcpp::Node::make_shared(
        "bt_plan_execute_arc_hybrid");

  node_ = g_node;

  if (!g_executed_traj_pub)
  {
    g_executed_traj_pub =
        node_->create_publisher<trajectory_msgs::msg::JointTrajectory>(
            "/executed_trajectory", 1);
  }

  if (!g_executed_traj_name_pub)
  {
    g_executed_traj_name_pub =
        node_->create_publisher<std_msgs::msg::String>(
            "/executed_trajectory_name", 1);
  }

  move_group_ =
      std::make_shared<
          moveit::planning_interface::MoveGroupInterface>(
          node_, "robot_manipulator");


  RCLCPP_INFO(
  node_->get_logger(),
  "[PlanAndExecuteArcHybrid] Node constructed and MoveGroup initialized");
}

/* =========================================================
 * Ports
 * ========================================================= */
BT::PortsList PlanAndExecuteArcHybrid::providedPorts()
{
  return {
      BT::InputPort<std::vector<std::string>>("pose_goals"),
      BT::InputPort<double>("speed_factor"),
      BT::InputPort<bool>("six_joint_one_shot"),
      BT::InputPort<double>("joint6_cw_deg"),
      BT::InputPort<double>("joint6_ccw_deg"),
      BT::InputPort<double>("joint6_freq_hz")};
}

/* =========================================================
 * Tick
 * ========================================================= */
BT::NodeStatus PlanAndExecuteArcHybrid::tick()
{
  RCLCPP_INFO(
  node_->get_logger(),
  "[PlanAndExecuteArcHybrid] ===== TICK START =====");

RCLCPP_INFO(
  node_->get_logger(),
  "[PlanAndExecuteArcHybrid] Loading joint targets from YAML");

if (!loadJointTargetsFromYaml(
        "/home/nextup/NextupRobot/src/active_project_configs/planning_data/points.yaml"))
{
  RCLCPP_ERROR(
    node_->get_logger(),
    "[PlanAndExecuteArcHybrid] FAILED to load YAML");
  return BT::NodeStatus::FAILURE;
}

RCLCPP_INFO(
  node_->get_logger(),
  "[PlanAndExecuteArcHybrid] YAML loaded successfully");

std::vector<std::string> pose_names;
if (!getInput("pose_goals", pose_names))
{
  RCLCPP_ERROR(
    node_->get_logger(),
    "[PlanAndExecuteArcHybrid] Missing input: pose_goals");
  return BT::NodeStatus::FAILURE;
}

RCLCPP_INFO(
  node_->get_logger(),
  "[PlanAndExecuteArcHybrid] Pose goals received: %zu",
  pose_names.size());

for (const auto &p : pose_names)
{
  RCLCPP_INFO(
    node_->get_logger(),
    "[PlanAndExecuteArcHybrid]   Pose: %s",
    p.c_str());
}

  double speed = 1.0;
  getInput("speed_factor", speed);
  RCLCPP_INFO(
  node_->get_logger(),
  "[PlanAndExecuteArcHybrid] Speed factor = %.2f",
  speed);
if (speed <= 0.0)
{
  RCLCPP_ERROR(
    node_->get_logger(),
    "[PlanAndExecuteArcHybrid] Invalid speed factor");
  return BT::NodeStatus::FAILURE;
}

  std::vector<std::vector<double>> joints_list;

for (const auto &name : pose_names)
{
  auto it = joint_targets_.find(name);
  if (it == joint_targets_.end())
  {
    RCLCPP_ERROR(
      node_->get_logger(),
      "[PlanAndExecuteArcHybrid] Pose not found in YAML: %s",
      name.c_str());
    return BT::NodeStatus::FAILURE;
  }

  RCLCPP_INFO(
    node_->get_logger(),
    "[PlanAndExecuteArcHybrid] Joint target loaded for %s",
    name.c_str());

  joints_list.push_back(it->second);
}

  moveit::planning_interface::MoveGroupInterface::Plan plan;

RCLCPP_INFO(
  node_->get_logger(),
  "[PlanAndExecuteArcHybrid] Starting Cartesian planning");

if (!executeCurvedCartesianMultiJointTargets(
        joints_list, plan))
{
  RCLCPP_ERROR(
    node_->get_logger(),
    "[PlanAndExecuteArcHybrid] Cartesian planning FAILED");
  return BT::NodeStatus::FAILURE;
}

RCLCPP_INFO(
  node_->get_logger(),
  "[PlanAndExecuteArcHybrid] Cartesian planning SUCCESS");

  bool one_shot = false;
  if (getInput("six_joint_one_shot", one_shot).has_value() && one_shot)
  {
    double cw = 10.0, ccw = 10.0, freq = 0.5;
    getInput("joint6_cw_deg", cw);
    getInput("joint6_ccw_deg", ccw);
    getInput("joint6_freq_hz", freq);

    applyJoint6Oscillation(plan.trajectory_, cw, ccw, freq);
  }

  /* ================= SPEED LOGIC (ADDED) ================= */

  // MoveIt-style scaling (0..1)
  double speed_scale = std::min(speed, 1.0);
  move_group_->setMaxVelocityScalingFactor(speed_scale);
  move_group_->setMaxAccelerationScalingFactor(speed_scale);

  if (!retimeTrajectory(plan.trajectory_, speed_scale))
    return BT::NodeStatus::FAILURE;

  // Extra speed beyond 1.0 (manual, same as your working node)
  if (speed > 1.0)
  {
    double factor = 1.0 / speed; // speed=2 → 0.5 (2x faster)

    for (auto &pt : plan.trajectory_.joint_trajectory.points)
    {
      pt.time_from_start =
          rclcpp::Duration(pt.time_from_start) * factor;

      if (!pt.velocities.empty())
        for (auto &v : pt.velocities)
          v /= factor;

      if (!pt.accelerations.empty())
        for (auto &a : pt.accelerations)
          a /= (factor * factor);
    }
  }

  /* ====================================================== */

// Publish exact trajectory that will be executed
g_executed_traj_pub->publish(
  plan.trajectory_.joint_trajectory);

// Publish pose names from BT port (traceability)
std_msgs::msg::String goal_msg;
goal_msg.data.clear();

for (size_t i = 0; i < pose_names.size(); ++i)
{
  goal_msg.data += pose_names[i];
  if (i + 1 < pose_names.size())
    goal_msg.data += ",";
}

g_executed_traj_name_pub->publish(goal_msg);

RCLCPP_WARN(
  node_->get_logger(),
  "[PlanAndExecuteArcHybrid] EXECUTION STARTED");

auto result = move_group_->execute(plan);

if (result == moveit::core::MoveItErrorCode::SUCCESS)
{
  RCLCPP_INFO(
    node_->get_logger(),
    "[PlanAndExecuteArcHybrid] EXECUTION SUCCESS");
}
else
{
  RCLCPP_ERROR(
    node_->get_logger(),
    "[PlanAndExecuteArcHybrid] EXECUTION FAILED");
}

RCLCPP_INFO(
  node_->get_logger(),
  "[PlanAndExecuteArcHybrid] ===== TICK END =====");

return (result == moveit::core::MoveItErrorCode::SUCCESS)
           ? BT::NodeStatus::SUCCESS
           : BT::NodeStatus::FAILURE;
}

/* =========================================================
 * Cartesian path (UNCHANGED)
 * ========================================================= */
bool PlanAndExecuteArcHybrid::executeCurvedCartesianMultiJointTargets(
    const std::vector<std::vector<double>> &joints_list,
    moveit::planning_interface::MoveGroupInterface::Plan &plan)
{
  const auto model = move_group_->getRobotModel();
  const auto *jmg =
      model->getJointModelGroup(move_group_->getName());
  if (!jmg)
    return false;

  std::string ee = move_group_->getEndEffectorLink();
  if (ee.empty())
    ee = jmg->getLinkModelNames().back();

  std::vector<geometry_msgs::msg::Pose> waypoints;

  for (const auto &joints : joints_list)
  {
    moveit::core::RobotState rs(model);
    rs.setJointGroupPositions(jmg, joints);
    rs.update();

    Eigen::Isometry3d tf =
        rs.getGlobalLinkTransform(ee);

    geometry_msgs::msg::Pose p;
    p.position.x = tf.translation().x();
    p.position.y = tf.translation().y();
    p.position.z = tf.translation().z();

    Eigen::Quaterniond q(tf.rotation());
    p.orientation.x = q.x();
    p.orientation.y = q.y();
    p.orientation.z = q.z();
    p.orientation.w = q.w();

    waypoints.push_back(p);
  }

  moveit_msgs::msg::RobotTrajectory traj;

  double fraction =
      move_group_->computeCartesianPath(
          waypoints, 0.01, 0.0, traj);

  if (fraction < 1.0 ||
      traj.joint_trajectory.points.empty())
    return false;

  plan.trajectory_ = traj;
  return true;
}

/* =========================================================
 * Joint-6 oscillation (UNCHANGED)
 * ========================================================= */
void PlanAndExecuteArcHybrid::applyJoint6Oscillation(
    moveit_msgs::msg::RobotTrajectory &traj,
    double cw_deg,
    double ccw_deg,
    double freq_hz)
{
  constexpr size_t J6 = 5;
  auto &pts = traj.joint_trajectory.points;
  if (pts.size() < 2)
    return;

  const double A =
      std::min(deg2rad(cw_deg), deg2rad(ccw_deg));

  const double final_val = pts.back().positions[J6];

  for (auto &pt : pts)
  {
    double t =
        pt.time_from_start.sec +
        pt.time_from_start.nanosec * 1e-9;

    pt.positions[J6] +=
        A * std::sin(2.0 * M_PI * freq_hz * t);
  }

  pts.back().positions[J6] = final_val;
}

/* =========================================================
 * TOTG retime (REPLACED IPTP, STATE-INDEPENDENT)
 * ========================================================= */
bool PlanAndExecuteArcHybrid::retimeTrajectory(
    moveit_msgs::msg::RobotTrajectory &traj,
    double speed_factor)
{
  if (traj.joint_trajectory.points.empty())
    return false;

  robot_trajectory::RobotTrajectory rt(
      move_group_->getRobotModel(),
      move_group_->getName());

  moveit::core::RobotState start_state(
      move_group_->getRobotModel());

  const auto &names = traj.joint_trajectory.joint_names;
  const auto &p0 = traj.joint_trajectory.points.front();

  for (size_t i = 0; i < names.size(); ++i)
    start_state.setJointPositions(names[i], &p0.positions[i]);

  start_state.update();

  rt.setRobotTrajectoryMsg(start_state, traj);

  trajectory_processing::TimeOptimalTrajectoryGeneration totg;

  if (!totg.computeTimeStamps(
          rt, speed_factor, speed_factor))
    return false;

  rt.getRobotTrajectoryMsg(traj);
  return true;
}

/* =========================================================
 * YAML loader (UNCHANGED)
 * ========================================================= */
bool PlanAndExecuteArcHybrid::loadJointTargetsFromYaml(
    const std::string &path)
{
  joint_targets_.clear();

  YAML::Node root = YAML::LoadFile(path);
  YAML::Node pts =
      root.IsSequence() ? root : root["points"];

  if (!pts || !pts.IsSequence())
    return false;

  for (const auto &p : pts)
  {
    const auto &j = p["joints_values"];
    if (!j || j.size() < 6)
      continue;

    joint_targets_[p["name"].as<std::string>()] =
        {
            j["joint1"].as<double>(),
            j["joint2"].as<double>(),
            j["joint3"].as<double>(),
            j["joint4"].as<double>(),
            j["joint5"].as<double>(),
            j["joint6"].as<double>()};
  }

  return !joint_targets_.empty();
}