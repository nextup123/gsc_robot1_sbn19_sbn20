#pragma once

#include <behaviortree_cpp_v3/action_node.h>
#include <rclcpp/rclcpp.hpp>

#include <geometry_msgs/msg/pose_stamped.hpp>

#include <tf2_ros/buffer.h>
#include <tf2_ros/transform_listener.h>
#include <tf2_geometry_msgs/tf2_geometry_msgs.hpp>

#include <moveit/move_group_interface/move_group_interface.h>

#include <future>

class PilzMotionPlanner : public BT::StatefulActionNode
{
public:
  PilzMotionPlanner(const std::string& name,
                    const BT::NodeConfiguration& config);

  static BT::PortsList providedPorts();

  BT::NodeStatus onStart() override;
  BT::NodeStatus onRunning() override;
  void onHalted() override;

private:
  geometry_msgs::msg::PoseStamped buildPose();

  // ROS
  rclcpp::Node::SharedPtr node_;
  std::shared_ptr<moveit::planning_interface::MoveGroupInterface> move_group_;

  std::shared_ptr<tf2_ros::Buffer> tf_buffer_;
  std::shared_ptr<tf2_ros::TransformListener> tf_listener_;

  // Inputs
  std::string frame_;
  std::string planner_id_;
  double max_vel_;
  double max_acc_;

  double x_, y_, z_, r_, p_, w_;

  // State
  std::future<bool> exec_future_;
};