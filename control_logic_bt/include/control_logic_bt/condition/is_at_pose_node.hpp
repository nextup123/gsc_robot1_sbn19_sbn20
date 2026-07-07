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
#include <thread>

// IsAtPose
// ------------------------------------------------------------------
// Condition node: SUCCESS if the robot's current joint state matches a
// named target (from points.yaml) within tolerance, else FAILURE.
//
// Design (matches CheckTopic pattern):
//   * NO work in the constructor -> safe during tree validation, and
//     no duplicate nodes / threads when the tree is built twice.
//   * Uses the SHARED runner node from the blackboard ("node").
//   * Subscribes to /joint_states exactly once, on first tick.
//   * NO detached threads. YAML hot-reload is done by an mtime check
//     folded into tick() (throttled), so there is no thread capturing
//     `this` that can outlive the node (this was the segfault cause).
//   * Joint matching is by NAME, not by array index.
//
// Ports:
//   target_name (std::string) : name of the target pose in points.yaml
//   tolerance   (double, opt) : per-joint tolerance in rad. Default 0.05.
// ------------------------------------------------------------------
class IsAtPose : public BT::ConditionNode
{
public:
    IsAtPose(const std::string &name, const BT::NodeConfiguration &config);

    static BT::PortsList providedPorts()
    {
        return {
            BT::InputPort<std::string>("target_name", "Named pose in points.yaml"),
            BT::InputPort<double>("tolerance", 0.05,
                                  "Per-joint match tolerance in radians (default 0.05)")
        };
    }

    BT::NodeStatus tick() override;

private:
    bool ensureNode();
    void ensureSubscription();
    void loadTargetYaml();
    void maybeReloadYaml();   // mtime check, called from tick (throttled)

    void jointStateCallback(const sensor_msgs::msg::JointState::SharedPtr msg);

    rclcpp::Node::SharedPtr node_;
    rclcpp::Subscription<sensor_msgs::msg::JointState>::SharedPtr joint_state_sub_;
    bool self_spun_{false};
    bool subscribed_{false};

    std::mutex joint_mutex_;
    // name -> position, filled from the latest /joint_states message
    std::unordered_map<std::string, double> current_positions_;
    bool have_joint_state_{false};

    std::mutex yaml_mutex_;
    // target name -> { joint1..joint6 } in fixed order
    std::unordered_map<std::string, std::vector<double>> target_map_;
    // joint name order used for the target vectors
    std::vector<std::string> joint_order_{
        "joint1","joint2","joint3","joint4","joint5","joint6"};

    std::string yaml_filepath_;
    std::filesystem::file_time_type last_write_time_;
    bool yaml_time_valid_{false};
    std::atomic<bool> yaml_loaded_{false};

    // Throttle the mtime check so we don't stat() the file every tick.
    std::chrono::steady_clock::time_point last_yaml_check_{};
};