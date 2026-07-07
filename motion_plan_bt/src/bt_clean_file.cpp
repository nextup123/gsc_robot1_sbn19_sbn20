/**
 * @file bt_clean_file.cpp
 * @author Adnan Alvi
 * @brief Behavior Tree node to clear a YAML file.
 * @version 1.0
 * @date 2025-09-19
 * @company Nextup Robotics Private Limited
 * @designation Robotics Software Engineer
 */

#include "bt_clean_file.hpp"
#include <fstream>
#include <filesystem>

namespace bt_clean
{

CleanFile::CleanFile(
    const std::string& name,
    const BT::NodeConfiguration& config,
    const rclcpp::Node::SharedPtr& node)
    : BT::SyncActionNode(name, config), node_(node)
{
    clean_file_path_ = node_->declare_parameter<std::string>(
        "clean_file_path",
        "/home/nextup/NextupRobot/src/active_project_configs/planning_data/points.yaml");

    status_pub_ = node_->create_publisher<std_msgs::msg::String>(
        "/file_operation_status", 10);

    RCLCPP_INFO(node_->get_logger(), "Initializing CleanFile BT node...");
    RCLCPP_INFO(node_->get_logger(), "Input file path: %s", clean_file_path_.c_str());
}

BT::PortsList CleanFile::providedPorts()
{
    return {
        BT::InputPort<std::string>("clean_file_path")
    };
}

BT::NodeStatus CleanFile::tick()
{
    std::string clean_file_path;
    if (!getInput("clean_file_path", clean_file_path)) {
        clean_file_path = clean_file_path_;
    }

    try {
        // Step 1: Verify input file exists
        if (!std::filesystem::exists(clean_file_path)) {
            RCLCPP_ERROR(node_->get_logger(),
                         "Input file '%s' does not exist.",
                         clean_file_path.c_str());
            publishStatus("file_not_found");
            return BT::NodeStatus::FAILURE;
        }

        // Step 2: Clear the input file
        {
            std::ofstream ofs(clean_file_path,
                              std::ofstream::out | std::ofstream::trunc);
            if (!ofs.is_open()) {
                RCLCPP_ERROR(node_->get_logger(),
                             "Failed to open '%s' for clearing.",
                             clean_file_path.c_str());
                publishStatus("file_clear_failed");
                return BT::NodeStatus::FAILURE;
            }
        }

        // Step 3: Verify file is empty
        auto cleared_size = std::filesystem::file_size(clean_file_path);
        if (cleared_size == 0) {
            RCLCPP_INFO(node_->get_logger(),
                        "Cleared file '%s' successfully (size = 0).",
                        clean_file_path.c_str());
            publishStatus("file_cleared");
            return BT::NodeStatus::SUCCESS;
        } else {
            RCLCPP_WARN(node_->get_logger(),
                        "File '%s' not empty after clear (size = %zu).",
                        clean_file_path.c_str(), cleared_size);
            publishStatus("file_clear_incomplete");
            return BT::NodeStatus::FAILURE;
        }
    }
    catch (const std::exception& e) {
        RCLCPP_ERROR(node_->get_logger(),
                     "Error in CleanFile: %s", e.what());
        publishStatus("general_error");
        return BT::NodeStatus::FAILURE;
    }
}

void CleanFile::publishStatus(const std::string& status)
{
    std_msgs::msg::String msg;
    msg.data = status;
    status_pub_->publish(msg);
    RCLCPP_INFO(node_->get_logger(),
                "Published status: '%s'",
                msg.data.c_str());
}

}  // namespace bt_clean