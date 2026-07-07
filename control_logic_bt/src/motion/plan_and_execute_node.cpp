#include "control_logic_bt/motion/plan_and_execute_node.hpp"

using namespace BT;

PlanAndExecutePoseHybrid::PlanAndExecutePoseHybrid(const std::string& name, const NodeConfiguration& config)
  : StatefulActionNode(name, config), speed_factor_(1.0), accel_factor_(1.0)
{
  node_ = rclcpp::Node::make_shared("bt_plan_execute_pose_yaml");
  move_group_ = std::make_shared<moveit::planning_interface::MoveGroupInterface>(node_, "robot_manipulator");

  // -------------------------------------------------------------------
  // CRITICAL: spin the node in a background thread.
  //
  // MoveGroupInterface relies on its node being spun so that the
  // CurrentStateMonitor receives /joint_states messages. This node was
  // NEVER spun, so getCurrentState() always timed out after its full
  // 2-second wait -> that timeout was the entire "cart=true is slow" delay.
  // With a live spinning executor, getCurrentState() returns immediately
  // with the real pose, removing the delay AND giving Cartesian planning a
  // correct seed (which also fixes the IK-jump stutter at the source).
  // -------------------------------------------------------------------
  executor_ = std::make_shared<rclcpp::executors::SingleThreadedExecutor>();
  executor_->add_node(node_);
  spin_thread_ = std::thread([this]() { executor_->spin(); });

  loadJointTargetsFromYaml("/home/nextup/NextupRobot/src/active_project_configs/planning_data/points.yaml");
}

PlanAndExecutePoseHybrid::~PlanAndExecutePoseHybrid()
{
  if (executor_)
  {
    executor_->cancel();
  }
  if (spin_thread_.joinable())
  {
    spin_thread_.join();
  }
}

PortsList PlanAndExecutePoseHybrid::providedPorts()
{
  return {
    InputPort<std::string>("pose_goal"),
    InputPort<bool>("cart"),
    InputPort<double>("speed_factor"),
    InputPort<double>("acceleration")   // NEW: acceleration scaling factor
  };
}

void PlanAndExecutePoseHybrid::reset()
{
  current_state_ = State::IDLE;
  halt_requested_ = false;
  planning_future_ = std::shared_future<bool>();
  execution_future_ = std::shared_future<bool>();
}

NodeStatus PlanAndExecutePoseHybrid::onStart()
{
  // Reset state for new execution
  reset();

  // Get pose_goal input
  if (!getInput("pose_goal", current_target_name_) || current_target_name_.empty())
  {
    RCLCPP_ERROR(node_->get_logger(), "Missing or empty pose_goal input");
    return NodeStatus::FAILURE;
  }

  // Get cartesian motion flag
  if (!getInput("cart", use_cartesian_))
  {
    use_cartesian_ = false; // Default to joint space
  }

  // Get speed factor input
  if (!getInput("speed_factor", speed_factor_))
  {
    speed_factor_ = 1.0; // Default speed
  }

  // Get acceleration factor input (NEW)
  if (!getInput("acceleration", accel_factor_))
  {
    accel_factor_ = 1.0; // Default acceleration
  }

  // Clamp both factors to a sane range
  speed_factor_ = std::max(0.01, std::min(1.0, speed_factor_));
  accel_factor_ = std::max(0.01, std::min(1.0, accel_factor_));

  // Find the joint target for the given pose_goal
  auto it = joint_targets_.find(current_target_name_);
  if (it == joint_targets_.end())
  {
    RCLCPP_ERROR(node_->get_logger(), "Target '%s' not found in YAML", current_target_name_.c_str());
    return NodeStatus::FAILURE;
  }

  current_joint_values_ = it->second;

  RCLCPP_INFO(node_->get_logger(),
              "[%s] Starting: target='%s', cart=%s, speed=%.2f, accel=%.2f",
              name().c_str(),
              current_target_name_.c_str(),
              use_cartesian_ ? "true" : "false",
              speed_factor_,
              accel_factor_);

  // Start async planning based on motion type
  bool planning_started = false;

  if (use_cartesian_)
  {
    planning_started = planCartesianSpace(current_joint_values_, eef_step_, speed_factor_, accel_factor_);
    if (planning_started)
    {
      current_state_ = State::PLANNING_CARTESIAN;
      RCLCPP_INFO(node_->get_logger(), "[%s] Cartesian planning started", name().c_str());
    }
  }
  else
  {
    planning_started = planJointSpace(current_joint_values_, speed_factor_, accel_factor_);
    if (planning_started)
    {
      current_state_ = State::PLANNING_JOINT;
      RCLCPP_INFO(node_->get_logger(), "[%s] Joint-space planning started", name().c_str());
    }
  }

  if (!planning_started)
  {
    RCLCPP_ERROR(node_->get_logger(), "[%s] Failed to start planning", name().c_str());
    current_state_ = State::IDLE;
    return NodeStatus::FAILURE;
  }

  return NodeStatus::RUNNING;
}

NodeStatus PlanAndExecutePoseHybrid::onRunning()
{
  switch (current_state_)
  {
    case State::PLANNING_JOINT:
    case State::PLANNING_CARTESIAN:
    {
      // Check if planning is complete
      if (!planning_future_.valid())
      {
        RCLCPP_ERROR(node_->get_logger(), "[%s] Planning future invalid", name().c_str());
        current_state_ = State::IDLE;
        return NodeStatus::FAILURE;
      }

      auto status = planning_future_.wait_for(std::chrono::milliseconds(0));
      if (status == std::future_status::ready)
      {
        bool plan_success = false;
        try
        {
          plan_success = planning_future_.get();
        }
        catch (const std::exception& e)
        {
          RCLCPP_ERROR(node_->get_logger(), "[%s] Planning exception: %s", name().c_str(), e.what());
          current_state_ = State::IDLE;
          return NodeStatus::FAILURE;
        }

        if (plan_success)
        {
          RCLCPP_INFO(node_->get_logger(), "[%s] Planning successful, starting execution", name().c_str());

          // Start execution
          if (executePlan())
          {
            current_state_ = State::EXECUTING;
            return NodeStatus::RUNNING;
          }
          else
          {
            RCLCPP_ERROR(node_->get_logger(), "[%s] Failed to start execution", name().c_str());
            current_state_ = State::IDLE;
            return NodeStatus::FAILURE;
          }
        }
        else
        {
          RCLCPP_ERROR(node_->get_logger(), "[%s] Planning failed", name().c_str());
          current_state_ = State::IDLE;
          return NodeStatus::FAILURE;
        }
      }

      // Still planning
      return NodeStatus::RUNNING;
    }

    case State::EXECUTING:
    {
      // Check if execution is complete
      if (!execution_future_.valid())
      {
        RCLCPP_ERROR(node_->get_logger(), "[%s] Execution future invalid", name().c_str());
        current_state_ = State::IDLE;
        return NodeStatus::FAILURE;
      }

      auto status = execution_future_.wait_for(std::chrono::milliseconds(0));
      if (status == std::future_status::ready)
      {
        bool exec_success = false;
        try
        {
          exec_success = execution_future_.get();
        }
        catch (const std::exception& e)
        {
          RCLCPP_ERROR(node_->get_logger(), "[%s] Execution exception: %s", name().c_str(), e.what());
          current_state_ = State::IDLE;
          return NodeStatus::FAILURE;
        }

        current_state_ = State::IDLE;

        if (exec_success)
        {
          RCLCPP_INFO(node_->get_logger(), "[%s] Motion completed successfully", name().c_str());
          return NodeStatus::SUCCESS;
        }
        else
        {
          RCLCPP_ERROR(node_->get_logger(), "[%s] Execution failed", name().c_str());
          return NodeStatus::FAILURE;
        }
      }

      // Still executing
      return NodeStatus::RUNNING;
    }

    default:
      RCLCPP_ERROR(node_->get_logger(), "[%s] Invalid state", name().c_str());
      current_state_ = State::IDLE;
      return NodeStatus::FAILURE;
  }
}

void PlanAndExecutePoseHybrid::onHalted()
{
  RCLCPP_WARN(node_->get_logger(),
              "[%s] Halt requested during state: %d — finishing current motion first",
              name().c_str(), static_cast<int>(current_state_));

  halt_requested_ = true;

  // If the robot is currently executing, let it finish the path.
  // We block here until the execution future completes, instead of calling stop().
  if (current_state_ == State::EXECUTING && execution_future_.valid())
  {
    RCLCPP_INFO(node_->get_logger(),
                "[%s] Waiting for in-flight execution to complete before halt...", name().c_str());
    try
    {
      execution_future_.wait();   // blocks until robot reaches target
      execution_future_.get();    // consume result / swallow exception
    }
    catch (const std::exception& e)
    {
      RCLCPP_WARN(node_->get_logger(), "[%s] Execution finished with exception during halt: %s",
                  name().c_str(), e.what());
    }
    RCLCPP_INFO(node_->get_logger(), "[%s] Execution complete, halt proceeding", name().c_str());
  }
  // If we are only planning, nothing is moving yet — safe to drop immediately.
  else if ((current_state_ == State::PLANNING_JOINT || current_state_ == State::PLANNING_CARTESIAN))
  {
    RCLCPP_INFO(node_->get_logger(), "[%s] Halt during planning (nothing moving) — dropping plan", name().c_str());
    if (planning_future_.valid())
    {
      try { planning_future_.wait(); planning_future_.get(); } catch (...) {}
    }
    if (move_group_)
    {
      move_group_->clearPoseTargets();
    }
  }

  // Clean up futures
  planning_future_ = std::shared_future<bool>();
  execution_future_ = std::shared_future<bool>();

  current_state_ = State::IDLE;
}

bool PlanAndExecutePoseHybrid::planJointSpace(const std::vector<double>& joint_values,
                                              double speed_factor, double accel_factor)
{
  // Set the joint values as the target
  if (!move_group_->setJointValueTarget(joint_values))
  {
    RCLCPP_ERROR(node_->get_logger(), "[%s] Failed to set joint value target", name().c_str());
    return false;
  }

  // CRITICAL: apply scaling BEFORE plan() so it bakes into the trajectory's
  // time parameterization. Velocity AND acceleration are now both applied.
  move_group_->setMaxVelocityScalingFactor(speed_factor);
  move_group_->setMaxAccelerationScalingFactor(accel_factor);

  // Start async planning
  planning_future_ = std::async(std::launch::async, [this]() -> bool {
    moveit::planning_interface::MoveGroupInterface::Plan plan;
    bool success = (move_group_->plan(plan) == moveit::core::MoveItErrorCode::SUCCESS);

    if (!success)
    {
      RCLCPP_ERROR(node_->get_logger(), "[%s] Joint-space planning failed", name().c_str());
      return false;
    }

    // Store the plan (already time-parameterized with the correct speed/accel)
    stored_plan_ = plan;

    RCLCPP_INFO(node_->get_logger(), "[%s] Joint-space plan created successfully", name().c_str());
    return true;
  });

  return true;
}

bool PlanAndExecutePoseHybrid::planCartesianSpace(const std::vector<double>& joint_values,
                                                  double eef_step, double speed_factor, double accel_factor)
{
  // Start async planning
  planning_future_ = std::async(std::launch::async, [this, joint_values, eef_step, speed_factor, accel_factor]() -> bool {
    const auto robot_model = move_group_->getRobotModel();
    const auto* jmg = robot_model->getJointModelGroup(move_group_->getName());
    if (!jmg)
    {
      RCLCPP_ERROR(node_->get_logger(), "[%s] JointModelGroup not found", name().c_str());
      return false;
    }

    // ---- Current state is now reliably available (node is spinning) ----
    // With the background executor running, getCurrentState() returns the real
    // pose immediately instead of timing out after 2 s. This both removes the
    // delay and gives the Cartesian seed the correct start, fixing IK jumps.
    auto current = move_group_->getCurrentState(1.0);
    if (!current)
    {
      RCLCPP_ERROR(node_->get_logger(),
                   "[%s] No current robot state — aborting cartesian plan", name().c_str());
      return false;
    }

    // FK from joint target (start from the REAL current state)
    moveit::core::RobotState rs(*current);
    rs.setJointGroupPositions(jmg, joint_values);
    rs.update();

    std::string ee_link = move_group_->getEndEffectorLink();
    if (ee_link.empty())
    {
      const auto& links = jmg->getLinkModelNames();
      if (links.empty())
      {
        RCLCPP_ERROR(node_->get_logger(), "[%s] No end-effector link found", name().c_str());
        return false;
      }
      ee_link = links.back();
    }

    Eigen::Isometry3d tf = rs.getGlobalLinkTransform(ee_link);

    geometry_msgs::msg::Pose target_pose;
    target_pose.position.x = tf.translation().x();
    target_pose.position.y = tf.translation().y();
    target_pose.position.z = tf.translation().z();
    Eigen::Quaterniond q(tf.rotation());
    target_pose.orientation.x = q.x();
    target_pose.orientation.y = q.y();
    target_pose.orientation.z = q.z();
    target_pose.orientation.w = q.w();

    // Seed the planner from the real current state.
    move_group_->setStartState(*current);

    std::vector<geometry_msgs::msg::Pose> waypoints{target_pose};
    moveit_msgs::msg::RobotTrajectory traj_msg;

    // jump_threshold = 1.5 (was 0.0). 0.0 disabled jump detection and let
    // configuration jumps through. A positive value rejects discontinuous paths.
    const double jump_threshold = 1.5;
    double fraction = move_group_->computeCartesianPath(
        waypoints, eef_step, jump_threshold, traj_msg);

    if (fraction < 1.0)
    {
      RCLCPP_WARN(node_->get_logger(),
                  "[%s] Cartesian fraction %.3f < 1.0 (config jump or unreachable straight line)",
                  name().c_str(), fraction);
      return false;
    }

    // ---- Proper time parameterization via TOTG (vel + accel scaling) ----
    robot_trajectory::RobotTrajectory rt(robot_model, jmg->getName());
    rt.setRobotTrajectoryMsg(*current, traj_msg);

    trajectory_processing::TimeOptimalTrajectoryGeneration totg(
        0.1 /* path_tolerance */, 0.01 /* resample_dt */, 0.001 /* min_angle_change */);

    // Both velocity and acceleration scaling are now passed.
    bool timed = totg.computeTimeStamps(rt, speed_factor, accel_factor);
    if (!timed)
    {
      RCLCPP_ERROR(node_->get_logger(),
                   "[%s] TOTG time parameterization failed", name().c_str());
      return false;
    }

    moveit_msgs::msg::RobotTrajectory timed_msg;
    rt.getRobotTrajectoryMsg(timed_msg);

    stored_plan_.trajectory_ = timed_msg;

    RCLCPP_INFO(node_->get_logger(),
                "[%s] Cartesian plan created (TOTG, speed=%.2f, accel=%.2f)",
                name().c_str(), speed_factor, accel_factor);
    return true;
  });

  return true;
}

bool PlanAndExecutePoseHybrid::executePlan()
{
  if (!move_group_)
  {
    RCLCPP_ERROR(node_->get_logger(), "[%s] MoveGroup is null", name().c_str());
    return false;
  }

  // NOTE: speed/accel scaling is baked in at plan time for both paths.

  // Start async execution
  execution_future_ = std::async(std::launch::async, [this]() -> bool {
    bool executed = (move_group_->execute(stored_plan_) == moveit::core::MoveItErrorCode::SUCCESS);
    if (!executed)
    {
      RCLCPP_ERROR(node_->get_logger(), "[%s] Execution failed", name().c_str());
    }
    return executed;
  });

  return true;
}

void PlanAndExecutePoseHybrid::loadJointTargetsFromYaml(const std::string& filepath)
{
  try
  {
    YAML::Node root = YAML::LoadFile(filepath);

    YAML::Node points;

    // Case 1: root is a sequence
    if (root.IsSequence())
    {
      points = root;
    }
    // Case 2: root is a map with "points"
    else if (root.IsMap() && root["points"])
    {
      points = root["points"];
    }
    else
    {
      RCLCPP_ERROR(node_->get_logger(),
                   "Invalid YAML format: root is neither a sequence nor contains 'points'");
      return;
    }

    for (const auto& point : points)
    {
      // ---- name ----
      if (!point["name"])
      {
        RCLCPP_WARN(node_->get_logger(), "Skipping point without name");
        continue;
      }

      std::string name = point["name"].as<std::string>();

      // ---- joints ----
      if (!point["joints_values"])
      {
        RCLCPP_WARN(node_->get_logger(),
                    "Skipping '%s' (no joints_values key)", name.c_str());
        continue;
      }

      const YAML::Node& joint_node = point["joints_values"];

      std::vector<double> joints;
      try
      {
        joints = {
          joint_node["joint1"].as<double>(),
          joint_node["joint2"].as<double>(),
          joint_node["joint3"].as<double>(),
          joint_node["joint4"].as<double>(),
          joint_node["joint5"].as<double>(),
          joint_node["joint6"].as<double>()
        };
      }
      catch (...)
      {
        RCLCPP_ERROR(node_->get_logger(),
                     "Invalid joint values for '%s'", name.c_str());
        continue;
      }

      joint_targets_[name] = joints;
    }

    RCLCPP_INFO(node_->get_logger(),
                "Loaded %zu valid joint targets from YAML",
                joint_targets_.size());
  }
  catch (const std::exception& e)
  {
    RCLCPP_ERROR(node_->get_logger(),
                 "YAML load error: %s", e.what());
  }
}