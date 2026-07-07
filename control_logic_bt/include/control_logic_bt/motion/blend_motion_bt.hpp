#pragma once

#include <behaviortree_cpp_v3/action_node.h>
#include <rclcpp/rclcpp.hpp>
#include <rclcpp_action/rclcpp_action.hpp>
#include <moveit/move_group_interface/move_group_interface.h>
#include <moveit_msgs/action/move_group_sequence.hpp>
#include <visualization_msgs/msg/marker_array.hpp>
#include <geometry_msgs/msg/pose.hpp>

#include <atomic>
#include <future>
#include <map>
#include <memory>
#include <string>
#include <thread>
#include <vector>

struct BlendPointData
{
  std::vector<double> joints;
  geometry_msgs::msg::Pose pose;
  bool found = false;
};

struct BlendSegmentConfig
{
  std::string from_label;
  std::string to_label;
  std::string planner;
  double blend_radius;
  double velocity_scaling;
  double acceleration_scaling;
  double original_blend_radius;
};

class BlendMotion : public BT::StatefulActionNode
{
public:
  BlendMotion(const std::string& name,
              const BT::NodeConfiguration& config);

  ~BlendMotion() override;

  static BT::PortsList providedPorts();

  BT::NodeStatus onStart() override;
  BT::NodeStatus onRunning() override;
  void onHalted() override;

private:
  // Helpers
  BlendPointData getPoint(const std::string& name);
  std::vector<BlendSegmentConfig> parseCommand(const std::string& cmd,
                                               std::string& error_msg);
  bool validateAndOptimizeSequence(
    std::vector<BlendSegmentConfig>& segs,
    const std::map<std::string, BlendPointData>& point_cache);
  bool moveToPoint(const BlendPointData& target,
                   const std::string& planner,
                   double velocity,
                   double acceleration);
  void publishMarker(const moveit_msgs::msg::RobotTrajectory& traj,
                     int id);

  // Core
  rclcpp::Node::SharedPtr node_;
  std::shared_ptr<moveit::planning_interface::MoveGroupInterface> move_group_;
  rclcpp_action::Client<moveit_msgs::action::MoveGroupSequence>::SharedPtr
    sequence_client_;
  rclcpp::Publisher<visualization_msgs::msg::MarkerArray>::SharedPtr
    marker_pub_;

  // Dedicated executor + spin thread for node_ (required so action client
  // callbacks fire while the BT runner's executor is doing other things)
  std::shared_ptr<rclcpp::executors::MultiThreadedExecutor> executor_;
  std::thread spin_thread_;
  std::atomic<bool> spinning_{false};

  // Async exec
  std::future<bool> exec_future_;

  // Tick-scope state
  std::string command_;
};