// blend_executor.cpp
//
// Implementation of BlendExecutor (see blend_executor.hpp).

#include "control_logic_bt/motion/blend_executor.hpp"

#include <map>
#include <mutex>
#include <cmath>
#include <fstream>

#include <yaml-cpp/yaml.h>

#include <behaviortree_cpp_v3/bt_factory.h>

#include <moveit_msgs/msg/motion_sequence_request.hpp>
#include <moveit_msgs/msg/motion_sequence_item.hpp>
#include <moveit_msgs/msg/joint_constraint.hpp>

namespace control_logic_bt
{

namespace
{
const std::string GROUP = "robot_manipulator";
const std::vector<std::string> JOINTS = {
    "joint1", "joint2", "joint3", "joint4", "joint5", "joint6"};
const std::string POINTS_FILE =
    "/home/nextup/NextupRobot/src/active_project_configs/planning_data/points.yaml";
const std::string CACHE_FILE =
    "/home/nextup/NextupRobot/src/active_project_configs/blend_cache/blend_cache.yaml";
}  // namespace

// ---- static member definitions ---------------------------------------------
rclcpp::Node::SharedPtr BlendExecutor::s_node_ = nullptr;
rclcpp_action::Client<BlendExecutor::MoveGroupSequence>::SharedPtr
    BlendExecutor::s_client_ = nullptr;
rclcpp::executors::MultiThreadedExecutor::SharedPtr BlendExecutor::s_exec_ = nullptr;
std::thread BlendExecutor::s_spin_;

// ---- ctor: one-time shared node + executor thread --------------------------
BlendExecutor::BlendExecutor(const std::string & name, const BT::NodeConfiguration & cfg)
: BT::StatefulActionNode(name, cfg)
{
  static std::once_flag once;
  std::call_once(once, []()
  {
    s_node_ = std::make_shared<rclcpp::Node>("blend_executor_bt");
    s_client_ = rclcpp_action::create_client<MoveGroupSequence>(
        s_node_, "/sequence_move_group");
    s_exec_ = std::make_shared<rclcpp::executors::MultiThreadedExecutor>();
    s_exec_->add_node(s_node_);
    s_spin_ = std::thread([]() { s_exec_->spin(); });
    s_spin_.detach();
  });
}

BT::PortsList BlendExecutor::providedPorts()
{
  return { BT::InputPort<std::string>(
      "path_name", "Key in blend_cache.yaml to execute (pre-computed).") };
}

// ---- load cache entry + verify against points.yaml -------------------------
bool BlendExecutor::loadPath(const std::string & path_name, std::string & reason)
{
  items_.clear();

  YAML::Node cache;
  try { cache = YAML::LoadFile(CACHE_FILE); }
  catch (const std::exception & e)
  { reason = std::string("cannot load cache: ") + e.what(); return false; }

  if (!cache["paths"] || !cache["paths"][path_name])
  { reason = "path '" + path_name + "' not in cache"; return false; }

  YAML::Node entry = cache["paths"][path_name];
  if (!entry["items"])
  { reason = "cache entry '" + path_name + "' has no items"; return false; }

  // Load points.yaml fresh and build name -> joints.
  YAML::Node pyaml;
  try { pyaml = YAML::LoadFile(POINTS_FILE); }
  catch (const std::exception & e)
  { reason = std::string("cannot load points.yaml: ") + e.what(); return false; }

  std::map<std::string, std::vector<double>> jointsByName;
  if (pyaml["points"])
  {
    for (const auto & pt : pyaml["points"])
    {
      if (!pt["name"] || !pt["joints_values"]) continue;
      std::vector<double> jv; bool ok = true;
      for (const auto & jn : JOINTS)
      {
        if (!pt["joints_values"][jn]) { ok = false; break; }
        jv.push_back(pt["joints_values"][jn].as<double>());
      }
      if (ok) jointsByName[pt["name"].as<std::string>()] = jv;
    }
  }

  // Build items, attaching CURRENT joints from points.yaml (the safety check:
  // a cached point that no longer exists -> fail; otherwise we use the latest
  // joints on disk, so a re-taught point is honoured without re-commissioning
  // the blend values).
  for (const auto & it : entry["items"])
  {
    CachedItem ci;
    ci.name      = it["name"]      ? it["name"].as<std::string>()  : "";
    ci.type      = it["type"]      ? it["type"].as<std::string>()  : "LIN";
    ci.radius_cm = it["radius_cm"] ? it["radius_cm"].as<double>()  : 0.0;
    ci.vel       = it["vel"]       ? it["vel"].as<double>()        : 0.1;
    ci.acc       = it["acc"]       ? it["acc"].as<double>()        : 0.1;

    if (ci.name.empty()) { reason = "cache item missing name"; return false; }
    if (ci.type != "PTP" && ci.type != "LIN")
    { reason = "item '" + ci.name + "' bad type '" + ci.type + "'"; return false; }

    auto jit = jointsByName.find(ci.name);
    if (jit == jointsByName.end())
    { reason = "point '" + ci.name + "' from cache no longer in points.yaml"; return false; }
    ci.joints = jit->second;

    items_.push_back(std::move(ci));
  }

  if (items_.size() < 2) { reason = "cached path has < 2 items"; return false; }
  return true;
}

moveit_msgs::msg::Constraints
BlendExecutor::makeJointGoal(const std::vector<double> & vals)
{
  moveit_msgs::msg::Constraints c;
  for (size_t i = 0; i < JOINTS.size(); ++i)
  {
    moveit_msgs::msg::JointConstraint jc;
    jc.joint_name = JOINTS[i];
    jc.position = vals[i];
    jc.tolerance_above = 0.001;
    jc.tolerance_below = 0.001;
    jc.weight = 1.0;
    c.joint_constraints.push_back(jc);
  }
  return c;
}

BlendExecutor::MoveGroupSequence::Goal BlendExecutor::buildGoal()
{
  moveit_msgs::msg::MotionSequenceRequest seq;
  for (size_t i = 0; i < items_.size(); ++i)
  {
    const auto & ci = items_[i];
    moveit_msgs::msg::MotionSequenceItem item;
    auto & req = item.req;
    req.group_name = GROUP;
    req.planner_id = ci.type;                  // PTP or LIN from cache
    // No-Ruckig blend pipeline: Ruckig breaks Pilz blending. Smoothness comes
    // from max_jerk in joint_limits.yaml instead. Must match the probe's pipeline.
    req.pipeline_id = "pilz_blend";
    req.max_velocity_scaling_factor = ci.vel;
    req.max_acceleration_scaling_factor = ci.acc;
    req.allowed_planning_time = 5.0;
    req.num_planning_attempts = 5;
    req.goal_constraints.push_back(makeJointGoal(ci.joints));
    double r = ci.radius_cm / 100.0;
    if (i + 1 == items_.size()) r = 0.0;       // last never blends
    item.blend_radius = r;
    seq.items.push_back(item);
  }
  MoveGroupSequence::Goal goal;
  goal.request = seq;
  goal.planning_options.plan_only = false;     // real execution
  return goal;
}

// ------------------------------ BT lifecycle --------------------------------
BT::NodeStatus BlendExecutor::onStart()
{
  std::string path_name;
  if (!getInput("path_name", path_name) || path_name.empty())
  {
    RCLCPP_ERROR(s_node_->get_logger(), "[BlendExecutor] missing path_name port.");
    return BT::NodeStatus::FAILURE;
  }

  std::string reason;
  if (!loadPath(path_name, reason))
  {
    RCLCPP_ERROR(s_node_->get_logger(), "[BlendExecutor] '%s' load failed: %s",
                 path_name.c_str(), reason.c_str());
    return BT::NodeStatus::FAILURE;
  }

  // Non-blocking readiness check (never freezes the executor).
  if (!s_client_->action_server_is_ready())
  {
    RCLCPP_ERROR(s_node_->get_logger(),
                 "[BlendExecutor] /sequence_move_group not ready.");
    return BT::NodeStatus::FAILURE;
  }

  done_.store(false);
  succeeded_.store(false);

  auto goal = buildGoal();
  auto opts = rclcpp_action::Client<MoveGroupSequence>::SendGoalOptions();
  opts.goal_response_callback =
    [this, path_name](std::shared_ptr<GoalHandleSeq> gh)
    {
      if (!gh)
      {
        RCLCPP_ERROR(s_node_->get_logger(),
                     "[BlendExecutor] '%s' goal REJECTED by server.", path_name.c_str());
        succeeded_.store(false);
        done_.store(true);
      }
    };
  opts.result_callback =
    [this, path_name](const GoalHandleSeq::WrappedResult & result)
    {
      bool ok = (result.code == rclcpp_action::ResultCode::SUCCEEDED);
      if (ok)
        RCLCPP_INFO(s_node_->get_logger(),
                    "[BlendExecutor] '%s' SUCCEEDED.", path_name.c_str());
      else
        RCLCPP_ERROR(s_node_->get_logger(),
                     "[BlendExecutor] '%s' result code %d.",
                     path_name.c_str(), static_cast<int>(result.code));
      succeeded_.store(ok);
      done_.store(true);
    };

  RCLCPP_INFO(s_node_->get_logger(),
              "[BlendExecutor] executing pre-computed '%s' (%zu items, NO search).",
              path_name.c_str(), items_.size());
  s_client_->async_send_goal(goal, opts);
  return BT::NodeStatus::RUNNING;
}

BT::NodeStatus BlendExecutor::onRunning()
{
  if (!done_.load()) return BT::NodeStatus::RUNNING;
  return succeeded_.load() ? BT::NodeStatus::SUCCESS : BT::NodeStatus::FAILURE;
}

void BlendExecutor::onHalted()
{
  try { s_client_->async_cancel_all_goals(); } catch (...) {}
  RCLCPP_WARN(s_node_->get_logger(), "[BlendExecutor] halted.");
}

}  // namespace control_logic_bt

// ---- BehaviorTree.CPP plugin registration ----------------------------------
BT_REGISTER_NODES(factory)
{
  factory.registerNodeType<control_logic_bt::BlendExecutor>("BlendExecutor");
}