#pragma once

#include <behaviortree_cpp_v3/action_node.h>
#include <moveit/move_group_interface/move_group_interface.h>
#include <geometry_msgs/msg/pose_stamped.hpp>
#include <rclcpp/rclcpp.hpp>
#include <yaml-cpp/yaml.h>
#include <Eigen/Geometry>

#include <string>
#include <unordered_map>
#include <vector>
#include <future>
#include <memory>

class PilzPointsPlanner : public BT::StatefulActionNode
{
public:
    PilzPointsPlanner(const std::string& name, const BT::NodeConfiguration& config);

    static BT::PortsList providedPorts();

    // StatefulActionNode interface
    BT::NodeStatus onStart() override;
    BT::NodeStatus onRunning() override;
    void onHalted() override;

private:
    enum class State
    {
        IDLE,
        PLANNING_PTP,
        PLANNING_LIN,
        EXECUTING_PTP,
        EXECUTING_LIN
    };

    void loadJointTargetsFromYaml(const std::string& filepath);

    bool runPTP(const std::vector<double>& target, double speed, double accel);
    bool runLIN(const std::vector<double>& target, double speed, double accel);

    // Async helpers
    bool startPTPPlanning(const std::vector<double>& target, double speed, double accel);
    bool startLINPlanning(const std::vector<double>& target, double speed, double accel);
    bool isPlanningComplete();
    bool startExecution();
    bool isExecutionComplete();

    rclcpp::Node::SharedPtr node_;
    std::shared_ptr<moveit::planning_interface::MoveGroupInterface> move_group_;

    std::unordered_map<std::string, std::vector<double>> joint_targets_;

    const std::string yaml_path_ =
        "/home/nextup/NextupRobot/src/active_project_configs/planning_data/points.yaml";

    const std::string pose_reference_frame_ = "base_link";

    // State tracking
    State current_state_ = State::IDLE;
    std::string current_pose_goal_;
    std::string current_planner_id_;
    double current_speed_factor_ = 0.1;
    double current_accel_factor_ = 1.0;   // NEW: acceleration scaling factor
    std::vector<double> current_target_;

    // Async operation futures
    std::shared_future<bool> planning_future_;
    std::shared_future<bool> execution_future_;

    // Stored plan for execution
    moveit::planning_interface::MoveGroupInterface::Plan stored_plan_;
};