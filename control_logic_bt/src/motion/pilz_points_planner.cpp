#include "control_logic_bt/motion/pilz_points_planner.hpp"

#include <algorithm>
#include <sstream>
#include <future>
#include <thread>

// -----------------------------------------------------------------------
// Constructor — node + move_group created once, reused across all ticks
// -----------------------------------------------------------------------
PilzPointsPlanner::PilzPointsPlanner(const std::string& name,
                                   const BT::NodeConfiguration& config)
    : BT::StatefulActionNode(name, config)
{
    node_ = rclcpp::Node::make_shared("bt_pilz_points_planner");

    move_group_ = std::make_shared<moveit::planning_interface::MoveGroupInterface>(
        node_, "robot_manipulator");

    move_group_->setPlanningPipelineId("pilz_industrial_motion_planner");
    move_group_->setPoseReferenceFrame(pose_reference_frame_);

    loadJointTargetsFromYaml(yaml_path_);

    // ---- Spin node_ continuously in the background ----
    // Required so that passive topic subscriptions (joint_states, used by
    // MoveGroupInterface's CurrentStateMonitor for getCurrentState()) are
    // actually serviced. plan()/execute() don't need this since they block-
    // spin internally while waiting on their action result, but
    // getCurrentState() does — without this thread it always times out.
    executor_ = std::make_shared<rclcpp::executors::SingleThreadedExecutor>();
    executor_->add_node(node_);
    spin_thread_ = std::thread([this]() { executor_->spin(); });

    // Warm up the current state monitor once at startup with a generous
    // timeout so the very first short-timeout cache-validation call later
    // doesn't race the first /joint_states message.
    auto warm_state = move_group_->getCurrentState(5.0);
    if (!warm_state)
    {
        RCLCPP_WARN(node_->get_logger(),
                    "[PilzPointsPlanner] Could not get initial robot state within 5s at startup — "
                    "check that /joint_states is publishing and reachable from this node.");
    }
}

// -----------------------------------------------------------------------
// Destructor — stop the background executor cleanly
// -----------------------------------------------------------------------
PilzPointsPlanner::~PilzPointsPlanner()
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

// -----------------------------------------------------------------------
// Ports
// -----------------------------------------------------------------------
BT::PortsList PilzPointsPlanner::providedPorts()
{
    return {
        BT::InputPort<std::string>("pose_goal"),   // point name, e.g. "home"
        BT::InputPort<std::string>("planner_id"),  // "PTP" or "LIN"
        BT::InputPort<double>("speed_factor"),     // 0.01 – 1.0
        BT::InputPort<double>("acceleration")      // 0.01 – 1.0
    };
}

// -----------------------------------------------------------------------
// onStart - Called when node becomes active
// -----------------------------------------------------------------------
BT::NodeStatus PilzPointsPlanner::onStart()
{
    // ---- Read ports (always, every activation) ----
    if (!getInput("pose_goal", current_pose_goal_) || current_pose_goal_.empty())
    {
        RCLCPP_ERROR(node_->get_logger(), "[PilzPointsPlanner] Missing pose_goal input");
        return BT::NodeStatus::FAILURE;
    }

    if (!getInput("planner_id", current_planner_id_) || current_planner_id_.empty())
    {
        RCLCPP_ERROR(node_->get_logger(), "[PilzPointsPlanner] Missing planner_id input");
        return BT::NodeStatus::FAILURE;
    }

    getInput("speed_factor", current_speed_factor_);
    current_speed_factor_ = std::max(0.01, std::min(1.0, current_speed_factor_));

    if (!getInput("acceleration", current_accel_factor_))
        current_accel_factor_ = 1.0;
    current_accel_factor_ = std::max(0.01, std::min(1.0, current_accel_factor_));

    std::transform(current_planner_id_.begin(), current_planner_id_.end(),
                   current_planner_id_.begin(), ::toupper);

    if (current_planner_id_ != "PTP" && current_planner_id_ != "LIN")
    {
        RCLCPP_ERROR(node_->get_logger(),
                     "[PilzPointsPlanner] Unknown planner_id '%s' (expected PTP or LIN)",
                     current_planner_id_.c_str());
        return BT::NodeStatus::FAILURE;
    }

    // ---- Look up joint target ----
    auto it = joint_targets_.find(current_pose_goal_);
    if (it == joint_targets_.end())
    {
        RCLCPP_ERROR(node_->get_logger(),
                     "[PilzPointsPlanner] Target '%s' not found in YAML", current_pose_goal_.c_str());
        return BT::NodeStatus::FAILURE;
    }

    current_target_ = it->second;

    // -------------------------------------------------------------------
    // Reuse cache only if it's the same request AND the robot's actual
    // current joint state still matches the cached plan's expected start.
    // -------------------------------------------------------------------
    const bool same_request = has_planned_ &&
        cached_pose_goal_    == current_pose_goal_ &&
        cached_planner_id_   == current_planner_id_ &&
        std::abs(cached_speed_factor_ - current_speed_factor_) < 1e-6 &&
        std::abs(cached_accel_factor_ - current_accel_factor_) < 1e-6;

    if (same_request && cachedPlanStartMatchesCurrentState(kCacheStartTolerance))
    {
        RCLCPP_INFO(node_->get_logger(),
                    "[PilzPointsPlanner] Reusing cached plan for '%s' (%s) — start state matches, no re-planning",
                    current_pose_goal_.c_str(), current_planner_id_.c_str());

        stored_plan_ = cached_plan_;

        if (!startExecution())
        {
            current_state_ = State::IDLE;
            return BT::NodeStatus::FAILURE;
        }

        current_state_ = (current_planner_id_ == "PTP")
                         ? State::EXECUTING_PTP : State::EXECUTING_LIN;
        return BT::NodeStatus::RUNNING;
    }

    if (has_planned_ && same_request)
    {
        RCLCPP_WARN(node_->get_logger(),
                    "[PilzPointsPlanner] Cached plan for '%s' is stale — re-planning from actual current state.",
                    current_pose_goal_.c_str());
    }

    RCLCPP_INFO(node_->get_logger(),
                "[PilzPointsPlanner] Starting '%s' via %s at speed %.2f, accel %.2f",
                current_pose_goal_.c_str(), current_planner_id_.c_str(),
                current_speed_factor_, current_accel_factor_);

    bool planning_started = false;
    if (current_planner_id_ == "PTP")
    {
        planning_started = startPTPPlanning(current_target_, current_speed_factor_, current_accel_factor_);
        if (planning_started)
            current_state_ = State::PLANNING_PTP;
    }
    else
    {
        planning_started = startLINPlanning(current_target_, current_speed_factor_, current_accel_factor_);
        if (planning_started)
            current_state_ = State::PLANNING_LIN;
    }

    if (!planning_started)
    {
        current_state_ = State::IDLE;
        return BT::NodeStatus::FAILURE;
    }

    return BT::NodeStatus::RUNNING;
}

// -----------------------------------------------------------------------
// onRunning - Called each tick while RUNNING
// -----------------------------------------------------------------------
BT::NodeStatus PilzPointsPlanner::onRunning()
{
    switch (current_state_)
    {
        case State::PLANNING_PTP:
        case State::PLANNING_LIN:
        {
            if (!planning_future_.valid())
            {
                RCLCPP_ERROR(node_->get_logger(),
                             "[PilzPointsPlanner] Planning future invalid — FAILURE");
                current_state_ = State::IDLE;
                return BT::NodeStatus::FAILURE;
            }

            auto status = planning_future_.wait_for(std::chrono::milliseconds(0));
            if (status != std::future_status::ready)
                return BT::NodeStatus::RUNNING;

            bool planned = false;
            try
            {
                planned = planning_future_.get();
            }
            catch (const std::exception& e)
            {
                RCLCPP_ERROR(node_->get_logger(),
                             "[PilzPointsPlanner] Planning exception: %s", e.what());
                planned = false;
            }

            if (!planned)
            {
                RCLCPP_ERROR(node_->get_logger(),
                             "[PilzPointsPlanner] Planning did not succeed — FAILURE");
                current_state_ = State::IDLE;
                return BT::NodeStatus::FAILURE;
            }

            RCLCPP_INFO(node_->get_logger(),
                        "[PilzPointsPlanner] Planning complete, starting execution");

            cached_plan_          = stored_plan_;
            cached_pose_goal_     = current_pose_goal_;
            cached_planner_id_    = current_planner_id_;
            cached_speed_factor_  = current_speed_factor_;
            cached_accel_factor_  = current_accel_factor_;
            has_planned_          = true;

            if (!startExecution())
            {
                current_state_ = State::IDLE;
                return BT::NodeStatus::FAILURE;
            }

            current_state_ = (current_planner_id_ == "PTP")
                             ? State::EXECUTING_PTP : State::EXECUTING_LIN;
            return BT::NodeStatus::RUNNING;
        }

        case State::EXECUTING_PTP:
        case State::EXECUTING_LIN:
        {
            if (!execution_future_.valid())
            {
                RCLCPP_ERROR(node_->get_logger(),
                             "[PilzPointsPlanner] Execution future invalid — FAILURE");
                current_state_ = State::IDLE;
                return BT::NodeStatus::FAILURE;
            }

            auto status = execution_future_.wait_for(std::chrono::milliseconds(0));
            if (status != std::future_status::ready)
                return BT::NodeStatus::RUNNING;

            bool ok = false;
            try
            {
                ok = execution_future_.get();
            }
            catch (const std::exception& e)
            {
                RCLCPP_ERROR(node_->get_logger(),
                             "[PilzPointsPlanner] Execution exception: %s", e.what());
                ok = false;
            }

            current_state_ = State::IDLE;

            if (!ok)
            {
                RCLCPP_ERROR(node_->get_logger(),
                             "[PilzPointsPlanner] Execution did not complete successfully — FAILURE");
                return BT::NodeStatus::FAILURE;
            }

            RCLCPP_INFO(node_->get_logger(), "[PilzPointsPlanner] Execution complete");
            return BT::NodeStatus::SUCCESS;
        }

        default:
            RCLCPP_ERROR(node_->get_logger(), "[PilzPointsPlanner] Invalid state");
            current_state_ = State::IDLE;
            return BT::NodeStatus::FAILURE;
    }
}

// -----------------------------------------------------------------------
// onHalted - Called when tree is halted/cancelled
// -----------------------------------------------------------------------
void PilzPointsPlanner::onHalted()
{
    RCLCPP_WARN(node_->get_logger(), "[PilzPointsPlanner] Halted during %s — letting motion finish",
                current_state_ == State::IDLE ? "IDLE" :
                (current_state_ == State::PLANNING_PTP || current_state_ == State::PLANNING_LIN) ? "PLANNING" : "EXECUTING");

    if ((current_state_ == State::EXECUTING_PTP || current_state_ == State::EXECUTING_LIN)
        && execution_future_.valid())
    {
        RCLCPP_INFO(node_->get_logger(),
                    "[PilzPointsPlanner] Waiting for in-flight execution to complete before halt...");
        try
        {
            execution_future_.wait();
            execution_future_.get();
        }
        catch (const std::exception& e)
        {
            RCLCPP_WARN(node_->get_logger(),
                        "[PilzPointsPlanner] Execution finished with exception during halt: %s", e.what());
        }
        RCLCPP_INFO(node_->get_logger(), "[PilzPointsPlanner] Execution complete, halt proceeding");
    }
    else if ((current_state_ == State::PLANNING_PTP || current_state_ == State::PLANNING_LIN)
             && planning_future_.valid())
    {
        RCLCPP_INFO(node_->get_logger(), "[PilzPointsPlanner] Halt during planning — dropping plan");
        try { planning_future_.wait(); planning_future_.get(); } catch (...) {}
        if (move_group_) move_group_->clearPoseTargets();
    }

    // has_planned_ / cached_plan_ intentionally left untouched — see onStart().

    planning_future_ = std::shared_future<bool>();
    execution_future_ = std::shared_future<bool>();
    current_state_ = State::IDLE;
}

// -----------------------------------------------------------------------
// cachedPlanStartMatchesCurrentState - validate cache before reusing it
// -----------------------------------------------------------------------
bool PilzPointsPlanner::cachedPlanStartMatchesCurrentState(double tolerance)
{
    if (!move_group_)
        return false;

    if (cached_plan_.trajectory_.joint_trajectory.points.empty())
        return false;

    moveit::core::RobotStatePtr current_state = move_group_->getCurrentState(1.0);
    if (!current_state)
    {
        RCLCPP_WARN(node_->get_logger(),
                    "[PilzPointsPlanner] Could not fetch current robot state for cache validation — forcing re-plan");
        return false;
    }

    const auto& joint_names        = cached_plan_.trajectory_.joint_trajectory.joint_names;
    const auto& expected_positions = cached_plan_.trajectory_.joint_trajectory.points.front().positions;

    if (joint_names.size() != expected_positions.size())
        return false;

    for (size_t i = 0; i < joint_names.size(); ++i)
    {
        double current_value = current_state->getVariablePosition(joint_names[i]);
        double diff = std::abs(current_value - expected_positions[i]);

        if (diff > tolerance)
        {
            RCLCPP_WARN(node_->get_logger(),
                        "[PilzPointsPlanner] Cache check: joint '%s' expected %.5f, actual %.5f (diff %.5f > tol %.5f)",
                        joint_names[i].c_str(), expected_positions[i], current_value, diff, tolerance);
            return false;
        }
    }

    return true;
}

// -----------------------------------------------------------------------
// startPTPPlanning - Launch async PTP planning
// -----------------------------------------------------------------------
bool PilzPointsPlanner::startPTPPlanning(const std::vector<double>& target, double speed, double accel)
{
    auto target_copy = target;

    planning_future_ = std::async(std::launch::async, [this, target_copy, speed, accel]() -> bool {
        return runPTP(target_copy, speed, accel);
    });

    return true;
}

// -----------------------------------------------------------------------
// startLINPlanning - Launch async LIN planning
// -----------------------------------------------------------------------
bool PilzPointsPlanner::startLINPlanning(const std::vector<double>& target, double speed, double accel)
{
    auto target_copy = target;

    planning_future_ = std::async(std::launch::async, [this, target_copy, speed, accel]() -> bool {
        return runLIN(target_copy, speed, accel);
    });

    return true;
}

// -----------------------------------------------------------------------
// startExecution - Start executing the previously planned motion
// -----------------------------------------------------------------------
bool PilzPointsPlanner::startExecution()
{
    if (!move_group_)
    {
        RCLCPP_ERROR(node_->get_logger(), "[PilzPointsPlanner] MoveGroup is null");
        return false;
    }

    execution_future_ = std::async(std::launch::async, [this]() -> bool {
        bool executed = (move_group_->execute(stored_plan_) == moveit::core::MoveItErrorCode::SUCCESS);
        if (!executed)
            RCLCPP_ERROR(node_->get_logger(), "[PilzPointsPlanner] Execution failed");
        return executed;
    });

    return true;
}

// -----------------------------------------------------------------------
// PTP — joint-space target, Pilz PTP
// -----------------------------------------------------------------------
bool PilzPointsPlanner::runPTP(const std::vector<double>& target, double speed, double accel)
{
    move_group_->setPlannerId("PTP");
    move_group_->setMaxVelocityScalingFactor(speed);
    move_group_->setMaxAccelerationScalingFactor(accel);
    move_group_->setStartStateToCurrentState();
    move_group_->setJointValueTarget(target);

    bool planned = (move_group_->plan(stored_plan_) == moveit::core::MoveItErrorCode::SUCCESS);

    if (!planned)
    {
        RCLCPP_ERROR(node_->get_logger(), "[PilzPointsPlanner] PTP planning failed");
        return false;
    }

    return true;
}

// -----------------------------------------------------------------------
// LIN — Cartesian linear, derived from FK of joint target, Pilz LIN
// -----------------------------------------------------------------------
bool PilzPointsPlanner::runLIN(const std::vector<double>& target, double speed, double accel)
{
    const moveit::core::RobotModelConstPtr robot_model = move_group_->getRobotModel();
    const moveit::core::JointModelGroup* jmg =
        robot_model->getJointModelGroup(move_group_->getName());

    if (!jmg)
    {
        RCLCPP_ERROR(node_->get_logger(), "[PilzPointsPlanner] JointModelGroup not found");
        return false;
    }

    moveit::core::RobotState rs(robot_model);
    rs.setToDefaultValues();
    rs.setJointGroupPositions(jmg, target);
    rs.update();

    std::string ee_link = move_group_->getEndEffectorLink();
    if (ee_link.empty())
    {
        const auto& links = jmg->getLinkModelNames();
        if (links.empty())
        {
            RCLCPP_ERROR(node_->get_logger(), "[PilzPointsPlanner] No end-effector link found");
            return false;
        }
        ee_link = links.back();
    }

    const Eigen::Isometry3d ee_tf = rs.getGlobalLinkTransform(ee_link);

    geometry_msgs::msg::PoseStamped target_pose;
    target_pose.header.frame_id = pose_reference_frame_;
    target_pose.header.stamp    = node_->now();

    target_pose.pose.position.x = ee_tf.translation().x();
    target_pose.pose.position.y = ee_tf.translation().y();
    target_pose.pose.position.z = ee_tf.translation().z();

    Eigen::Quaterniond q(ee_tf.rotation());
    target_pose.pose.orientation.x = q.x();
    target_pose.pose.orientation.y = q.y();
    target_pose.pose.orientation.z = q.z();
    target_pose.pose.orientation.w = q.w();

    RCLCPP_INFO(node_->get_logger(),
                "[PilzPointsPlanner] LIN target [frame=%s]: (%.4f, %.4f, %.4f)",
                pose_reference_frame_.c_str(),
                target_pose.pose.position.x,
                target_pose.pose.position.y,
                target_pose.pose.position.z);

    move_group_->setPlannerId("LIN");
    move_group_->setMaxVelocityScalingFactor(speed);
    move_group_->setMaxAccelerationScalingFactor(accel);
    move_group_->setStartStateToCurrentState();
    move_group_->setPoseReferenceFrame(pose_reference_frame_);
    move_group_->setPoseTarget(target_pose);

    bool planned = (move_group_->plan(stored_plan_) == moveit::core::MoveItErrorCode::SUCCESS);
    move_group_->clearPoseTargets();

    if (!planned)
    {
        RCLCPP_ERROR(node_->get_logger(), "[PilzPointsPlanner] LIN planning failed");
        return false;
    }

    return true;
}

// -----------------------------------------------------------------------
// YAML loader
// -----------------------------------------------------------------------
void PilzPointsPlanner::loadJointTargetsFromYaml(const std::string& filepath)
{
    try
    {
        YAML::Node root = YAML::LoadFile(filepath);

        YAML::Node points;

        if (root.IsSequence())
            points = root;
        else if (root.IsMap() && root["points"])
            points = root["points"];
        else
        {
            RCLCPP_ERROR(node_->get_logger(),
                         "[PilzPointsPlanner] Invalid YAML: no sequence or 'points' key");
            return;
        }

        for (const auto& point : points)
        {
            if (!point["name"])
            {
                RCLCPP_WARN(node_->get_logger(), "[PilzPointsPlanner] Skipping point without name");
                continue;
            }

            std::string name = point["name"].as<std::string>();

            if (!point["joints_values"])
            {
                RCLCPP_WARN(node_->get_logger(),
                            "[PilzPointsPlanner] Skipping '%s' — no joints_values", name.c_str());
                continue;
            }

            const YAML::Node& jv = point["joints_values"];

            try
            {
                joint_targets_[name] = {
                    jv["joint1"].as<double>(),
                    jv["joint2"].as<double>(),
                    jv["joint3"].as<double>(),
                    jv["joint4"].as<double>(),
                    jv["joint5"].as<double>(),
                    jv["joint6"].as<double>()
                };
            }
            catch (...)
            {
                RCLCPP_ERROR(node_->get_logger(),
                             "[PilzPointsPlanner] Invalid joint values for '%s'", name.c_str());
            }
        }

        RCLCPP_INFO(node_->get_logger(),
                    "[PilzPointsPlanner] Loaded %zu joint targets from YAML",
                    joint_targets_.size());
    }
    catch (const std::exception& e)
    {
        RCLCPP_ERROR(node_->get_logger(),
                     "[PilzPointsPlanner] YAML load error: %s", e.what());
    }
}