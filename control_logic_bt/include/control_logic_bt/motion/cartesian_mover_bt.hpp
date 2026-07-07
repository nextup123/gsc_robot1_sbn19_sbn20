#pragma once

#include <behaviortree_cpp_v3/behavior_tree.h>
#include <behaviortree_cpp_v3/bt_factory.h>
#include <rclcpp/rclcpp.hpp>
#include <rclcpp_action/rclcpp_action.hpp>
#include <moveit_msgs/action/move_group.hpp>
#include <moveit_msgs/msg/motion_plan_request.hpp>
#include <moveit_msgs/msg/constraints.hpp>
#include <moveit_msgs/msg/position_constraint.hpp>
#include <moveit_msgs/msg/orientation_constraint.hpp>
#include <moveit_msgs/msg/bounding_volume.hpp>
#include <moveit_msgs/msg/robot_state.hpp>
#include <geometry_msgs/msg/pose.hpp>
#include <shape_msgs/msg/solid_primitive.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <yaml-cpp/yaml.h>

#include <cmath>
#include <memory>
#include <string>
#include <vector>
#include <map>
#include <optional>
#include <thread>
#include <chrono>
#include <fstream>
#include <future>
#include <iomanip>

using MoveGroupAction = moveit_msgs::action::MoveGroup;
using GoalHandleMoveGroup = rclcpp_action::ClientGoalHandle<MoveGroupAction>;

namespace control_logic_bt
{

// ============================================================================
// CONFIGURATION STRUCTURES
// ============================================================================

struct Workspace {
    std::pair<double, double> x = {-0.65, 0.65};
    std::pair<double, double> y = {-0.90, 0.90};
    std::pair<double, double> z = {0.20, 1.50};
};

struct PointData {
    std::string name;
    std::string date_time;
    int sequence;
    std::string nature;
    bool is_tf;
    std::map<std::string, double> joints_values;
    struct {
        double x, y, z;
        double r, p, w;
    } coordinate;
};

struct PlannerConfig {
    std::string pipeline;
    std::string planner;
    std::string description;
    double velocity;
    double timeout;
};

struct Quaternion {
    double x, y, z, w;
};

// ============================================================================
// BT NODE: CartesianMoverBT
// ============================================================================

class CartesianMoverBT : public BT::SyncActionNode
{
public:
    CartesianMoverBT(const std::string& name, const BT::NodeConfiguration& config);
    ~CartesianMoverBT();

    static BT::PortsList providedPorts();
    BT::NodeStatus tick() override;

private:
    // Initialization
    void initialize();
    bool loadPointsFromYAML();
    void initPlanners();
    
    // Point management
    PointData* findPointByName(const std::string& name);
    // std::vector<double> getJointValuesInOrder(const PointData& point);
    std::vector<double> getJointValuesInOrder(const PointData& point) const;
    void listAllPoints() const;
    
    // Movement methods
    bool moveToPointJoints(const std::string& point_name,
                           const std::string& planner,
                           double velocity_scaling,
                           double planning_timeout);
    
    bool moveToJointState(const std::vector<double>& target_joints,
                          const std::string& planner,
                          double velocity_scaling,
                          double planning_timeout);
    
    bool moveToPointCartesian(const std::string& point_name,
                              const std::string& planner,
                              double orientation_tolerance,
                              double position_tolerance);
    
    bool checkWorkspace(double x, double y, double z);
    
    // Utility functions
    Quaternion rpyToQuat(double roll, double pitch, double yaw);
    inline double deg2rad(double deg) { return deg * M_PI / 180.0; }
    inline double rad2deg(double rad) { return rad * 180.0 / M_PI; }
    
    // Callbacks
    void jointCallback(const sensor_msgs::msg::JointState::SharedPtr msg);
    
    // ROS2 components
    rclcpp::Node::SharedPtr node_;
    rclcpp_action::Client<MoveGroupAction>::SharedPtr client_;
    rclcpp::Subscription<sensor_msgs::msg::JointState>::SharedPtr joint_sub_;
    rclcpp::executors::SingleThreadedExecutor::SharedPtr executor_;
    std::thread spin_thread_;
    
    // State
    std::vector<double> current_joints_;
    bool joints_received_;
    Workspace workspace_;
    std::vector<PointData> points_;
    std::map<std::string, PlannerConfig> planners_;
};

} // namespace control_logic_bt