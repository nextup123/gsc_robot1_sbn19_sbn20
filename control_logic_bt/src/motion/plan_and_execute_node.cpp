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
  // CurrentStateMonitor receives /joint_states messages. Without this,
  // getCurrentState() times out after its full 2-second wait. The same
  // executor also drives our own /joint_states subscription below, which
  // feeds the stall-detection watchdog.
  // -------------------------------------------------------------------
  joint_state_sub_ = node_->create_subscription<sensor_msgs::msg::JointState>(
      "/joint_states", rclcpp::SensorDataQoS(),
      std::bind(&PlanAndExecutePoseHybrid::jointStateCallback, this, std::placeholders::_1));

  executor_ = std::make_shared<rclcpp::executors::SingleThreadedExecutor>();
  executor_->add_node(node_);
  spin_thread_ = std::thread([this]() { executor_->spin(); });

  loadJointTargetsFromYaml("/home/nextup/NextupRobot/src/active_project_configs/planning_data/points.yaml");
}

PlanAndExecutePoseHybrid::~PlanAndExecutePoseHybrid()
{
  // Drain futures abandoned by a watchdog timeout. The destructor is the
  // only place where blocking is safe.
  {
    std::lock_guard<std::mutex> lk(abandoned_mutex_);
    for (auto& f : abandoned_futures_)
    {
      if (f.valid() && f.wait_for(std::chrono::seconds(3)) == std::future_status::ready)
      {
        try { f.get(); } catch (...) {}
      }
    }
    abandoned_futures_.clear();
  }

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
    InputPort<double>("acceleration")
  };
}

// ---------------------------------------------------------------------
// Progress tracking
// ---------------------------------------------------------------------

// Runs on the executor thread. Keep it cheap: snapshot positions only.
void PlanAndExecutePoseHybrid::jointStateCallback(const sensor_msgs::msg::JointState::SharedPtr msg)
{
  std::lock_guard<std::mutex> lk(js_mutex_);
  latest_positions_ = msg->position;
  have_joint_state_ = !latest_positions_.empty();
}

void PlanAndExecutePoseHybrid::resetProgressTracking()
{
  std::lock_guard<std::mutex> lk(js_mutex_);
  last_seen_positions_ = latest_positions_;
}

// Compares the newest joint-state snapshot against the last one this
// function saw. Returns true if ANY joint moved more than the epsilon.
//
// Speed-independent: a crawl still registers as motion, a stopped arm does
// not. This is what makes the watchdog immune to an external speed override.
bool PlanAndExecutePoseHybrid::armIsMoving()
{
  std::vector<double> now_positions;
  {
    std::lock_guard<std::mutex> lk(js_mutex_);
    if (!have_joint_state_) return false;
    now_positions = latest_positions_;
  }

  if (last_seen_positions_.size() != now_positions.size())
  {
    last_seen_positions_ = now_positions;
    return true;   // first sample or size change — treat as progress
  }

  bool moved = false;
  for (size_t i = 0; i < now_positions.size(); ++i)
  {
    if (std::fabs(now_positions[i] - last_seen_positions_[i]) > kMotionEpsilonRad)
    {
      moved = true;
      break;
    }
  }

  last_seen_positions_ = now_positions;
  return moved;
}

void PlanAndExecutePoseHybrid::reset()
{
  current_state_ = State::IDLE;
  halt_requested_ = false;
  planning_future_ = std::shared_future<bool>();
  execution_future_ = std::shared_future<bool>();
}

// Nominal trajectory duration in seconds, taken from the last point's
// time_from_start.
//
// NOTE: informational only. With an external speed override on the drives,
// real elapsed time is unrelated to this number, so it must NOT be used to
// size any deadline.
double PlanAndExecutePoseHybrid::trajectoryDuration() const
{
  const auto& pts = stored_plan_.trajectory_.joint_trajectory.points;
  if (pts.empty()) return 0.0;
  return rclcpp::Duration(pts.back().time_from_start).seconds();
}

// A timed-out async op may still be running. Park it for the destructor —
// joining it on the tick thread would reintroduce the freeze we are fixing.
void PlanAndExecutePoseHybrid::abandonInFlight()
{
  std::lock_guard<std::mutex> lk(abandoned_mutex_);
  if (planning_future_.valid())
  {
    abandoned_futures_.push_back(planning_future_);
    planning_future_ = std::shared_future<bool>();
  }
  if (execution_future_.valid())
  {
    abandoned_futures_.push_back(execution_future_);
    execution_future_ = std::shared_future<bool>();
  }
}

NodeStatus PlanAndExecutePoseHybrid::onStart()
{
  reset();

  if (!getInput("pose_goal", current_target_name_) || current_target_name_.empty())
  {
    RCLCPP_ERROR(node_->get_logger(), "Missing or empty pose_goal input");
    return NodeStatus::FAILURE;
  }

  if (!getInput("cart", use_cartesian_))
  {
    use_cartesian_ = false;
  }

  if (!getInput("speed_factor", speed_factor_))
  {
    speed_factor_ = 1.0;
  }

  if (!getInput("acceleration", accel_factor_))
  {
    accel_factor_ = 1.0;
  }

  speed_factor_ = std::max(0.01, std::min(1.0, speed_factor_));
  accel_factor_ = std::max(0.01, std::min(1.0, accel_factor_));

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

  phase_start_ = std::chrono::steady_clock::now();

  return NodeStatus::RUNNING;
}

NodeStatus PlanAndExecutePoseHybrid::onRunning()
{
  const auto now = std::chrono::steady_clock::now();

  switch (current_state_)
  {
    case State::PLANNING_JOINT:
    case State::PLANNING_CARTESIAN:
    {
      if (!planning_future_.valid())
      {
        RCLCPP_ERROR(node_->get_logger(), "[%s] Planning future invalid", name().c_str());
        current_state_ = State::IDLE;
        return NodeStatus::FAILURE;
      }

      // Planning watchdog: a wedged move_group would otherwise hang forever.
      // Planning time is unaffected by any drive-side speed override, so a
      // plain duration limit is valid here.
      const double planning_elapsed = std::chrono::duration<double>(now - phase_start_).count();
      if (planning_elapsed > kPlanTimeoutSec)
      {
        RCLCPP_ERROR(node_->get_logger(),
                     "[%s] Planning timed out after %.1f s (limit %.1f s) — failing so the tree can reset",
                     name().c_str(), planning_elapsed, kPlanTimeoutSec);
        abandonInFlight();
        if (move_group_) move_group_->clearPoseTargets();
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

          if (executePlan())
          {
            // -------------------------------------------------------------
            // EXECUTION WATCHDOG: stall detection only.
            //
            // There is deliberately NO duration-based deadline. The robot is
            // slowed by an external speed override applied at the controller
            // /drive level, so the trajectory's own time_from_start describes
            // a motion far shorter than what actually happens. Any deadline
            // derived from it false-trips, and no multiplier fixes that —
            // turn the override down further and the cap blows again.
            //
            // Instead: fail only when the arm has genuinely stopped moving
            // without MoveIt reporting completion. That covers the real
            // faults (drive fault, EtherCAT drop, wedged controller) and is
            // completely independent of commanded speed.
            // -------------------------------------------------------------
            const auto t0 = std::chrono::steady_clock::now();

            resetProgressTracking();
            exec_started_  = t0;
            last_progress_ = t0;

            RCLCPP_INFO(node_->get_logger(),
                        "[%s] Executing: nominal %.2f s (informational — external speed "
                        "override makes this an invalid deadline), stall timeout %.1f s",
                        name().c_str(), trajectoryDuration(), kStallTimeoutSec);

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

      return NodeStatus::RUNNING;
    }

    case State::EXECUTING:
    {
      if (!execution_future_.valid())
      {
        RCLCPP_ERROR(node_->get_logger(), "[%s] Execution future invalid", name().c_str());
        current_state_ = State::IDLE;
        return NodeStatus::FAILURE;
      }

      // ---- normal completion path ----
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

      // ---- stall detection ----
      // Armed only after a grace period, so the action-goal round-trip and
      // controller acceptance latency are not mistaken for a stall.
      if (armIsMoving())
      {
        last_progress_ = now;
      }

      const double since_start = std::chrono::duration<double>(now - exec_started_).count();
      if (since_start > kExecStartGraceSec)
      {
        const double stalled_for = std::chrono::duration<double>(now - last_progress_).count();
        if (stalled_for > kStallTimeoutSec)
        {
          RCLCPP_ERROR(node_->get_logger(),
                       "[%s] Arm has not moved for %.2f s while executing (limit %.1f s) — "
                       "drive fault / EtherCAT drop / stalled trajectory. "
                       "Stopping and failing so the tree can reset.",
                       name().c_str(), stalled_for, kStallTimeoutSec);

          if (move_group_)
          {
            try { move_group_->stop(); } catch (...) {}
          }

          abandonInFlight();
          current_state_ = State::IDLE;
          return NodeStatus::FAILURE;
        }
      }

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
  //
  // The wait is bounded by the SAME stall rule used during execution, not by
  // a duration. A slow move under an external override is never cut short;
  // a hardware fault still releases the halt within kStallTimeoutSec.
  if (current_state_ == State::EXECUTING && execution_future_.valid())
  {
    RCLCPP_INFO(node_->get_logger(),
                "[%s] Waiting for in-flight execution to complete before halt...", name().c_str());

    auto last_move = std::chrono::steady_clock::now();
    bool completed = false;

    while (true)
    {
      if (execution_future_.wait_for(std::chrono::milliseconds(50)) == std::future_status::ready)
      {
        completed = true;
        break;
      }

      const auto tnow = std::chrono::steady_clock::now();
      if (armIsMoving())
      {
        last_move = tnow;
      }

      if (std::chrono::duration<double>(tnow - last_move).count() > kStallTimeoutSec)
      {
        break;   // arm stopped but no result — hardware fault
      }
    }

    if (completed)
    {
      try
      {
        execution_future_.get();
      }
      catch (const std::exception& e)
      {
        RCLCPP_WARN(node_->get_logger(), "[%s] Execution finished with exception during halt: %s",
                    name().c_str(), e.what());
      }
      RCLCPP_INFO(node_->get_logger(), "[%s] Execution complete, halt proceeding", name().c_str());
    }
    else
    {
      RCLCPP_ERROR(node_->get_logger(),
                   "[%s] Arm stopped moving during halt without an execution result — "
                   "hardware fault. Stopping and abandoning.", name().c_str());
      if (move_group_)
      {
        try { move_group_->stop(); } catch (...) {}
      }
      abandonInFlight();
    }
  }
  // If we are only planning, nothing is moving yet — safe to drop immediately.
  else if ((current_state_ == State::PLANNING_JOINT || current_state_ == State::PLANNING_CARTESIAN))
  {
    RCLCPP_INFO(node_->get_logger(), "[%s] Halt during planning (nothing moving) — dropping plan", name().c_str());
    if (planning_future_.valid())
    {
      if (planning_future_.wait_for(std::chrono::duration<double>(kPlanTimeoutSec)) ==
          std::future_status::ready)
      {
        try { planning_future_.get(); } catch (...) {}
      }
      else
      {
        abandonInFlight();
      }
    }
    if (move_group_)
    {
      move_group_->clearPoseTargets();
    }
  }

  planning_future_ = std::shared_future<bool>();
  execution_future_ = std::shared_future<bool>();

  current_state_ = State::IDLE;
}

bool PlanAndExecutePoseHybrid::planJointSpace(const std::vector<double>& joint_values,
                                              double speed_factor, double accel_factor)
{
  if (!move_group_->setJointValueTarget(joint_values))
  {
    RCLCPP_ERROR(node_->get_logger(), "[%s] Failed to set joint value target", name().c_str());
    return false;
  }

  // CRITICAL: apply scaling BEFORE plan() so it bakes into the trajectory's
  // time parameterization.
  move_group_->setMaxVelocityScalingFactor(speed_factor);
  move_group_->setMaxAccelerationScalingFactor(accel_factor);

  planning_future_ = std::async(std::launch::async, [this]() -> bool {
    moveit::planning_interface::MoveGroupInterface::Plan plan;
    bool success = (move_group_->plan(plan) == moveit::core::MoveItErrorCode::SUCCESS);

    if (!success)
    {
      RCLCPP_ERROR(node_->get_logger(), "[%s] Joint-space planning failed", name().c_str());
      return false;
    }

    stored_plan_ = plan;

    RCLCPP_INFO(node_->get_logger(), "[%s] Joint-space plan created successfully", name().c_str());
    return true;
  });

  return true;
}

bool PlanAndExecutePoseHybrid::planCartesianSpace(const std::vector<double>& joint_values,
                                                  double eef_step, double speed_factor, double accel_factor)
{
  planning_future_ = std::async(std::launch::async, [this, joint_values, eef_step, speed_factor, accel_factor]() -> bool {
    const auto robot_model = move_group_->getRobotModel();
    const auto* jmg = robot_model->getJointModelGroup(move_group_->getName());
    if (!jmg)
    {
      RCLCPP_ERROR(node_->get_logger(), "[%s] JointModelGroup not found", name().c_str());
      return false;
    }

    // ---- Current state is reliably available (node is spinning) ----
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

    // jump_threshold = 1.5. A value of 0.0 would disable jump detection and
    // let configuration jumps through.
    const double jump_threshold = 2.5;
    double fraction = move_group_->computeCartesianPath(
        waypoints, eef_step, jump_threshold, traj_msg);

    if (fraction < 1.0)
    {
      RCLCPP_WARN(node_->get_logger(),
                  "[%s] Cartesian fraction %.3f < 1.0 (config jump or unreachable straight line)",
                  name().c_str(), fraction);
      return false;
    }

    // ---- Time parameterization via TOTG (vel + accel scaling) ----
    robot_trajectory::RobotTrajectory rt(robot_model, jmg->getName());
    rt.setRobotTrajectoryMsg(*current, traj_msg);

    trajectory_processing::TimeOptimalTrajectoryGeneration totg(
        0.1 /* path_tolerance */, 0.01 /* resample_dt */, 0.001 /* min_angle_change */);

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