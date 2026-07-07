/**
 * @file bt_points_path_verification.hpp
 * @author Adnan Alvi
 * @brief Header file for Behavior Tree node to verify paths from specified paths.yaml against points.yaml.
 * @version 1.4
 * @date 2025-09-29
 * @company Nextup Robotics Private Limited
 * @designation Robotics Software Engineer
 */

#ifndef BT_POINTS_PATH_VERIFICATION_HPP
#define BT_POINTS_PATH_VERIFICATION_HPP

#include <rclcpp/rclcpp.hpp>
#include <behaviortree_cpp_v3/action_node.h>
#include <string>

namespace bt_point_path_verification
{

class PathVerifier : public BT::SyncActionNode
{
public:
    PathVerifier(
        const std::string& name,
        const BT::NodeConfiguration& config,
        const rclcpp::Node::SharedPtr& node);

    static BT::PortsList providedPorts();

    BT::NodeStatus tick() override;

private:
    rclcpp::Node::SharedPtr node_;
};

}  // namespace bt_point_path_verification


#endif  // BT_POINTS_PATH_VERIFICATION_HPP