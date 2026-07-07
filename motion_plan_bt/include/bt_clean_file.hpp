/**
 * @file bt_clean_file.hpp
 * @author Adnan Alvi
 * @brief Header file for Behavior Tree node to clear a YAML file.
 * @version 1.0
 * @date 2025-09-19
 * @company Nextup Robotics Private Limited
 * @designation Robotics Software Engineer
 */

#ifndef BT_PLANNING_BACKEND_BT_CLEAN_FILE_HPP
#define BT_PLANNING_BACKEND_BT_CLEAN_FILE_HPP

#include <behaviortree_cpp_v3/action_node.h>
#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/string.hpp>

namespace bt_clean
{

class CleanFile : public BT::SyncActionNode
{
public:
    CleanFile(
        const std::string& name,
        const BT::NodeConfiguration& config,
        const rclcpp::Node::SharedPtr& node);

    static BT::PortsList providedPorts();

    BT::NodeStatus tick() override;

private:
    void publishStatus(const std::string& status);

    rclcpp::Node::SharedPtr node_;
    rclcpp::Publisher<std_msgs::msg::String>::SharedPtr status_pub_;
    std::string clean_file_path_;
};

}  // namespace bt_clean

#endif  // BT_PLANNING_BACKEND_BT_CLEAN_FILE_HPP