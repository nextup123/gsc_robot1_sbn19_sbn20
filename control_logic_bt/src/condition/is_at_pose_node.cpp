#include "control_logic_bt/condition/is_at_pose_node.hpp"
#include <thread>
#include <cmath>

IsAtPose::IsAtPose(const std::string &name, const BT::NodeConfiguration &config)
    : BT::ConditionNode(name, config)
{
    node_ = rclcpp::Node::make_shared("is_at_pose_bt_node");
    joint_state_sub_ = node_->create_subscription<sensor_msgs::msg::JointState>(
        "/joint_states", 10,
        std::bind(&IsAtPose::jointStateCallback, this, std::placeholders::_1));

    // Get filepath from parameter or use default
    yaml_filepath_ = "/home/nextup/NextupRobot/src/active_project_configs/planning_data/points.yaml"; // Consider making this a parameter
    loadTargetYaml();
    startFileWatcher();

    // Spin the node in background thread
    std::thread([this]()
                { rclcpp::spin(node_); })
        .detach();
}

void IsAtPose::startFileWatcher()
{
    std::thread([this]()
                {
        while (rclcpp::ok()) {
            checkForYamlUpdates();
            std::this_thread::sleep_for(std::chrono::milliseconds(2000)); // Check every 500ms
        } })
        .detach();
}

void IsAtPose::checkForYamlUpdates()
{
    try
    {
        auto current_write_time = std::filesystem::last_write_time(yaml_filepath_);
        if (current_write_time != last_write_time_)
        {
            RCLCPP_INFO(node_->get_logger(), "YAML file modified, reloading...");
            loadTargetYaml();
            last_write_time_ = current_write_time;
        }
    }
    catch (const std::exception &e)
    {
        RCLCPP_ERROR(node_->get_logger(), "Error checking YAML file: %s", e.what());
    }
}

void IsAtPose::loadTargetYaml()
{
    std::lock_guard<std::mutex> lock(yaml_mutex_);

    try
    {
        YAML::Node yaml_data = YAML::LoadFile(yaml_filepath_);
        std::unordered_map<std::string, std::vector<double>> new_map;

        for (const auto &pt : yaml_data["points"])
        {
            std::vector<double> joint_vals(6, 0.0);
            const auto &joints = pt["joints_values"];
            joint_vals[0] = joints["joint1"].as<double>();
            joint_vals[1] = joints["joint2"].as<double>();
            joint_vals[2] = joints["joint3"].as<double>();
            joint_vals[3] = joints["joint4"].as<double>();
            joint_vals[4] = joints["joint5"].as<double>();
            joint_vals[5] = joints["joint6"].as<double>();

            std::string name = pt["name"].as<std::string>();
            new_map[name] = joint_vals;
        }

        // Atomically swap the new map in
        target_map_ = std::move(new_map);
        last_write_time_ = std::filesystem::last_write_time(yaml_filepath_);
        yaml_loaded_ = true;
    }
    catch (const std::exception &e)
    {
        RCLCPP_ERROR(node_->get_logger(), "Failed to load target YAML: %s", e.what());
        yaml_loaded_ = false;
    }
}

void IsAtPose::jointStateCallback(const sensor_msgs::msg::JointState::SharedPtr msg)
{
    std::lock_guard<std::mutex> lock(joint_mutex_);
    current_joint_state_ = *msg;
}

BT::NodeStatus IsAtPose::tick()
{
    if (!yaml_loaded_)
    {
        RCLCPP_ERROR(node_->get_logger(), "YAML not loaded successfully");
        return BT::NodeStatus::FAILURE;
    }

    std::string target_name;
    if (!getInput("target_name", target_name))
    {
        RCLCPP_ERROR(node_->get_logger(), "Missing input [target_name]");
        return BT::NodeStatus::FAILURE;
    }

    std::lock_guard<std::mutex> yaml_lock(yaml_mutex_);
    auto it = target_map_.find(target_name);
    if (it == target_map_.end())
    {
        RCLCPP_ERROR(node_->get_logger(), "Target [%s] not found in YAML", target_name.c_str());
        return BT::NodeStatus::FAILURE;
    }

    std::vector<double> expected = it->second;

    std::lock_guard<std::mutex> joint_lock(joint_mutex_);
    if (current_joint_state_.position.size() < 6)
    {
        return BT::NodeStatus::FAILURE;
    }

    const double tolerance = 0.08; // 0.05 rad = ~2.8 degrees
    for (size_t i = 0; i < 6; ++i)
    {
        if (std::abs(current_joint_state_.position[i] - expected[i]) > tolerance)
        {
            return BT::NodeStatus::FAILURE;
        }
    }

    return BT::NodeStatus::SUCCESS;
}