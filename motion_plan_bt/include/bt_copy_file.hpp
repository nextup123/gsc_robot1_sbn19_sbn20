/**
 * @file bt_copy_file.hpp
 * @author Adnan Alvi
 * @brief Header file for Behavior Tree node to copy a YAML file to a backup directory.
 * @version 1.0
 * @date 2025-09-19
 * @company Nextup Robotics Private Limited
 * @designation Robotics Software Engineer
 */

#ifndef BT_PLANNING_BACKEND_BT_COPY_FILE_HPP
#define BT_PLANNING_BACKEND_BT_COPY_FILE_HPP

#include <behaviortree_cpp_v3/action_node.h>
#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/string.hpp>

namespace bt_copy
{

class CopyFile : public BT::SyncActionNode
{
public:
    CopyFile(
        const std::string& name,
        const BT::NodeConfiguration& config,
        const rclcpp::Node::SharedPtr& node);

    static BT::PortsList providedPorts();

    BT::NodeStatus tick() override;

private:
    void publishStatus(const std::string& status);

    rclcpp::Node::SharedPtr node_;
    rclcpp::Publisher<std_msgs::msg::String>::SharedPtr status_pub_;
    std::string copy_file_path_;
    std::string backup_dir_;
};

}  // namespace bt_copy

#endif  // BT_PLANNING_BACKEND_BT_COPY_FILE_HPP