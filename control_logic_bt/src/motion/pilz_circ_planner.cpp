#include "control_logic_bt/motion/pilz_circ_planner.hpp"
#include <algorithm>

// ===========================================================================
// Constructor
// ===========================================================================
PilzCircPlanner::PilzCircPlanner(const std::string&           name,
                                 const BT::NodeConfiguration& config)
    : BT::StatefulActionNode(name, config)
{
    node_ = rclcpp::Node::make_shared(
        "bt_pilz_circ_planner_" +
        std::to_string(reinterpret_cast<uintptr_t>(this)));

    executor_.add_node(node_);
    spin_thread_ = std::thread([this]() { executor_.spin(); });

    move_group_ = std::make_shared<moveit::planning_interface::MoveGroupInterface>(
        node_, "robot_manipulator");

    move_group_->setPlanningPipelineId("pilz_industrial_motion_planner");

    loadPointsFromYaml(yaml_path_);
}

// ===========================================================================
// Destructor
// ===========================================================================
PilzCircPlanner::~PilzCircPlanner()
{
    executor_.cancel();
    if (spin_thread_.joinable())
        spin_thread_.join();
}

// ===========================================================================
// providedPorts
// ===========================================================================
BT::PortsList PilzCircPlanner::providedPorts()
{
    return {
        BT::InputPort<std::string>("start_name"),
        BT::InputPort<std::string>("goal_name"),
        BT::InputPort<std::string>("interim_name"),
        BT::InputPort<double>("velocity"),
        BT::InputPort<double>("acceleration")
    };
}

// ===========================================================================
// onStart
// ===========================================================================
BT::NodeStatus PilzCircPlanner::onStart()
{
    std::string start_name, goal_name, interim_name;

    if (!getInput("start_name", start_name) || start_name.empty())
    {
        RCLCPP_ERROR(node_->get_logger(), "[PilzCircPlanner] Missing 'start_name'");
        return BT::NodeStatus::FAILURE;
    }
    if (!getInput("goal_name", goal_name) || goal_name.empty())
    {
        RCLCPP_ERROR(node_->get_logger(), "[PilzCircPlanner] Missing 'goal_name'");
        return BT::NodeStatus::FAILURE;
    }
    if (!getInput("interim_name", interim_name) || interim_name.empty())
    {
        RCLCPP_ERROR(node_->get_logger(), "[PilzCircPlanner] Missing 'interim_name'");
        return BT::NodeStatus::FAILURE;
    }

    active_velocity_     = 0.1;
    active_acceleration_ = 0.1;
    getInput("velocity",     active_velocity_);
    getInput("acceleration", active_acceleration_);
    active_velocity_     = std::max(0.01, std::min(1.0, active_velocity_));
    active_acceleration_ = std::max(0.01, std::min(1.0, active_acceleration_));

    auto goal_it    = point_data_.find(goal_name);
    auto interim_it = point_data_.find(interim_name);
    auto start_it   = point_data_.find(start_name);

    if (start_it == point_data_.end())
    {
        RCLCPP_ERROR(node_->get_logger(), "[PilzCircPlanner] Start point '%s' not found", start_name.c_str());
        return BT::NodeStatus::FAILURE;
    }
    if (goal_it == point_data_.end())
    {
        RCLCPP_ERROR(node_->get_logger(), "[PilzCircPlanner] Goal point '%s' not found", goal_name.c_str());
        return BT::NodeStatus::FAILURE;
    }
    if (interim_it == point_data_.end())
    {
        RCLCPP_ERROR(node_->get_logger(), "[PilzCircPlanner] Interim point '%s' not found", interim_name.c_str());
        return BT::NodeStatus::FAILURE;
    }

    active_goal_    = goal_it->second;
    active_interim_ = interim_it->second;

    RCLCPP_INFO(node_->get_logger(),
                "[PilzCircPlanner] CIRC start='%s' goal='%s' interim='%s' vel=%.2f acc=%.2f",
                start_name.c_str(), goal_name.c_str(), interim_name.c_str(),
                active_velocity_, active_acceleration_);

    if (!startPlanning(active_goal_, active_interim_, active_velocity_, active_acceleration_))
    {
        current_state_ = State::IDLE;
        return BT::NodeStatus::FAILURE;
    }

    current_state_ = State::PLANNING;
    return BT::NodeStatus::RUNNING;
}

// ===========================================================================
// onRunning
// ===========================================================================
BT::NodeStatus PilzCircPlanner::onRunning()
{
    switch (current_state_)
    {
        case State::PLANNING:
        {
            if (!planning_future_.valid())
            {
                RCLCPP_ERROR(node_->get_logger(), "[PilzCircPlanner] Planning future invalid");
                current_state_ = State::IDLE;
                return BT::NodeStatus::FAILURE;
            }

            if (planning_future_.wait_for(std::chrono::milliseconds(0)) == std::future_status::ready)
            {
                bool ok = false;
                try   { ok = planning_future_.get(); }
                catch (const std::exception& e)
                {
                    RCLCPP_ERROR(node_->get_logger(), "[PilzCircPlanner] Planning exception: %s", e.what());
                    current_state_ = State::IDLE;
                    return BT::NodeStatus::FAILURE;
                }

                if (!ok)
                {
                    RCLCPP_ERROR(node_->get_logger(), "[PilzCircPlanner] CIRC planning failed");
                    current_state_ = State::IDLE;
                    return BT::NodeStatus::FAILURE;
                }

                if (!startExecution())
                {
                    current_state_ = State::IDLE;
                    return BT::NodeStatus::FAILURE;
                }

                current_state_ = State::EXECUTING;
            }

            return BT::NodeStatus::RUNNING;
        }

        case State::EXECUTING:
        {
            if (!execution_future_.valid())
            {
                RCLCPP_ERROR(node_->get_logger(), "[PilzCircPlanner] Execution future invalid");
                current_state_ = State::IDLE;
                return BT::NodeStatus::FAILURE;
            }

            if (execution_future_.wait_for(std::chrono::milliseconds(0)) == std::future_status::ready)
            {
                bool ok = false;
                try   { ok = execution_future_.get(); }
                catch (const std::exception& e)
                {
                    RCLCPP_ERROR(node_->get_logger(), "[PilzCircPlanner] Execution exception: %s", e.what());
                    current_state_ = State::IDLE;
                    return BT::NodeStatus::FAILURE;
                }

                current_state_ = State::IDLE;
                if (ok)
                {
                    RCLCPP_INFO(node_->get_logger(), "[PilzCircPlanner] CIRC motion complete");
                    return BT::NodeStatus::SUCCESS;
                }
                else
                {
                    RCLCPP_ERROR(node_->get_logger(), "[PilzCircPlanner] CIRC execution failed");
                    return BT::NodeStatus::FAILURE;
                }
            }

            return BT::NodeStatus::RUNNING;
        }

        default:
            RCLCPP_ERROR(node_->get_logger(), "[PilzCircPlanner] Invalid state");
            current_state_ = State::IDLE;
            return BT::NodeStatus::FAILURE;
    }
}

// ===========================================================================
// onHalted
// ===========================================================================
void PilzCircPlanner::onHalted()
{
    RCLCPP_WARN(node_->get_logger(), "[PilzCircPlanner] Halted during %s — letting motion finish",
                current_state_ == State::IDLE      ? "IDLE" :
                current_state_ == State::PLANNING   ? "PLANNING" : "EXECUTING");

    if (current_state_ == State::EXECUTING && execution_future_.valid())
    {
        RCLCPP_INFO(node_->get_logger(),
                    "[PilzCircPlanner] Waiting for in-flight CIRC execution to complete...");
        try
        {
            execution_future_.wait();
            execution_future_.get();
        }
        catch (const std::exception& e)
        {
            RCLCPP_WARN(node_->get_logger(),
                        "[PilzCircPlanner] Execution finished with exception during halt: %s", e.what());
        }
        RCLCPP_INFO(node_->get_logger(), "[PilzCircPlanner] Execution complete, halt proceeding");
    }
    else if (current_state_ == State::PLANNING && planning_future_.valid())
    {
        RCLCPP_INFO(node_->get_logger(), "[PilzCircPlanner] Halt during planning — dropping plan");
        try { planning_future_.wait(); planning_future_.get(); } catch (...) {}
        if (move_group_) move_group_->clearPathConstraints();
    }

    planning_future_  = std::shared_future<bool>();
    execution_future_ = std::shared_future<bool>();
    current_state_    = State::IDLE;
}

// ===========================================================================
// startPlanning
// ===========================================================================
bool PilzCircPlanner::startPlanning(const PointData& goal, const PointData& interim,
                                    double velocity, double acceleration)
{
    planning_future_ = std::async(std::launch::async,
        [this, goal, interim, velocity, acceleration]() -> bool
    {
        move_group_->setPlannerId("CIRC");
        move_group_->setMaxVelocityScalingFactor(velocity);
        move_group_->setMaxAccelerationScalingFactor(acceleration);
        move_group_->setStartStateToCurrentState();
        move_group_->setJointValueTarget(goal.joints);

        moveit_msgs::msg::Constraints circ_constraints;
        circ_constraints.name = "interim";

        moveit_msgs::msg::PositionConstraint interim_pos;
        interim_pos.link_name       = move_group_->getEndEffectorLink();
        interim_pos.header.frame_id = move_group_->getPlanningFrame();

        shape_msgs::msg::SolidPrimitive primitive;
        primitive.type = shape_msgs::msg::SolidPrimitive::SPHERE;
        primitive.dimensions.push_back(5.0);

        geometry_msgs::msg::Pose constraint_pose;
        constraint_pose.position.x    = interim.x;
        constraint_pose.position.y    = interim.y;
        constraint_pose.position.z    = interim.z;
        constraint_pose.orientation.w = 1.0;

        interim_pos.constraint_region.primitives.push_back(primitive);
        interim_pos.constraint_region.primitive_poses.push_back(constraint_pose);
        circ_constraints.position_constraints.push_back(interim_pos);

        move_group_->setPathConstraints(circ_constraints);

        bool planned =
            (move_group_->plan(stored_plan_) == moveit::core::MoveItErrorCode::SUCCESS);

        move_group_->clearPathConstraints();   // always clean up

        if (!planned)
            RCLCPP_ERROR(node_->get_logger(), "[PilzCircPlanner] CIRC planning failed");

        return planned;
    });

    return true;
}

// ===========================================================================
// startExecution
// ===========================================================================
bool PilzCircPlanner::startExecution()
{
    execution_future_ = std::async(std::launch::async, [this]() -> bool
    {
        bool ok = (move_group_->execute(stored_plan_) == moveit::core::MoveItErrorCode::SUCCESS);
        if (!ok)
            RCLCPP_ERROR(node_->get_logger(), "[PilzCircPlanner] CIRC execution failed");
        return ok;
    });

    return true;
}

// ===========================================================================
// loadPointsFromYaml  (unchanged logic)
// ===========================================================================
void PilzCircPlanner::loadPointsFromYaml(const std::string& filepath)
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
                         "[PilzCircPlanner] Invalid YAML: expected sequence or map with 'points'");
            return;
        }

        for (const auto& item : points)
        {
            if (!item["name"]) { RCLCPP_WARN(node_->get_logger(), "[PilzCircPlanner] Skipping entry without 'name'"); continue; }
            std::string name = item["name"].as<std::string>();

            if (!item["joints_values"] || !item["coordinate"])
            {
                RCLCPP_WARN(node_->get_logger(),
                            "[PilzCircPlanner] Skipping '%s' — missing joints_values or coordinate", name.c_str());
                continue;
            }

            try
            {
                PointData data;
                const YAML::Node& jv = item["joints_values"];
                data.joints = {
                    jv["joint1"].as<double>(), jv["joint2"].as<double>(),
                    jv["joint3"].as<double>(), jv["joint4"].as<double>(),
                    jv["joint5"].as<double>(), jv["joint6"].as<double>()
                };
                const YAML::Node& c = item["coordinate"];
                data.x = c["x"].as<double>() / 100.0;
                data.y = c["y"].as<double>() / 100.0;
                data.z = c["z"].as<double>() / 100.0;
                point_data_[name] = std::move(data);
            }
            catch (const std::exception& e)
            {
                RCLCPP_ERROR(node_->get_logger(),
                             "[PilzCircPlanner] Failed to parse '%s': %s", name.c_str(), e.what());
            }
        }

        RCLCPP_INFO(node_->get_logger(),
                    "[PilzCircPlanner] Loaded %zu points from '%s'",
                    point_data_.size(), filepath.c_str());
    }
    catch (const std::exception& e)
    {
        RCLCPP_ERROR(node_->get_logger(), "[PilzCircPlanner] YAML load error: %s", e.what());
    }
}