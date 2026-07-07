/**
 * @file bt_plan_path.hpp
 * @author Adnan Alvi
 * @brief Header file for the PlanPath Behavior Tree node and PathSaver utility.
 * @version 2.0
 * @date 2025-09-12
 * @company Nextup Robotics Private Limited
 * @designation Robotics Software Engineer
 */

#ifndef BT_PLAN_PATH_HPP_
#define BT_PLAN_PATH_HPP_

#include <behaviortree_cpp_v3/action_node.h>
#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/string.hpp>
#include <moveit_msgs/msg/robot_trajectory.hpp>
#include <moveit/move_group_interface/move_group_interface.h>
#include <geometry_msgs/msg/pose.hpp>
#include <Eigen/Geometry>
#include <yaml-cpp/yaml.h>
#include <ament_index_cpp/get_package_share_directory.hpp>

#include <map>
#include <set>
#include <string>
#include <vector>
#include <functional>

namespace bt_plan
{

/**
 * @brief Utility class for loading joint positions from YAML.
 */
class WaypointLoader
{
public:
    static bool loadJointPositions(
        const std::string& file_path,
        const std::vector<std::string>& required_joints,
        std::map<std::string, std::map<std::string, double>>& joint_positions,
        const rclcpp::Logger& logger,
        std::function<void(const std::string&)> status_callback);
};

/**
 * @brief Utility class for transforms.
 */
class TransformUtils
{
public:
    static geometry_msgs::msg::Pose toPose(const Eigen::Isometry3d& transform);
};

/**
 * @brief Utility class for saving executed paths into YAML.
 */
class PathSaver
{
public:
    PathSaver(const rclcpp::Node::SharedPtr& node);

    /**
     * @brief Save path into YAML file after successful planning.
     * @param path_name Name of the planned path.
     * @param plan_space Type of planning space ("Joint" or "Cartesian").
     * @param trajectory The trajectory to be saved.
     */
    void savePath(
        const std::string& path_name,
        const std::string& plan_space,
        const moveit_msgs::msg::RobotTrajectory& trajectory, const std::string &start_goal, const std::string &end_goal);

private:
    rclcpp::Node::SharedPtr node_;
    std::string yaml_file_;
};

/**
 * @brief Behavior Tree Action Node for motion planning.
 */
class PlanPath : public BT::StatefulActionNode
{
public:
    PlanPath(
        const std::string& name,
        const BT::NodeConfiguration& config,
        const rclcpp::Node::SharedPtr& node);

    static BT::PortsList providedPorts();

private:
    BT::NodeStatus onStart() override;
    BT::NodeStatus onRunning() override;
    void onHalted() override;

    void publishStatus(const std::string& status, const std::string& path_name);
    void publishStatus(const std::string& status, const std::string& path_name, size_t num_points, double duration);

    bool performCartesianPlanning(const std::vector<std::string>& waypoints, const std::string& path_name, const std::string &start_goal, const std::string &end_goal);
    bool performJointPlanning(const std::vector<std::string>& waypoints, const std::string& path_name, const std::string &start_goal, const std::string &end_goal);

    rclcpp::Node::SharedPtr node_;
    rclcpp::Publisher<std_msgs::msg::String>::SharedPtr planning_status_pub_;
    rclcpp::Publisher<moveit_msgs::msg::RobotTrajectory>::SharedPtr trajectory_pub_;
    std::shared_ptr<moveit::planning_interface::MoveGroupInterface> move_group_;
    std::map<std::string, std::map<std::string, double>> joint_positions_;
    std::string planning_group_;
    std::string yaml_file_;
    double eef_step_;
    double jump_threshold_;

    std::shared_ptr<PathSaver> path_saver_;
};

}  // namespace bt_plan

#endif  // BT_PLAN_PATH_HPP_
