/**
 * @file bt_copy_file.cpp
 * @author Adnan Alvi
 * @brief Behavior Tree node to copy a YAML file to a backup directory.
 * @version 1.0
 * @date 2025-09-19
 * @company Nextup Robotics Private Limited
 * @designation Robotics Software Engineer
 */

#include "bt_copy_file.hpp"
#include <fstream>
#include <filesystem>
#include <chrono>
#include <iomanip>
#include <sstream>

namespace bt_copy
{

CopyFile::CopyFile(
    const std::string& name,
    const BT::NodeConfiguration& config,
    const rclcpp::Node::SharedPtr& node)
    : BT::SyncActionNode(name, config), node_(node)
{
    copy_file_path_ = node_->declare_parameter<std::string>(
        "copy_file_path",
        "/home/nextup/NextupRobot/src/active_project_configs/planning_data/points.yaml");

    backup_dir_ = node_->declare_parameter<std::string>(
        "backup_dir",
        "/home/nextup/user_config_files/backup_files_bt/points");

    status_pub_ = node_->create_publisher<std_msgs::msg::String>(
        "/file_operation_status", 10);

    RCLCPP_INFO(node_->get_logger(), "Initializing CopyFile BT node...");
    RCLCPP_INFO(node_->get_logger(), "Input file path: %s", copy_file_path_.c_str());
    RCLCPP_INFO(node_->get_logger(), "Backup directory: %s", backup_dir_.c_str());
}

BT::PortsList CopyFile::providedPorts()
{
    return {
        BT::InputPort<std::string>("copy_file_path"),
        BT::InputPort<std::string>("backup_dir")
    };
}

BT::NodeStatus CopyFile::tick()
{
    std::string copy_file_path, backup_dir;
    if (!getInput("copy_file_path", copy_file_path)) {
        copy_file_path = copy_file_path_;
    }
    if (!getInput("backup_dir", backup_dir)) {
        backup_dir = backup_dir_;
    }

    // Generate timestamped backup filename
    auto now = std::chrono::system_clock::now();
    auto time_t = std::chrono::system_clock::to_time_t(now);
    std::stringstream ss;
    ss << std::put_time(std::localtime(&time_t), "%d%b%Y_%H%M%S.yaml");
    std::string backup_filename = ss.str();
    std::filesystem::path backup_path =
        std::filesystem::path(backup_dir) / backup_filename;

    try {
        // Step 1: Verify input file exists
        if (!std::filesystem::exists(copy_file_path)) {
            RCLCPP_ERROR(node_->get_logger(),
                         "Input file '%s' does not exist.",
                         copy_file_path.c_str());
            publishStatus("file_not_found");
            return BT::NodeStatus::FAILURE;
        }

        // Step 1.1: Skip backup if main file is already empty
        if (std::filesystem::file_size(copy_file_path) == 0) {
            RCLCPP_WARN(node_->get_logger(),
                        "Input file '%s' is already empty, skipping backup.",
                        copy_file_path.c_str());
            publishStatus("input_file_already_empty");
            return BT::NodeStatus::SUCCESS;
        }

        // Step 2: Ensure backup directory exists
        if (!std::filesystem::exists(backup_dir)) {
            std::filesystem::create_directories(backup_dir);
            RCLCPP_INFO(node_->get_logger(),
                        "Created backup directory '%s'.",
                        backup_dir.c_str());
        }

        // Step 3: Copy input file to backup
        std::filesystem::copy_file(
            copy_file_path,
            backup_path,
            std::filesystem::copy_options::overwrite_existing);

        // Step 3.1: Verify backup file is non-empty
        if (std::filesystem::file_size(backup_path) == 0) {
            RCLCPP_ERROR(node_->get_logger(),
                         "Backup file '%s' is empty after copy!",
                         backup_path.c_str());
            publishStatus("backup_failed_empty");
            return BT::NodeStatus::FAILURE;
        }

        RCLCPP_INFO(node_->get_logger(),
                    "Backed up '%s' → '%s'.",
                    copy_file_path.c_str(),
                    backup_path.c_str());
        publishStatus("file_backup_successful");

        return BT::NodeStatus::SUCCESS;
    }
    catch (const std::exception& e) {
        RCLCPP_ERROR(node_->get_logger(),
                     "Error in CopyFile: %s", e.what());
        publishStatus("general_error");
        return BT::NodeStatus::FAILURE;
    }
}

void CopyFile::publishStatus(const std::string& status)
{
    std_msgs::msg::String msg;
    msg.data = status;
    status_pub_->publish(msg);
    RCLCPP_INFO(node_->get_logger(),
                "Published status: '%s'",
                msg.data.c_str());
}

}  // namespace bt_copy