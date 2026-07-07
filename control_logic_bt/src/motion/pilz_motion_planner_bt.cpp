#include "control_logic_bt/motion/pilz_motion_planner_bt.hpp"

#include <tf2/LinearMath/Quaternion.h>
#include <tf2/LinearMath/Transform.h>

#include <chrono>
#include <cmath>
#include <cstdio>
#include <future>
#include <string>
#include <thread>
#include <vector>

using namespace std::chrono_literals;

static constexpr const char* GROUP = "robot_manipulator";
static constexpr const char* BASE = "base_link";
static constexpr const char* EE = "end";

// Reach envelope — advisory warnings only.
static constexpr double MAX_REACH_WARN_M = 1.8;
static constexpr double MIN_REACH_WARN_M = 0.15;

// Zero-distance move short-circuit tolerances.
static constexpr double ZERO_MOVE_POS_TOL_M   = 0.002;                   // 2 mm
static constexpr double ZERO_MOVE_ANG_TOL_RAD = 0.5 * M_PI / 180.0;      // 0.5 deg

// Wrist singularity guard — |joint5| below this is dangerous for LIN.
static constexpr double WRIST_SINGULARITY_DEG = 3.0;

static double deg2rad(double deg)
{
  return deg * M_PI / 180.0;
}

// Map MoveIt error codes to human-readable names for logging.
static const char* moveitErrorName(int code)
{
  using moveit::core::MoveItErrorCode;
  switch (code)
  {
    case MoveItErrorCode::SUCCESS:                       return "SUCCESS";
    case MoveItErrorCode::FAILURE:                       return "FAILURE";
    case MoveItErrorCode::PLANNING_FAILED:               return "PLANNING_FAILED";
    case MoveItErrorCode::INVALID_MOTION_PLAN:           return "INVALID_MOTION_PLAN";
    case MoveItErrorCode::MOTION_PLAN_INVALIDATED_BY_ENVIRONMENT_CHANGE:
                                                         return "MOTION_PLAN_INVALIDATED_BY_ENVIRONMENT_CHANGE";
    case MoveItErrorCode::CONTROL_FAILED:                return "CONTROL_FAILED";
    case MoveItErrorCode::UNABLE_TO_AQUIRE_SENSOR_DATA:  return "UNABLE_TO_AQUIRE_SENSOR_DATA";
    case MoveItErrorCode::TIMED_OUT:                     return "TIMED_OUT";
    case MoveItErrorCode::PREEMPTED:                     return "PREEMPTED";
    case MoveItErrorCode::START_STATE_IN_COLLISION:      return "START_STATE_IN_COLLISION";
    case MoveItErrorCode::START_STATE_VIOLATES_PATH_CONSTRAINTS:
                                                         return "START_STATE_VIOLATES_PATH_CONSTRAINTS";
    case MoveItErrorCode::GOAL_IN_COLLISION:             return "GOAL_IN_COLLISION";
    case MoveItErrorCode::GOAL_VIOLATES_PATH_CONSTRAINTS:return "GOAL_VIOLATES_PATH_CONSTRAINTS";
    case MoveItErrorCode::GOAL_CONSTRAINTS_VIOLATED:     return "GOAL_CONSTRAINTS_VIOLATED";
    case MoveItErrorCode::INVALID_GROUP_NAME:            return "INVALID_GROUP_NAME";
    case MoveItErrorCode::INVALID_GOAL_CONSTRAINTS:      return "INVALID_GOAL_CONSTRAINTS";
    case MoveItErrorCode::INVALID_ROBOT_STATE:           return "INVALID_ROBOT_STATE";
    case MoveItErrorCode::INVALID_LINK_NAME:             return "INVALID_LINK_NAME";
    case MoveItErrorCode::INVALID_OBJECT_NAME:           return "INVALID_OBJECT_NAME";
    case MoveItErrorCode::FRAME_TRANSFORM_FAILURE:       return "FRAME_TRANSFORM_FAILURE";
    case MoveItErrorCode::COLLISION_CHECKING_UNAVAILABLE:return "COLLISION_CHECKING_UNAVAILABLE";
    case MoveItErrorCode::ROBOT_STATE_STALE:             return "ROBOT_STATE_STALE";
    case MoveItErrorCode::SENSOR_INFO_STALE:             return "SENSOR_INFO_STALE";
    case MoveItErrorCode::COMMUNICATION_FAILURE:         return "COMMUNICATION_FAILURE";
    case MoveItErrorCode::NO_IK_SOLUTION:                return "NO_IK_SOLUTION";
    default:                                             return "UNKNOWN";
  }
}

// True for error codes where retrying with the same goal is pointless.
static bool isDeterministicFailure(int code)
{
  using moveit::core::MoveItErrorCode;
  switch (code)
  {
    case MoveItErrorCode::NO_IK_SOLUTION:
    case MoveItErrorCode::INVALID_GOAL_CONSTRAINTS:
    case MoveItErrorCode::GOAL_IN_COLLISION:
    case MoveItErrorCode::GOAL_VIOLATES_PATH_CONSTRAINTS:
    case MoveItErrorCode::GOAL_CONSTRAINTS_VIOLATED:
    case MoveItErrorCode::INVALID_GROUP_NAME:
    case MoveItErrorCode::INVALID_LINK_NAME:
    case MoveItErrorCode::FRAME_TRANSFORM_FAILURE:
      return true;
    default:
      return false;
  }
}

PilzMotionPlanner::PilzMotionPlanner(
  const std::string& name,
  const BT::NodeConfiguration& config)
: BT::StatefulActionNode(name, config)
{
  node_ = rclcpp::Node::make_shared("pilz_bt_node");

  tf_buffer_ = std::make_shared<tf2_ros::Buffer>(node_->get_clock());
  tf_listener_ = std::make_shared<tf2_ros::TransformListener>(*tf_buffer_);

  // Initialize ONCE - shared across all ticks
  move_group_ =
    std::make_shared<moveit::planning_interface::MoveGroupInterface>(
      node_, GROUP);

  move_group_->setPlanningPipelineId("pilz_industrial_motion_planner");
  move_group_->setPoseReferenceFrame(BASE);
  move_group_->setEndEffectorLink(EE);

  RCLCPP_INFO(node_->get_logger(),
              "[PilzMotionPlanner] initialised group=%s base=%s ee=%s",
              GROUP, BASE, EE);
}

BT::PortsList PilzMotionPlanner::providedPorts()
{
  return {
    BT::InputPort<std::string>("frame"),
    BT::InputPort<std::string>("planner_id"),
    BT::InputPort<double>("max_vel"),
    BT::InputPort<double>("max_acc"),

    BT::InputPort<double>("x"),
    BT::InputPort<double>("y"),
    BT::InputPort<double>("z"),

    BT::InputPort<double>("r"),
    BT::InputPort<double>("p"),
    BT::InputPort<double>("w")
  };
}

geometry_msgs::msg::PoseStamped PilzMotionPlanner::buildPose()
{
  auto logger = node_->get_logger();

  RCLCPP_INFO(logger,
              "[buildPose] === START === frame=%s offset_in_frame=[%.4f %.4f %.4f]",
              frame_.c_str(), x_, y_, z_);

  // ---- (A) Pose of the calibrated frame in base ----
  auto tf_msg = tf_buffer_->lookupTransform(
    BASE, frame_, tf2::TimePointZero, tf2::durationFromSec(2.0));

  tf2::Transform tf_base_to_frame;
  tf2::fromMsg(tf_msg.transform, tf_base_to_frame);

  {
    const auto& o = tf_base_to_frame.getOrigin();
    tf2::Quaternion q = tf_base_to_frame.getRotation();
    q.normalize();
    double roll, pitch, yaw;
    tf2::Matrix3x3(q).getRPY(roll, pitch, yaw);
    RCLCPP_INFO(logger,
                "[buildPose] (A) base->%s origin=[%.4f %.4f %.4f] "
                "quat=[%.4f %.4f %.4f %.4f] rpy_deg=[%.2f %.2f %.2f]",
                frame_.c_str(),
                o.x(), o.y(), o.z(),
                q.x(), q.y(), q.z(), q.w(),
                roll * 180.0 / M_PI,
                pitch * 180.0 / M_PI,
                yaw * 180.0 / M_PI);
  }

  // ---- (B) Current tool orientation in base (this is what we KEEP) ----
  auto ee_msg = tf_buffer_->lookupTransform(
    BASE, EE, tf2::TimePointZero, tf2::durationFromSec(2.0));

  tf2::Transform tf_base_to_ee;
  tf2::fromMsg(ee_msg.transform, tf_base_to_ee);

  tf2::Quaternion current_ee_orientation = tf_base_to_ee.getRotation();
  current_ee_orientation.normalize();

  {
    const auto& o = tf_base_to_ee.getOrigin();
    double roll, pitch, yaw;
    tf2::Matrix3x3(current_ee_orientation).getRPY(roll, pitch, yaw);
    RCLCPP_INFO(logger,
                "[buildPose] (B) base->end (current) pos=[%.4f %.4f %.4f] "
                "quat=[%.4f %.4f %.4f %.4f] rpy_deg=[%.2f %.2f %.2f]",
                o.x(), o.y(), o.z(),
                current_ee_orientation.x(), current_ee_orientation.y(),
                current_ee_orientation.z(), current_ee_orientation.w(),
                roll * 180.0 / M_PI,
                pitch * 180.0 / M_PI,
                yaw * 180.0 / M_PI);
  }

  // ---- (C) Position: offset expressed ALONG the calibrated frame's axes ----
  tf2::Vector3 offset_in_frame(x_, y_, z_);
  tf2::Vector3 offset_in_base = tf2::quatRotate(
    tf_base_to_frame.getRotation(), offset_in_frame);

  tf2::Vector3 target_position = tf_base_to_frame.getOrigin() + offset_in_base;

  RCLCPP_INFO(logger,
              "[buildPose] (C) offset_in_base=[%.4f %.4f %.4f] "
              "target_pos=[%.4f %.4f %.4f]",
              offset_in_base.x(), offset_in_base.y(), offset_in_base.z(),
              target_position.x(), target_position.y(), target_position.z());

  // Reachability advisory — distance from base origin.
  double reach = std::sqrt(
    target_position.x() * target_position.x() +
    target_position.y() * target_position.y() +
    target_position.z() * target_position.z());

  if (reach > MAX_REACH_WARN_M)
  {
    RCLCPP_WARN(logger,
                "[buildPose] reach advisory: target %.3f m from base (> %.3f m). "
                "May be near envelope edge.",
                reach, MAX_REACH_WARN_M);
  }
  else if (reach < MIN_REACH_WARN_M)
  {
    RCLCPP_WARN(logger,
                "[buildPose] reach advisory: target %.3f m from base (< %.3f m). "
                "May be inside base dead-zone.",
                reach, MIN_REACH_WARN_M);
  }
  else
  {
    RCLCPP_INFO(logger,
                "[buildPose] reach_check ok: %.3f m from base", reach);
  }

  // Delta from current EE to target — big jumps often break Pilz LIN.
  {
    const auto& ee_pos = tf_base_to_ee.getOrigin();
    double dx = target_position.x() - ee_pos.x();
    double dy = target_position.y() - ee_pos.y();
    double dz = target_position.z() - ee_pos.z();
    double dist = std::sqrt(dx * dx + dy * dy + dz * dz);
    RCLCPP_INFO(logger,
                "[buildPose] delta_from_current_ee=[%.4f %.4f %.4f] |d|=%.4f m",
                dx, dy, dz, dist);
  }

  // ---- (D) Assemble: frame-relative position, current EE orientation ----
  geometry_msgs::msg::PoseStamped pose;
  pose.header.frame_id = BASE;
  pose.header.stamp = node_->now();

  pose.pose.position.x = target_position.x();
  pose.pose.position.y = target_position.y();
  pose.pose.position.z = target_position.z();

  pose.pose.orientation = tf2::toMsg(current_ee_orientation);

  RCLCPP_INFO(logger,
              "[buildPose] === FINAL TARGET === "
              "pos=[%.6f %.6f %.6f] quat=[%.6f %.6f %.6f %.6f]",
              pose.pose.position.x,
              pose.pose.position.y,
              pose.pose.position.z,
              pose.pose.orientation.x,
              pose.pose.orientation.y,
              pose.pose.orientation.z,
              pose.pose.orientation.w);

  return pose;
}

BT::NodeStatus PilzMotionPlanner::onStart()
{
  // Read inputs
  getInput("frame", frame_);
  getInput("planner_id", planner_id_);
  getInput("max_vel", max_vel_);
  getInput("max_acc", max_acc_);

  getInput("x", x_);
  getInput("y", y_);
  getInput("z", z_);

  getInput("r", r_);
  getInput("p", p_);
  getInput("w", w_);

  RCLCPP_INFO(node_->get_logger(),
              "[onStart] frame=%s planner=%s vel=%.2f acc=%.2f "
              "xyz=[%.4f %.4f %.4f] rpw=[%.2f %.2f %.2f] (rpw IGNORED)",
              frame_.c_str(), planner_id_.c_str(),
              max_vel_, max_acc_,
              x_, y_, z_, r_, p_, w_);

  move_group_->setPlannerId(planner_id_);
  move_group_->setMaxVelocityScalingFactor(max_vel_);
  move_group_->setMaxAccelerationScalingFactor(max_acc_);

  geometry_msgs::msg::PoseStamped pose;

  try
  {
    pose = buildPose();
  }
  catch (const std::exception& e)
  {
    RCLCPP_ERROR(node_->get_logger(), "[onStart] TF error: %s", e.what());
    return BT::NodeStatus::FAILURE;
  }

  // ---------- Pre-flight 1: zero-distance move short-circuit ----------
  try
  {
    auto ee_msg_now = tf_buffer_->lookupTransform(
      BASE, EE, tf2::TimePointZero, tf2::durationFromSec(1.0));

    tf2::Transform tf_ee_now;
    tf2::fromMsg(ee_msg_now.transform, tf_ee_now);

    double dx = pose.pose.position.x - tf_ee_now.getOrigin().x();
    double dy = pose.pose.position.y - tf_ee_now.getOrigin().y();
    double dz = pose.pose.position.z - tf_ee_now.getOrigin().z();
    double pos_delta = std::sqrt(dx * dx + dy * dy + dz * dz);

    tf2::Quaternion q_target;
    tf2::fromMsg(pose.pose.orientation, q_target);
    q_target.normalize();
    tf2::Quaternion q_now = tf_ee_now.getRotation();
    q_now.normalize();
    double ang_delta = q_now.angleShortestPath(q_target);

    if (pos_delta < ZERO_MOVE_POS_TOL_M && ang_delta < ZERO_MOVE_ANG_TOL_RAD)
    {
      RCLCPP_WARN(node_->get_logger(),
        "[onStart] SHORT-CIRCUIT — already at target "
        "(Δpos=%.4f mm, Δang=%.3f deg). Skipping Pilz plan; returning SUCCESS. "
        "Check your BT: this move is redundant.",
        pos_delta * 1000.0, ang_delta * 180.0 / M_PI);

      // Fake a completed future so onRunning() returns SUCCESS cleanly.
      std::promise<bool> p;
      p.set_value(true);
      exec_future_ = p.get_future();
      return BT::NodeStatus::RUNNING;
    }

    RCLCPP_INFO(node_->get_logger(),
                "[onStart] pre-flight: real move Δpos=%.4f mm Δang=%.3f deg",
                pos_delta * 1000.0, ang_delta * 180.0 / M_PI);
  }
  catch (const std::exception& e)
  {
    RCLCPP_WARN(node_->get_logger(),
                "[onStart] pre-flight zero-distance check TF error: %s "
                "(continuing anyway)", e.what());
  }

  // ---------- Pre-flight 2: wrist singularity in seed ----------
  {
    auto current_state = move_group_->getCurrentState(1.0);
    if (current_state)
    {
      std::vector<double> joints;
      current_state->copyJointGroupPositions(GROUP, joints);
      if (joints.size() >= 5)
      {
        double j5_deg = std::abs(joints[4]) * 180.0 / M_PI;
        if (j5_deg < WRIST_SINGULARITY_DEG)
        {
          RCLCPP_ERROR(node_->get_logger(),
            "[onStart] *** WRIST SINGULARITY *** joint5=%.3f deg "
            "(|j5| < %.1f). Pilz %s from this seed will very likely fail "
            "with NO_IK_SOLUTION. Fix upstream: previous move should not "
            "park robot at j5≈0.",
            joints[4] * 180.0 / M_PI, WRIST_SINGULARITY_DEG,
            planner_id_.c_str());
        }
      }
    }
    else
    {
      RCLCPP_WARN(node_->get_logger(),
                  "[onStart] pre-flight singularity check: getCurrentState null");
    }
  }

  // ---------- Launch execution in background thread with SMART retry ----------
  exec_future_ = std::async(std::launch::async, [this, pose]()
  {
    auto logger = node_->get_logger();
    moveit::planning_interface::MoveGroupInterface::Plan plan;
    const int max_attempts = 3;

    for (int attempt = 0; attempt < max_attempts; ++attempt)
    {
      if (attempt > 0)
      {
        RCLCPP_WARN(logger,
                    "[plan] retry %d/%d frame=%s planner=%s",
                    attempt, max_attempts - 1,
                    frame_.c_str(), planner_id_.c_str());
        std::this_thread::sleep_for(150ms);
      }

      // Drain /joint_states callbacks
      rclcpp::spin_some(node_);
      std::this_thread::sleep_for(30ms);
      rclcpp::spin_some(node_);

      // Log current joint state right before plan
      auto current_state = move_group_->getCurrentState(1.0);
      if (current_state)
      {
        std::vector<double> joints;
        current_state->copyJointGroupPositions(GROUP, joints);
        std::string js = "[";
        for (size_t i = 0; i < joints.size(); ++i)
        {
          char buf[32];
          std::snprintf(buf, sizeof(buf), "%.3f%s",
                        joints[i] * 180.0 / M_PI,
                        (i + 1 < joints.size()) ? " " : "");
          js += buf;
        }
        js += "] deg";
        RCLCPP_INFO(logger, "[plan] seed joint state = %s", js.c_str());
      }
      else
      {
        RCLCPP_WARN(logger, "[plan] getCurrentState returned null — stale monitor?");
      }

      // Clear any lingering state from previous calls
      move_group_->clearPathConstraints();
      move_group_->clearPoseTargets();

      move_group_->setStartStateToCurrentState();
      move_group_->setPoseTarget(pose, EE);

      RCLCPP_INFO(logger,
                  "[plan] calling plan() attempt=%d planner=%s",
                  attempt, planner_id_.c_str());

      auto plan_code = move_group_->plan(plan);
      if (plan_code != moveit::core::MoveItErrorCode::SUCCESS)
      {
        RCLCPP_ERROR(logger,
                     "[plan] FAILED code=%d (%s) attempt=%d frame=%s",
                     plan_code.val, moveitErrorName(plan_code.val),
                     attempt, frame_.c_str());

        if (isDeterministicFailure(plan_code.val))
        {
          RCLCPP_ERROR(logger,
                       "[plan] deterministic failure — aborting retries. "
                       "Retrying will not help; check target reachability, "
                       "calibration frame orientation, or wrist singularity.");
          return false;
        }
        continue;
      }

      RCLCPP_INFO(logger,
                  "[plan] plan() SUCCESS — %zu waypoints, executing…",
                  plan.trajectory_.joint_trajectory.points.size());

      auto exec_code = move_group_->execute(plan);
      if (exec_code == moveit::core::MoveItErrorCode::SUCCESS)
      {
        if (attempt > 0)
        {
          RCLCPP_INFO(logger,
                      "[plan] recovered on attempt %d frame=%s",
                      attempt, frame_.c_str());
        }
        RCLCPP_INFO(logger,
                    "[plan] execute() SUCCESS frame=%s", frame_.c_str());
        return true;
      }

      RCLCPP_ERROR(logger,
                   "[plan] execute() FAILED code=%d (%s) attempt=%d frame=%s",
                   exec_code.val, moveitErrorName(exec_code.val),
                   attempt, frame_.c_str());
    }

    RCLCPP_ERROR(node_->get_logger(),
                 "[plan] exhausted all %d retries for frame=%s",
                 max_attempts, frame_.c_str());
    return false;
  });

  return BT::NodeStatus::RUNNING;
}

BT::NodeStatus PilzMotionPlanner::onRunning()
{
  if (!exec_future_.valid())
  {
    RCLCPP_ERROR(node_->get_logger(), "[onRunning] future invalid");
    return BT::NodeStatus::FAILURE;
  }

  auto status = exec_future_.wait_for(std::chrono::milliseconds(0));

  if (status == std::future_status::ready)
  {
    bool result = exec_future_.get();
    RCLCPP_INFO(node_->get_logger(),
                "[onRunning] future ready — %s",
                result ? "SUCCESS" : "FAILURE");
    return result ? BT::NodeStatus::SUCCESS : BT::NodeStatus::FAILURE;
  }

  return BT::NodeStatus::RUNNING;
}

void PilzMotionPlanner::onHalted()
{
  RCLCPP_WARN(node_->get_logger(), "[onHalted] motion halted (waiting for future)");
  if (exec_future_.valid())
  {
    exec_future_.wait();
  }
}