/**
 * @file bt_plan_path.cpp
 * @author Adnan Alvi
 * @brief Behavior Tree node for motion planning with MoveIt and ROS 2, with PathSaver integration.
 * @version 2.0
 * @date 2025-09-12
 * @company Nextup Robotics Private Limited
 * @designation Robotics Software Engineer
 */

#include "bt_plan_path.hpp"
#include <numeric>
#include <fstream>

namespace bt_plan
{

    // ----------------------------------------------------
    // WaypointLoader Implementation
    // ----------------------------------------------------
    bool WaypointLoader::loadJointPositions(
        const std::string &file_path,
        const std::vector<std::string> &required_joints,
        std::map<std::string, std::map<std::string, double>> &joint_positions,
        const rclcpp::Logger &logger,
        std::function<void(const std::string &)> status_callback)
    {
        try
        {
            YAML::Node config = YAML::LoadFile(file_path);
            if (config.IsNull() || !config["points"].IsSequence())
            {
                RCLCPP_ERROR(logger, "YAML file '%s' is empty or invalid.", file_path.c_str());
                status_callback("file_empty");
                return false;
            }

            std::set<std::string> required_set(required_joints.begin(), required_joints.end());
            joint_positions.clear();
            bool has_invalid = false;

            for (const auto &point : config["points"])
            {
                if (!point["name"] || !point["joints_values"].IsMap())
                {
                    RCLCPP_ERROR(logger, "YAML point missing name or joints_values.");
                    has_invalid = true;
                    continue;
                }

                std::string name = point["name"].as<std::string>();
                std::map<std::string, double> positions;
                std::set<std::string> yaml_set;

                for (const auto &j : point["joints_values"])
                {
                    std::string joint_name = j.first.as<std::string>();
                    positions[joint_name] = j.second.as<double>();
                    yaml_set.insert(joint_name);
                }

                if (yaml_set != required_set)
                {
                    RCLCPP_ERROR(logger, "Invalid or missing joints for point '%s'.", name.c_str());
                    has_invalid = true;
                    continue;
                }

                joint_positions[name] = positions;
            }

            if (has_invalid)
            {
                status_callback("joints_not_found");
            }

            if (joint_positions.size() < 2)
            {
                RCLCPP_ERROR(logger, "Fewer than 2 valid waypoints found in YAML.");
                status_callback("not_enough_points");
                return false;
            }

            return !has_invalid;
        }
        catch (const std::exception &e)
        {
            RCLCPP_ERROR(logger, "Failed to load YAML '%s': %s", file_path.c_str(), e.what());
            status_callback("file_empty");
            return false;
        }
    }

    // ----------------------------------------------------
    // TransformUtils Implementation
    // ----------------------------------------------------
    geometry_msgs::msg::Pose TransformUtils::toPose(const Eigen::Isometry3d &transform)
    {
        geometry_msgs::msg::Pose pose;
        pose.position.x = transform.translation().x();
        pose.position.y = transform.translation().y();
        pose.position.z = transform.translation().z();
        Eigen::Quaterniond q(transform.rotation());
        pose.orientation.x = q.x();
        pose.orientation.y = q.y();
        pose.orientation.z = q.z();
        pose.orientation.w = q.w();
        return pose;
    }

    // ----------------------------------------------------
    // PathSaver Implementation
    // ----------------------------------------------------
    PathSaver::PathSaver(const rclcpp::Node::SharedPtr &node) : node_(node)
    {
        yaml_file_ =  "/home/nextup/NextupRobot/src/active_project_configs/planning_data/paths.yaml";
    }

    void PathSaver::savePath(
        const std::string &path_name,
        const std::string &plan_space,
        const moveit_msgs::msg::RobotTrajectory &trajectory, const std::string &start_goal, const std::string &end_goal)
    {
        YAML::Node root;
        try
        {
            root = YAML::LoadFile(yaml_file_);
        }
        catch (...)
        {
            root = YAML::Node();
        }

        if (!root["paths"])
        {
            root["paths"] = YAML::Node(YAML::NodeType::Sequence);
        }

        YAML::Node path_node;
        path_node["name"] = path_name;
        path_node["plan_space"] = plan_space;
        path_node["start_point"] = start_goal;
        path_node["end_point"] = end_goal;

        YAML::Node data_node(YAML::NodeType::Sequence);

        for (const auto &point : trajectory.joint_trajectory.points)
        {
            YAML::Node step;

            // Create flow-style nodes for each array
            YAML::Node positions_node(YAML::NodeType::Sequence);
            positions_node.SetStyle(YAML::EmitterStyle::Flow);
            for (const auto &pos : point.positions)
            {
                positions_node.push_back(pos);
            }

            YAML::Node velocities_node(YAML::NodeType::Sequence);
            velocities_node.SetStyle(YAML::EmitterStyle::Flow);
            for (const auto &vel : point.velocities)
            {
                velocities_node.push_back(vel);
            }

            YAML::Node accelerations_node(YAML::NodeType::Sequence);
            accelerations_node.SetStyle(YAML::EmitterStyle::Flow);
            for (const auto &acc : point.accelerations)
            {
                accelerations_node.push_back(acc);
            }

            step["positions"] = positions_node;
            step["velocities"] = velocities_node;
            step["accelerations"] = accelerations_node;

            data_node.push_back(step);
        }

        path_node["data"] = data_node;
        root["paths"].push_back(path_node);

        std::ofstream fout(yaml_file_);
        fout << root;
        fout.close();

        RCLCPP_INFO(node_->get_logger(), "Saved path '%s' to %s", path_name.c_str(), yaml_file_.c_str());
    }

    // ----------------------------------------------------
    // PlanPath Implementation
    // ----------------------------------------------------
    PlanPath::PlanPath(
        const std::string &name,
        const BT::NodeConfiguration &config,
        const rclcpp::Node::SharedPtr &node)
        : BT::StatefulActionNode(name, config), node_(node)
    {
        node_->get_parameter_or<std::string>("planning_group", planning_group_, "robot_manipulator");
        yaml_file_ = "/home/nextup/NextupRobot/src/active_project_configs/planning_data/points.yaml";
        node_->get_parameter_or<double>("eef_step", eef_step_, 0.01);
        node_->get_parameter_or<double>("jump_threshold", jump_threshold_, 0.0);

        RCLCPP_INFO(node_->get_logger(), "Initializing PlanPath BT node...");

        move_group_ = std::make_shared<moveit::planning_interface::MoveGroupInterface>(node_, planning_group_);
        move_group_->setMaxVelocityScalingFactor(1.0);
        move_group_->setMaxAccelerationScalingFactor(1.0);

        planning_status_pub_ = node_->create_publisher<std_msgs::msg::String>("/planning_status", 10);
        trajectory_pub_ = node_->create_publisher<moveit_msgs::msg::RobotTrajectory>("/planned_trajectory", 10);

        path_saver_ = std::make_shared<PathSaver>(node_);

        RCLCPP_INFO(node_->get_logger(), "PlanPath BT node initialized.");
    }

    BT::PortsList PlanPath::providedPorts()
    {
        return {
            BT::InputPort<std::string>("start_goal"),
            BT::InputPort<std::string>("intermediate_goal"),
            BT::InputPort<std::string>("end_goal"),
            BT::InputPort<std::string>("plan_space"),
            BT::InputPort<std::string>("path_name")};
    }

    BT::NodeStatus PlanPath::onStart()
    {
        std::string start_goal, intermediate_goal, end_goal, plan_space, path_name;

        if (!getInput("start_goal", start_goal) ||
            !getInput("end_goal", end_goal) ||
            !getInput("plan_space", plan_space) ||
            !getInput("path_name", path_name))
        {
            RCLCPP_ERROR(node_->get_logger(), "Missing required input ports.");
            publishStatus("invalid_command", path_name);
            return BT::NodeStatus::FAILURE;
        }

        getInput("intermediate_goal", intermediate_goal);

        bool cartesian = (plan_space == "cartesian");
        if (plan_space != "cartesian" && plan_space != "joint")
        {
            RCLCPP_ERROR(node_->get_logger(), "Invalid plan_space: '%s'. Must be 'cartesian' or 'joint'.", plan_space.c_str());
            publishStatus("invalid_command", path_name);
            return BT::NodeStatus::FAILURE;
        }

        std::vector<std::string> waypoints = {start_goal};
        if (!intermediate_goal.empty())
        {
            std::istringstream iss(intermediate_goal);
            std::string token;
            while (std::getline(iss, token, ','))
            {
                if (!token.empty())
                {
                    waypoints.push_back(token);
                }
            }
        }
        waypoints.push_back(end_goal);

        if (waypoints.size() < 2)
        {
            RCLCPP_ERROR(node_->get_logger(), "Fewer than 2 waypoints.");
            publishStatus("invalid_command", path_name);
            return BT::NodeStatus::FAILURE;
        }

        if (!cartesian && waypoints.size() > 2)
        {
            RCLCPP_ERROR(node_->get_logger(), "Joint-space planning requires exactly 2 waypoints, got %zu.", waypoints.size());
            publishStatus("invalid_command", path_name);
            return BT::NodeStatus::FAILURE;
        }

        for (size_t i = 1; i < waypoints.size(); ++i)
        {
            if (waypoints[i] == waypoints[i - 1])
            {
                RCLCPP_ERROR(node_->get_logger(), "Consecutive waypoints are the same: '%s'.", waypoints[i].c_str());
                publishStatus("same_points", path_name);
                return BT::NodeStatus::FAILURE;
            }
        }

        try
        {
            if (!WaypointLoader::loadJointPositions(yaml_file_, move_group_->getJointNames(), joint_positions_, node_->get_logger(),
                                                    [this, &path_name](const std::string &status)
                                                    {
                                                        publishStatus(status, path_name);
                                                    }))
            {
                return BT::NodeStatus::FAILURE;
            }

            for (const auto &wp : waypoints)
            {
                if (joint_positions_.find(wp) == joint_positions_.end())
                {
                    RCLCPP_ERROR(node_->get_logger(), "Waypoint '%s' not found in YAML.", wp.c_str());
                    publishStatus("points_not_found", path_name);
                    return BT::NodeStatus::FAILURE;
                }
            }

            const moveit::core::RobotModelConstPtr &robot_model = move_group_->getRobotModel();
            moveit::core::RobotState start_state(robot_model);
            const auto &start_wp = joint_positions_[waypoints.front()];
            for (const auto &j : start_wp)
            {
                start_state.setJointPositions(j.first, &j.second);
            }
            start_state.update();
            move_group_->setStartState(start_state);

            if (cartesian)
            {
                return performCartesianPlanning(waypoints, path_name, start_goal, end_goal) ? BT::NodeStatus::SUCCESS : BT::NodeStatus::FAILURE;
            }
            else
            {
                return performJointPlanning(waypoints, path_name, start_goal, end_goal) ? BT::NodeStatus::SUCCESS : BT::NodeStatus::FAILURE;
            }
        }
        catch (const std::exception &e)
        {
            RCLCPP_ERROR(node_->get_logger(), "Error during planning for '%s': %s", path_name.c_str(), e.what());
            publishStatus("general_error", path_name);
            return BT::NodeStatus::FAILURE;
        }
    }

    BT::NodeStatus PlanPath::onRunning()
    {
        return BT::NodeStatus::SUCCESS;
    }

    void PlanPath::onHalted()
    {
        RCLCPP_WARN(node_->get_logger(), "PlanPath halted.");
        joint_positions_.clear();
    }

    void PlanPath::publishStatus(const std::string &status, const std::string &path_name)
    {
        std_msgs::msg::String msg;
        msg.data = status + " for " + path_name;
        planning_status_pub_->publish(msg);
        RCLCPP_INFO(node_->get_logger(), "Published status: '%s'", msg.data.c_str());
    }

    void PlanPath::publishStatus(const std::string &status, const std::string &path_name, size_t num_points, double duration)
    {
        std_msgs::msg::String msg;
        if (status == "planning_failed")
        {
            msg.data = "planning failed for " + path_name;
        }
        else if (status == "cartesian_planned successful")
        {
            msg.data = path_name + " cartesian_planned successful, " +
                       std::to_string(num_points) + " points, " + std::to_string(duration) + " seconds";
        }
        else if (status == "joint_planned successful")
        {
            msg.data = path_name + " joint_planned successful";
        }
        else
        {
            msg.data = status + " for " + path_name;
        }
        planning_status_pub_->publish(msg);
        RCLCPP_INFO(node_->get_logger(), "Published status: '%s'", msg.data.c_str());
    }

    bool PlanPath::performCartesianPlanning(const std::vector<std::string> &waypoints, const std::string &path_name, const std::string &start_goal, const std::string &end_goal)
    {
        std::string ee_link = move_group_->getEndEffectorLink();
        if (ee_link.empty())
        {
            RCLCPP_ERROR(node_->get_logger(), "No end-effector link defined in MoveGroup.");
            publishStatus("no_end_effector", path_name);
            return false;
        }

        const moveit::core::RobotModelConstPtr &robot_model = move_group_->getRobotModel();
        std::vector<geometry_msgs::msg::Pose> pose_waypoints;
        for (const auto &wp : waypoints)
        {
            moveit::core::RobotState state(robot_model);
            const auto &joint_positions = joint_positions_[wp];
            for (const auto &j : joint_positions)
            {
                state.setJointPositions(j.first, &j.second);
            }
            state.update();
            pose_waypoints.push_back(TransformUtils::toPose(state.getGlobalLinkTransform(ee_link)));
        }

        moveit_msgs::msg::RobotTrajectory trajectory;
        double fraction = move_group_->computeCartesianPath(pose_waypoints, eef_step_, jump_threshold_, trajectory);

        if (fraction >= 1.0 && !trajectory.joint_trajectory.points.empty())
        {
            trajectory.joint_trajectory.header.stamp = node_->get_clock()->now();
            trajectory_pub_->publish(trajectory);

            size_t num_points = trajectory.joint_trajectory.points.size();
            double total_duration = num_points * 0.1;

            RCLCPP_INFO(node_->get_logger(), "Cartesian path successful for '%s'.", path_name.c_str());
            publishStatus("cartesian_planned successful", path_name, num_points, total_duration);

            path_saver_->savePath(path_name, "Cartesian", trajectory, start_goal, end_goal);
            return true;
        }
        else
        {
            RCLCPP_ERROR(node_->get_logger(), "Cartesian planning failed for '%s'.", path_name.c_str());
            publishStatus("planning_failed", path_name);
            return false;
        }
    }

    bool PlanPath::performJointPlanning(const std::vector<std::string> &waypoints, const std::string &path_name, const std::string &start_goal, const std::string &end_goal)
    {
        RCLCPP_INFO(node_->get_logger(), "Planning single joint-space path for '%s' from '%s' to '%s'", path_name.c_str(), waypoints.front().c_str(), waypoints.back().c_str());

        const auto &goal_wp = joint_positions_[waypoints.back()];
        move_group_->setJointValueTarget(goal_wp);
        moveit::planning_interface::MoveGroupInterface::Plan plan;
        auto success = (move_group_->plan(plan) == moveit::core::MoveItErrorCode::SUCCESS);

        if (success)
        {
            size_t num_points = plan.trajectory_.joint_trajectory.points.size();
            double total_duration = num_points * 0.1;
            if (!plan.trajectory_.joint_trajectory.points.empty())
            {
                for (size_t i = 0; i < num_points; ++i)
                {
                    plan.trajectory_.joint_trajectory.points[i].time_from_start = rclcpp::Duration::from_seconds(i * total_duration / num_points);
                }
                plan.trajectory_.joint_trajectory.header.stamp = node_->get_clock()->now();
                trajectory_pub_->publish(plan.trajectory_);
            }
            RCLCPP_INFO(node_->get_logger(), "Single joint plan successful for '%s', trajectory has %zu points, %.2f seconds.",
                        path_name.c_str(), num_points, total_duration);
            publishStatus("joint_planned successful", path_name);
            path_saver_->savePath(path_name, "Joint", plan.trajectory_, start_goal, end_goal);
            return true;
        }
        else
        {
            RCLCPP_ERROR(node_->get_logger(), "Single joint planning failed for '%s'.", path_name.c_str());
            publishStatus("planning_failed", path_name);
            return false;
        }
    }

} // namespace bt_plan