#pragma once

#include <behaviortree_cpp_v3/condition_node.h>
#include <rclcpp/rclcpp.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <yaml-cpp/yaml.h>
#include <unordered_map>
#include <vector>
#include <string>
#include <mutex>
#include <filesystem>
#include <chrono>
#include <atomic>

class IsAtPose : public BT::ConditionNode
{
public:
    IsAtPose(const std::string &name, const BT::NodeConfiguration &config);

    static BT::PortsList providedPorts()
    {
        return { BT::InputPort<std::string>("target_name") };
    }

    BT::NodeStatus tick() override;

private:
    rclcpp::Node::SharedPtr node_;
    rclcpp::Subscription<sensor_msgs::msg::JointState>::SharedPtr joint_state_sub_;
    std::mutex joint_mutex_;
    std::mutex yaml_mutex_;
    sensor_msgs::msg::JointState current_joint_state_;

    std::unordered_map<std::string, std::vector<double>> target_map_;
    std::string yaml_filepath_;
    std::filesystem::file_time_type last_write_time_;
    std::atomic<bool> yaml_loaded_{false};

    void jointStateCallback(const sensor_msgs::msg::JointState::SharedPtr msg);
    void loadTargetYaml();
    void checkForYamlUpdates();
    void startFileWatcher();
};