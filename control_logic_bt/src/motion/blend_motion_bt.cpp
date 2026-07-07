#include "control_logic_bt/motion/blend_motion_bt.hpp"

#include <yaml-cpp/yaml.h>
#include <tf2/LinearMath/Quaternion.h>
#include <tf2_geometry_msgs/tf2_geometry_msgs.hpp>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <sstream>
#include <thread>

using namespace std::chrono_literals;

static constexpr const char* GROUP = "robot_manipulator";
static constexpr const char* BASE = "base_link";
static constexpr const char* EE = "end";

static const std::string POINTS_YAML_PATH =
  "/home/nextup/NextupRobot/src/active_project_configs/planning_data/"
  "points.yaml";

// ───────── TRIM ─────────

static std::string trim(const std::string& s)
{
  size_t start = s.find_first_not_of(" \t\r\n");
  if (start == std::string::npos)
    return "";
  size_t end = s.find_last_not_of(" \t\r\n");
  return s.substr(start, end - start + 1);
}

// ───────── DISTANCE ─────────

static double calculateDistance(const geometry_msgs::msg::Pose& p1,
                                const geometry_msgs::msg::Pose& p2)
{
  double dx = p1.position.x - p2.position.x;
  double dy = p1.position.y - p2.position.y;
  double dz = p1.position.z - p2.position.z;
  return std::sqrt(dx * dx + dy * dy + dz * dz);
}

// ───────── BLEND OPTIMIZATION ─────────

struct BlendOptimizationResult
{
  double optimized_radius;
  bool is_feasible;
  std::string warning;
};

static BlendOptimizationResult optimizeBlendRadius(
  double requested_radius,
  double prev_segment_length,
  double next_segment_length,
  double velocity_scaling,
  double acceleration_scaling,
  const std::string& planner_type)
{
  BlendOptimizationResult result;
  result.optimized_radius = requested_radius;
  result.is_feasible = true;
  result.warning = "";

  double max_theoretical_radius =
    std::min(prev_segment_length, next_segment_length) * 0.8;

  double dynamics_factor =
    std::min(velocity_scaling, acceleration_scaling);

  double min_practical_radius = 0.005;

  double planner_factor = (planner_type == "LIN") ? 0.7 : 0.9;

  double adjusted_max_radius =
    max_theoretical_radius * planner_factor *
    (0.5 + dynamics_factor * 0.5);

  if (requested_radius > adjusted_max_radius)
  {
    result.optimized_radius = adjusted_max_radius * 0.9;
    result.is_feasible = false;
    result.warning =
      "Requested blend " + std::to_string(requested_radius) +
      "m exceeds maximum " + std::to_string(adjusted_max_radius) +
      "m. Reduced to " + std::to_string(result.optimized_radius) + "m";
  }
  else if (requested_radius < min_practical_radius && requested_radius > 0)
  {
    result.optimized_radius = min_practical_radius;
    result.warning =
      "Requested blend " + std::to_string(requested_radius) +
      "m too small. Increased to " +
      std::to_string(min_practical_radius) + "m";
  }

  if (requested_radius == 0.0)
  {
    result.optimized_radius = 0.0;
    result.is_feasible = true;
  }

  return result;
}

// ───────── CONSTRUCTOR ─────────

BlendMotion::BlendMotion(const std::string& name,
                         const BT::NodeConfiguration& config)
: BT::StatefulActionNode(name, config)
{
  node_ = rclcpp::Node::make_shared("blend_motion_bt_node");

  RCLCPP_INFO(node_->get_logger(),
              "[BlendMotion] Constructing BT node, building MGI...");

  move_group_ =
    std::make_shared<moveit::planning_interface::MoveGroupInterface>(
      node_, GROUP);

  move_group_->setPlanningPipelineId("pilz_industrial_motion_planner");
  move_group_->setEndEffectorLink(EE);
  move_group_->setPoseReferenceFrame(BASE);

  sequence_client_ =
    rclcpp_action::create_client<moveit_msgs::action::MoveGroupSequence>(
      node_, "/sequence_move_group");

  marker_pub_ =
    node_->create_publisher<visualization_msgs::msg::MarkerArray>(
      "/parul", 10);

  // CRITICAL: spin node_ on a dedicated MultiThreadedExecutor so action
  // client callbacks fire while we're blocked on future.get() in the
  // async thread. Without this, async_send_goal / async_get_result hang
  // forever because nobody is delivering the response callbacks.
  executor_ =
    std::make_shared<rclcpp::executors::MultiThreadedExecutor>();
  executor_->add_node(node_);

  spinning_ = true;
  spin_thread_ = std::thread([this]()
  {
    RCLCPP_INFO(node_->get_logger(),
                "[BlendMotion] Spin thread started");
    executor_->spin();
    RCLCPP_INFO(node_->get_logger(),
                "[BlendMotion] Spin thread exiting");
  });

  RCLCPP_INFO(node_->get_logger(),
              "[BlendMotion] Waiting for /sequence_move_group action server...");

  if (!sequence_client_->wait_for_action_server(std::chrono::seconds(30)))
  {
    RCLCPP_ERROR(node_->get_logger(),
                 "[BlendMotion] /sequence_move_group action server NOT "
                 "available after 30s! Node will fail ticks.");
  }
  else
  {
    RCLCPP_INFO(node_->get_logger(),
                "[BlendMotion] Connected to /sequence_move_group");
  }

  RCLCPP_INFO(node_->get_logger(), "[BlendMotion] Ready.");
}

BlendMotion::~BlendMotion()
{
  spinning_ = false;
  if (executor_)
  {
    executor_->cancel();
  }
  if (spin_thread_.joinable())
  {
    spin_thread_.join();
  }
}

// ───────── PORTS ─────────

BT::PortsList BlendMotion::providedPorts()
{
  return {
    BT::InputPort<std::string>(
      "command",
      "Blend command, e.g. p1 -[LIN,0.05,0.2,0.2]-> p2 -[LIN,0,0.2,0.2]-> p3")
  };
}

// ───────── YAML LOADER ─────────

BlendPointData BlendMotion::getPoint(const std::string& name)
{
  BlendPointData data;

  try
  {
    YAML::Node config = YAML::LoadFile(POINTS_YAML_PATH);

    for (auto item : config["points"])
    {
      if (item["name"].as<std::string>() == name)
      {
        auto j = item["joints_values"];

        data.joints = {
          j["joint1"].as<double>(),
          j["joint2"].as<double>(),
          j["joint3"].as<double>(),
          j["joint4"].as<double>(),
          j["joint5"].as<double>(),
          j["joint6"].as<double>()
        };

        auto c = item["coordinate"];

        data.pose.position.x = c["x"].as<double>() / 100.0;
        data.pose.position.y = c["y"].as<double>() / 100.0;
        data.pose.position.z = c["z"].as<double>() / 100.0;

        tf2::Quaternion q;
        q.setRPY(c["r"].as<double>() * M_PI / 180.0,
                 c["p"].as<double>() * M_PI / 180.0,
                 c["w"].as<double>() * M_PI / 180.0);
        q.normalize();

        data.pose.orientation = tf2::toMsg(q);
        data.found = true;
        return data;
      }
    }

    RCLCPP_ERROR(node_->get_logger(),
                 "[BlendMotion] Point '%s' not present in %s",
                 name.c_str(), POINTS_YAML_PATH.c_str());
  }
  catch (const std::exception& e)
  {
    RCLCPP_ERROR(node_->get_logger(),
                 "[BlendMotion] YAML error loading point '%s': %s",
                 name.c_str(), e.what());
  }

  return data;
}

// ───────── PARSER ─────────

std::vector<BlendSegmentConfig> BlendMotion::parseCommand(
  const std::string& cmd, std::string& error_msg)
{
  std::vector<BlendSegmentConfig> segs;
  error_msg.clear();

  size_t first_arrow = cmd.find("-[");
  if (first_arrow == std::string::npos)
  {
    error_msg = "Invalid command format (missing '-[')";
    return {};
  }

  std::string first_point = trim(cmd.substr(0, first_arrow));
  std::string remainder = cmd.substr(first_arrow + 2);

  std::vector<std::string> chunks;
  size_t pos = 0;
  while (true)
  {
    size_t next = remainder.find("-[", pos);
    if (next == std::string::npos)
    {
      chunks.push_back(remainder.substr(pos));
      break;
    }
    chunks.push_back(remainder.substr(pos, next - pos));
    pos = next + 2;
  }

  std::string current_from = first_point;

  for (size_t idx = 0; idx < chunks.size(); idx++)
  {
    const std::string& chunk = chunks[idx];

    size_t bracket_end = chunk.find("]->");
    if (bracket_end == std::string::npos)
    {
      error_msg = "Missing ']->' in chunk " + std::to_string(idx);
      return {};
    }

    std::string bracket_content = trim(chunk.substr(0, bracket_end));
    std::string to_point = trim(chunk.substr(bracket_end + 3));

    std::vector<std::string> parts;
    std::stringstream ss(bracket_content);
    std::string token;
    while (std::getline(ss, token, ','))
    {
      parts.push_back(trim(token));
    }

    if (parts.size() != 4)
    {
      error_msg = "Need 4 params (planner,blend,vel,acc) in chunk " +
                  std::to_string(idx);
      return {};
    }

    BlendSegmentConfig cfg;
    cfg.from_label = current_from;
    cfg.to_label = to_point;
    cfg.planner = parts[0];

    try
    {
      cfg.blend_radius = std::stod(parts[1]);
      cfg.velocity_scaling = std::stod(parts[2]);
      cfg.acceleration_scaling = std::stod(parts[3]);
    }
    catch (const std::exception& e)
    {
      error_msg = "Number parse error in chunk " + std::to_string(idx) +
                  ": " + e.what();
      return {};
    }

    cfg.original_blend_radius = cfg.blend_radius;

    segs.push_back(cfg);
    current_from = to_point;
  }

  if (!segs.empty())
    segs.back().blend_radius = 0.0;

  return segs;
}

// ───────── VALIDATE ─────────

bool BlendMotion::validateAndOptimizeSequence(
  std::vector<BlendSegmentConfig>& segs,
  const std::map<std::string, BlendPointData>& point_cache)
{
  RCLCPP_INFO(node_->get_logger(),
              "[BlendMotion] ========================================");
  RCLCPP_INFO(node_->get_logger(),
              "[BlendMotion] Validating blend radii...");
  RCLCPP_INFO(node_->get_logger(),
              "[BlendMotion] ========================================");

  bool all_feasible = true;
  std::vector<double> segment_lengths;

  for (size_t i = 0; i < segs.size(); i++)
  {
    const auto& from_pose = point_cache.at(segs[i].from_label).pose;
    const auto& to_pose = point_cache.at(segs[i].to_label).pose;
    double length = calculateDistance(from_pose, to_pose);
    segment_lengths.push_back(length);

    RCLCPP_INFO(node_->get_logger(),
                "[BlendMotion] Segment %zu: %s -> %s = %.3f m",
                i, segs[i].from_label.c_str(),
                segs[i].to_label.c_str(), length);
  }

  for (size_t i = 0; i + 1 < segs.size(); i++)
  {
    auto result = optimizeBlendRadius(
      segs[i].blend_radius,
      segment_lengths[i],
      segment_lengths[i + 1],
      segs[i].velocity_scaling,
      segs[i].acceleration_scaling,
      segs[i].planner);

    segs[i].blend_radius = result.optimized_radius;

    if (!result.warning.empty())
    {
      RCLCPP_WARN(node_->get_logger(),
                  "[BlendMotion] %s", result.warning.c_str());
    }

    if (!result.is_feasible)
      all_feasible = false;
  }

  segs.back().blend_radius = 0.0;
  return all_feasible;
}

// ───────── INITIAL MOVE ─────────

bool BlendMotion::moveToPoint(const BlendPointData& target,
                              const std::string& planner,
                              double velocity,
                              double acceleration)
{
  RCLCPP_INFO(node_->get_logger(),
              "[BlendMotion] Initial move (planner=%s, vel=%.2f, acc=%.2f)...",
              planner.c_str(), velocity, acceleration);

  move_group_->setPlannerId(planner);
  move_group_->setMaxVelocityScalingFactor(velocity);
  move_group_->setMaxAccelerationScalingFactor(acceleration);

  // Small settle delay so joint_states gets fresh data via the executor
  std::this_thread::sleep_for(50ms);

  move_group_->clearPathConstraints();
  move_group_->clearPoseTargets();
  move_group_->setStartStateToCurrentState();
  move_group_->setPoseTarget(target.pose, EE);

  moveit::planning_interface::MoveGroupInterface::Plan plan;

  auto plan_code = move_group_->plan(plan);
  if (plan_code != moveit::core::MoveItErrorCode::SUCCESS)
  {
    RCLCPP_ERROR(node_->get_logger(),
                 "[BlendMotion] Initial planning FAILED, code=%d",
                 plan_code.val);
    return false;
  }

  auto exec_code = move_group_->execute(plan);
  if (exec_code != moveit::core::MoveItErrorCode::SUCCESS)
  {
    RCLCPP_ERROR(node_->get_logger(),
                 "[BlendMotion] Initial execution FAILED, code=%d",
                 exec_code.val);
    return false;
  }

  RCLCPP_INFO(node_->get_logger(),
              "[BlendMotion] Initial move SUCCESS");
  return true;
}

// ───────── MARKER ─────────

void BlendMotion::publishMarker(
  const moveit_msgs::msg::RobotTrajectory& traj, int id)
{
  visualization_msgs::msg::MarkerArray arr;
  visualization_msgs::msg::Marker line;

  line.header.frame_id = move_group_->getPlanningFrame();
  line.ns = "trajectory";
  line.id = id;
  line.type = visualization_msgs::msg::Marker::LINE_STRIP;
  line.scale.x = 0.01;
  line.color.r = 1.0;
  line.color.g = 0.3 * id;
  line.color.b = 0.0;
  line.color.a = 1.0;

  auto model = move_group_->getRobotModel();
  moveit::core::RobotState state(model);
  auto jmg = model->getJointModelGroup(move_group_->getName());

  for (auto& pt : traj.joint_trajectory.points)
  {
    state.setJointGroupPositions(jmg, pt.positions);
    auto tf = state.getGlobalLinkTransform(
      move_group_->getEndEffectorLink());

    geometry_msgs::msg::Point p;
    p.x = tf.translation().x();
    p.y = tf.translation().y();
    p.z = tf.translation().z();
    line.points.push_back(p);
  }

  arr.markers.push_back(line);
  marker_pub_->publish(arr);
}

// ───────── LIFECYCLE ─────────

BT::NodeStatus BlendMotion::onStart()
{
  if (!getInput("command", command_))
  {
    RCLCPP_ERROR(node_->get_logger(),
                 "[BlendMotion] Missing required port 'command'");
    return BT::NodeStatus::FAILURE;
  }

  RCLCPP_INFO(node_->get_logger(),
              "[BlendMotion] Received command: '%s'", command_.c_str());

  if (!sequence_client_->action_server_is_ready())
  {
    RCLCPP_ERROR(node_->get_logger(),
                 "[BlendMotion] /sequence_move_group not ready, aborting tick");
    return BT::NodeStatus::FAILURE;
  }

  // Parse + build point cache here in onStart (cheap, deterministic).
  // Heavy lifting (validate / plan / execute) goes into the async.
  std::string error_msg;
  auto segs = parseCommand(command_, error_msg);
  if (segs.empty())
  {
    RCLCPP_ERROR(node_->get_logger(),
                 "[BlendMotion] Parse error: %s", error_msg.c_str());
    return BT::NodeStatus::FAILURE;
  }

  RCLCPP_INFO(node_->get_logger(),
              "[BlendMotion] Parsed %zu segments", segs.size());

  std::map<std::string, BlendPointData> point_cache;
  for (const auto& seg : segs)
  {
    if (point_cache.find(seg.from_label) == point_cache.end())
    {
      auto pt = getPoint(seg.from_label);
      if (!pt.found)
      {
        RCLCPP_ERROR(node_->get_logger(),
                     "[BlendMotion] Point '%s' not found, aborting",
                     seg.from_label.c_str());
        return BT::NodeStatus::FAILURE;
      }
      point_cache[seg.from_label] = pt;
    }
    if (point_cache.find(seg.to_label) == point_cache.end())
    {
      auto pt = getPoint(seg.to_label);
      if (!pt.found)
      {
        RCLCPP_ERROR(node_->get_logger(),
                     "[BlendMotion] Point '%s' not found, aborting",
                     seg.to_label.c_str());
        return BT::NodeStatus::FAILURE;
      }
      point_cache[seg.to_label] = pt;
    }
  }

  RCLCPP_INFO(node_->get_logger(),
              "[BlendMotion] Point cache built with %zu entries",
              point_cache.size());

  // Launch the heavy work in background thread
  exec_future_ = std::async(std::launch::async,
    [this, segs = std::move(segs),
     point_cache = std::move(point_cache)]() mutable -> bool
    {
      // Validate / optimize blend radii
      validateAndOptimizeSequence(segs, point_cache);

      // Initial PTP move to the very first 'from' point
      const auto& first_seg = segs[0];
      auto start_point = point_cache[first_seg.from_label];

      if (!moveToPoint(start_point, "PTP",
                       first_seg.velocity_scaling,
                       first_seg.acceleration_scaling))
      {
        RCLCPP_ERROR(node_->get_logger(),
                     "[BlendMotion] Initial PTP move to '%s' FAILED",
                     first_seg.from_label.c_str());
        return false;
      }

      // Build sequence request
      moveit_msgs::msg::MotionSequenceRequest seq;

      for (size_t i = 0; i < segs.size(); i++)
      {
        moveit_msgs::msg::MotionSequenceItem item;

        auto target_point = point_cache[segs[i].to_label];

        move_group_->setPlannerId(segs[i].planner);
        move_group_->setPoseTarget(target_point.pose, EE);

        move_group_->constructMotionPlanRequest(item.req);

        item.req.planner_id = segs[i].planner;
        item.req.group_name = GROUP;
        item.req.max_velocity_scaling_factor = segs[i].velocity_scaling;
        item.req.max_acceleration_scaling_factor = segs[i].acceleration_scaling;
        item.blend_radius = segs[i].blend_radius;

        RCLCPP_INFO(node_->get_logger(),
                    "[BlendMotion]   item %zu: %s -> %s "
                    "planner=%s blend=%.4f vel=%.2f acc=%.2f",
                    i, segs[i].from_label.c_str(),
                    segs[i].to_label.c_str(),
                    segs[i].planner.c_str(),
                    segs[i].blend_radius,
                    segs[i].velocity_scaling,
                    segs[i].acceleration_scaling);

        seq.items.push_back(item);
      }

      // Send goal
      moveit_msgs::action::MoveGroupSequence::Goal goal;
      goal.request = seq;

      RCLCPP_INFO(node_->get_logger(),
                  "[BlendMotion] Sending sequence goal with %zu items...",
                  seq.items.size());

      auto goal_handle_future = sequence_client_->async_send_goal(goal);
      auto goal_handle = goal_handle_future.get();

      if (!goal_handle)
      {
        RCLCPP_ERROR(node_->get_logger(),
                     "[BlendMotion] Goal REJECTED by action server!");
        return false;
      }

      RCLCPP_INFO(node_->get_logger(),
                  "[BlendMotion] Goal accepted, executing sequence...");

      auto result_future = sequence_client_->async_get_result(goal_handle);
      auto result = result_future.get();

      if (result.code == rclcpp_action::ResultCode::SUCCEEDED)
      {
        auto res = result.result;
        RCLCPP_INFO(node_->get_logger(),
                    "[BlendMotion] ✓ Sequence SUCCEEDED!");
        RCLCPP_INFO(node_->get_logger(),
                    "[BlendMotion] Planned trajectories: %zu",
                    res->response.planned_trajectories.size());

        int id = 0;
        for (auto& traj : res->response.planned_trajectories)
        {
          publishMarker(traj, id++);
        }
        return true;
      }
      else if (result.code == rclcpp_action::ResultCode::ABORTED)
      {
        RCLCPP_ERROR(node_->get_logger(),
                     "[BlendMotion] ✗ Sequence ABORTED by server!");
        RCLCPP_ERROR(node_->get_logger(),
                     "[BlendMotion]   Try reducing blend radii further");
        return false;
      }
      else if (result.code == rclcpp_action::ResultCode::CANCELED)
      {
        RCLCPP_WARN(node_->get_logger(),
                    "[BlendMotion] Sequence CANCELED");
        return false;
      }
      else
      {
        RCLCPP_ERROR(node_->get_logger(),
                     "[BlendMotion] Sequence failed with code: %d",
                     static_cast<int>(result.code));
        return false;
      }
    });

  return BT::NodeStatus::RUNNING;
}

BT::NodeStatus BlendMotion::onRunning()
{
  if (!exec_future_.valid())
  {
    RCLCPP_ERROR(node_->get_logger(),
                 "[BlendMotion] exec_future invalid in onRunning, returning FAILURE");
    return BT::NodeStatus::FAILURE;
  }

  auto status = exec_future_.wait_for(std::chrono::milliseconds(0));

  if (status == std::future_status::ready)
  {
    bool result = false;
    try
    {
      result = exec_future_.get();
    }
    catch (const std::exception& e)
    {
      RCLCPP_ERROR(node_->get_logger(),
                   "[BlendMotion] Async thread threw exception: %s",
                   e.what());
      return BT::NodeStatus::FAILURE;
    }

    if (result)
    {
      RCLCPP_INFO(node_->get_logger(),
                  "[BlendMotion] Tick returning SUCCESS");
      return BT::NodeStatus::SUCCESS;
    }
    else
    {
      RCLCPP_ERROR(node_->get_logger(),
                   "[BlendMotion] Tick returning FAILURE");
      return BT::NodeStatus::FAILURE;
    }
  }

  return BT::NodeStatus::RUNNING;
}

void BlendMotion::onHalted()
{
  RCLCPP_WARN(node_->get_logger(),
              "[BlendMotion] Halted! (note: in-flight motion not stopped)");
  // If you want a real halt: cancel the goal handle and move_group_->stop()
}