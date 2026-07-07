#include "control_logic_bt/motion/plan_and_execute_arc_hybrid.hpp"

#include <geometry_msgs/msg/pose.hpp>
#include <moveit/robot_state/robot_state.h>

#include <cmath>
#include <mutex>

/* ===== ADD (SAFE) ===== */
#include <trajectory_msgs/msg/joint_trajectory.hpp>
#include <std_msgs/msg/string.hpp>
/* ====================== */

/* =========================================================
 * REQUIRED for std::vector<std::string> BT port
 * ========================================================= */
namespace BT
{
template <>
inline std::vector<std::string> convertFromString(StringView str)
{
  std::vector<std::string> result;
  auto parts = BT::splitString(str, ',');
  for (auto& p : parts)
    result.emplace_back(p);
  return result;
}
}

/* ===================== Helpers ===================== */
static double deg2rad(double d)
{
  return d * M_PI / 180.0;
}

/* =========================================================
 * SHARED ROS NODE (DDS SAFE)
 * ========================================================= */
static std::shared_ptr<rclcpp::Node> g_node;
static std::mutex g_node_mutex;

/* ===== ADD (SAFE) ===== */
static rclcpp::Publisher<trajectory_msgs::msg::JointTrajectory>::SharedPtr
  g_executed_traj_pub;

static rclcpp::Publisher<std_msgs::msg::String>::SharedPtr
  g_executed_traj_name_pub;
/* ====================== */

/* =========================================================
 * Constructor
 * ========================================================= */
PlanAndExecuteArcHybrid::PlanAndExecuteArcHybrid(
  const std::string& name,
  const BT::NodeConfiguration& config)
: BT::SyncActionNode(name, config)
{
  std::lock_guard<std::mutex> lock(g_node_mutex);

  if (!g_node)
  {
    g_node = rclcpp::Node::make_shared(
      "bt_plan_execute_arc_hybrid");
  }

  node_ = g_node;

  /* ===== ADD (SAFE) ===== */
  if (!g_executed_traj_pub)
  {
    g_executed_traj_pub =
      node_->create_publisher<trajectory_msgs::msg::JointTrajectory>(
        "/executed_trajectory", 1);

    g_executed_traj_name_pub =
      node_->create_publisher<std_msgs::msg::String>(
        "/executed_trajectory_name", 1);

    RCLCPP_INFO(node_->get_logger(),
      "✅ Arc trajectory trace publishers initialized");
  }
  /* ====================== */

  move_group_ =
    std::make_shared<moveit::planning_interface::MoveGroupInterface>(
      node_, "robot_manipulator");
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
    BT::InputPort<double>("joint6_freq_hz")
  };
}

/* =========================================================
 * Tick
 * ========================================================= */
BT::NodeStatus PlanAndExecuteArcHybrid::tick()
{
  if (!loadJointTargetsFromYaml(
        "/home/nextup/NextupRobot/src/active_project_configs/planning_data/points.yaml"))
  {
    RCLCPP_ERROR(node_->get_logger(), "YAML load failed");
    return BT::NodeStatus::FAILURE;
  }

  std::vector<std::string> pose_names;
  if (!getInput("pose_goals", pose_names))
  {
    RCLCPP_ERROR(node_->get_logger(), "pose_goals missing");
    return BT::NodeStatus::FAILURE;
  }

  double speed = 1.0;
  getInput("speed_factor", speed);

  if (speed <= 0.0 || !std::isfinite(speed))
  {
    RCLCPP_ERROR(node_->get_logger(), "Invalid speed_factor");
    return BT::NodeStatus::FAILURE;
  }

  std::vector<std::vector<double>> joints_list;
  for (const auto& name : pose_names)
  {
    auto it = joint_targets_.find(name);
    if (it == joint_targets_.end())
    {
      RCLCPP_ERROR(node_->get_logger(),
        "Pose '%s' not found", name.c_str());
      return BT::NodeStatus::FAILURE;
    }
    joints_list.push_back(it->second);
  }

  moveit::planning_interface::MoveGroupInterface::Plan plan;

  {
    static std::mutex moveit_mutex;
    std::lock_guard<std::mutex> lock(moveit_mutex);

    if (!executeCurvedCartesianMultiJointTargets(
          joints_list, speed, plan))
    {
      RCLCPP_ERROR(node_->get_logger(),
        "Cartesian curved path FAILED");
      return BT::NodeStatus::FAILURE;
    }
  }

  bool one_shot = false;
  if (getInput("six_joint_one_shot", one_shot).has_value() && one_shot)
  {
    double cw = 30.0, ccw = 60.0, freq = 1.0;
    getInput("joint6_cw_deg", cw);
    getInput("joint6_ccw_deg", ccw);
    getInput("joint6_freq_hz", freq);

    applyJoint6Oscillation(plan.trajectory_, cw, ccw, freq);
  }

  /* ===== ADD (CRITICAL, SAFE) ===== */
  // Publish executed trajectory
  g_executed_traj_pub->publish(
    plan.trajectory_.joint_trajectory);

  // Build arc trajectory name
  std::string arc_name = "arc:";
  for (size_t i = 0; i < pose_names.size(); ++i)
  {
    arc_name += pose_names[i];
    if (i + 1 < pose_names.size())
      arc_name += "->";
  }

  std_msgs::msg::String name_msg;
  name_msg.data = arc_name;
  g_executed_traj_name_pub->publish(name_msg);
  /* ================================ */

  auto result = move_group_->execute(plan);

  return (result == moveit::core::MoveItErrorCode::SUCCESS)
    ? BT::NodeStatus::SUCCESS
    : BT::NodeStatus::FAILURE;
}

/* =========================================================
 * Curved Cartesian Path (UNCHANGED)
 * ========================================================= */
bool PlanAndExecuteArcHybrid::executeCurvedCartesianMultiJointTargets(
  const std::vector<std::vector<double>>& joints_list,
  double speed,
  moveit::planning_interface::MoveGroupInterface::Plan& plan)
{
  if (joints_list.empty()) return false;

  const auto model = move_group_->getRobotModel();
  const auto* jmg =
    model->getJointModelGroup(move_group_->getName());
  if (!jmg) return false;

  std::string ee = move_group_->getEndEffectorLink();
  if (ee.empty())
    ee = jmg->getLinkModelNames().back();

  std::vector<geometry_msgs::msg::Pose> waypoints;

  for (const auto& joints : joints_list)
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

  if (fraction < 1.0 || traj.joint_trajectory.points.empty())
    return false;

  for (auto& pt : traj.joint_trajectory.points)
  {
    double t =
      pt.time_from_start.sec +
      pt.time_from_start.nanosec * 1e-9;

    t /= speed;

    pt.time_from_start.sec = static_cast<int>(t);
    pt.time_from_start.nanosec =
      static_cast<uint32_t>(
        (t - pt.time_from_start.sec) * 1e9);
  }

  plan.trajectory_ = traj;
  return true;
}

/* =========================================================
 * Joint-6 Oscillation (UNCHANGED)
 * ========================================================= */
void PlanAndExecuteArcHybrid::applyJoint6Oscillation(
  moveit_msgs::msg::RobotTrajectory& traj,
  double cw_deg,
  double ccw_deg,
  double freq_hz)
{
  constexpr size_t J6 = 5;

  auto& pts = traj.joint_trajectory.points;
  if (pts.empty()) return;

  double final_val = pts.back().positions[J6];

  for (auto& pt : pts)
  {
    double t =
      pt.time_from_start.sec +
      pt.time_from_start.nanosec * 1e-9;

    double phase = std::fmod(t * freq_hz, 1.0);

    double offset =
      (phase < 0.5)
        ? (phase / 0.5) * deg2rad(cw_deg)
        : -((phase - 0.5) / 0.5) * deg2rad(ccw_deg);

    pt.positions[J6] += offset;
  }

  pts.back().positions[J6] = final_val;
}

/* =========================================================
 * YAML Loader (UNCHANGED)
 * ========================================================= */
bool PlanAndExecuteArcHybrid::loadJointTargetsFromYaml(
  const std::string& path)
{
  joint_targets_.clear();

  try
  {
    YAML::Node root = YAML::LoadFile(path);
    YAML::Node pts =
      root.IsSequence() ? root : root["points"];

    if (!pts || !pts.IsSequence())
      return false;

    for (const auto& p : pts)
    {
      const auto& j = p["joints_values"];
      if (!j || j.size() < 6) continue;

      joint_targets_[p["name"].as<std::string>()] = {
        j["joint1"].as<double>(),
        j["joint2"].as<double>(),
        j["joint3"].as<double>(),
        j["joint4"].as<double>(),
        j["joint5"].as<double>(),
        j["joint6"].as<double>()
      };
    }
  }
  catch (...)
  {
    return false;
  }

  return !joint_targets_.empty();
}