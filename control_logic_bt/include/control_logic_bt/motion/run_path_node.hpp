#pragma once

#include <behaviortree_cpp_v3/action_node.h>
#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/string.hpp>
#include <std_msgs/msg/float64.hpp>
#include <string>
#include <mutex>
#include <atomic>

class RunPath : public BT::SyncActionNode
{
public:
    RunPath(const std::string &name, const BT::NodeConfiguration &config);

    static BT::PortsList providedPorts()
    {
        return {
            BT::InputPort<std::string>("path_name"),
            BT::InputPort<double>("speed_scale")  // Original speed from XML
        };
    }

    BT::NodeStatus tick() override;

private:
    static rclcpp::Node::SharedPtr node_;
    static rclcpp::Publisher<std_msgs::msg::String>::SharedPtr path_pub_;
    static rclcpp::Subscription<std_msgs::msg::String>::SharedPtr status_sub_;
    static rclcpp::Subscription<std_msgs::msg::Float64>::SharedPtr speed_scale_sub_;

    static std::string current_path_name_;
    static std::string current_status_;
    static std::mutex mutex_;

    static std::atomic<double> dynamic_speed_scale_;  // For runtime overrides
    static std::atomic<bool> use_dynamic_scale_;      // Flag to toggle override

    static void statusCallback(const std_msgs::msg::String::SharedPtr msg);
    static void speedScaleCallback(const std_msgs::msg::Float64::SharedPtr msg);
};