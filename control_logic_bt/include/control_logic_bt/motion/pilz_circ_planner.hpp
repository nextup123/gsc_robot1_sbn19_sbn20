#pragma once
#include <behaviortree_cpp_v3/action_node.h>

#include <moveit/move_group_interface/move_group_interface.h>
#include <moveit_msgs/msg/constraints.hpp>
#include <moveit_msgs/msg/position_constraint.hpp>
#include <shape_msgs/msg/solid_primitive.hpp>
#include <rclcpp/rclcpp.hpp>
#include <rclcpp/executors/single_threaded_executor.hpp>
#include <yaml-cpp/yaml.h>

#include <atomic>
#include <future>
#include <map>
#include <string>
#include <thread>
#include <vector>

struct PointData
{
    std::vector<double> joints;
    double x = 0.0;
    double y = 0.0;
    double z = 0.0;
};

class PilzCircPlanner : public BT::StatefulActionNode
{
public:
    PilzCircPlanner(const std::string& name,
                    const BT::NodeConfiguration& config);
    ~PilzCircPlanner() override;

    static BT::PortsList providedPorts();

    BT::NodeStatus onStart()   override;
    BT::NodeStatus onRunning() override;
    void           onHalted()  override;

private:
    enum class State { IDLE, PLANNING, EXECUTING };

    rclcpp::Node::SharedPtr                                         node_;
    std::shared_ptr<moveit::planning_interface::MoveGroupInterface> move_group_;
    rclcpp::executors::SingleThreadedExecutor                       executor_;
    std::thread                                                     spin_thread_;

    const std::string yaml_path_ =
        "/home/nextup/NextupRobot/src/active_project_configs/planning_data/points.yaml";

    std::map<std::string, PointData> point_data_;

    State                    current_state_ = State::IDLE;
    std::shared_future<bool> planning_future_;
    std::shared_future<bool> execution_future_;

    moveit::planning_interface::MoveGroupInterface::Plan stored_plan_;

    // Cached per-tick inputs
    PointData active_goal_;
    PointData active_interim_;
    double    active_velocity_    = 0.1;
    double    active_acceleration_= 0.1;

    void loadPointsFromYaml(const std::string& filepath);
    bool startPlanning(const PointData& goal, const PointData& interim,
                       double velocity, double acceleration);
    bool startExecution();
};