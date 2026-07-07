/**
 * @file bt_copy_fields.cpp
 * @author Adnan
 * @brief Behavior Tree node to copy specified fields from points.yaml to the top of paths.yaml.
 * @version 2.0
 * @date 2025-09-19
 * @company Nextup Robotics Private Limited
 * @designation Robotics Software Engineer
 */

#include "bt_copy_field.hpp"

#include <fstream>          // For file writing
#include <filesystem>       // For file existence checks
#include <yaml-cpp/yaml.h>  // For parsing/writing YAML
#include <cerrno>           // For error codes
#include <cstring>          // For strerror()

namespace bt_copy_fields
{

// =============================
// Constructor
// =============================
CopyFields::CopyFields(
    const std::string &name,
    const BT::NodeConfiguration &config,
    const rclcpp::Node::SharedPtr &node)
    : BT::SyncActionNode(name, config), node_(node)
{
    // Declare ROS parameters (default paths + fields to copy)
    points_file_path_ = node_->declare_parameter<std::string>(
        "points_file_path",
        "/home/nextup/NextupRobot/src/active_project_configs/planning_data/points.yaml");

    paths_file_path_ = node_->declare_parameter<std::string>(
        "paths_file_path",
        "/home/nextup/NextupRobot/src/active_project_configs/planning_data/paths.yaml");

    fields_to_copy_ = node_->declare_parameter<std::vector<std::string>>(
        "fields_to_copy",
        {"points_file_name"}); // Default: copy only "points_file_name"

    // Create status publisher
    status_pub_ = node_->create_publisher<std_msgs::msg::String>(
        "/field_copy_status", 10);

    // Log initialization
    RCLCPP_INFO(node_->get_logger(), "Initializing CopyFields BT node...");
    RCLCPP_INFO(node_->get_logger(), "Input file path: %s", points_file_path_.c_str());
    RCLCPP_INFO(node_->get_logger(), "Paths file path: %s", paths_file_path_.c_str());
}

// =============================
// Ports
// =============================
BT::PortsList CopyFields::providedPorts()
{
    return {
        BT::InputPort<std::string>("points_file_path"),
        BT::InputPort<std::string>("paths_file_path")};
}

// =============================
// Tick (main execution)
// =============================
BT::NodeStatus CopyFields::tick()
{
    // 1. Read ports (if provided), otherwise fall back to parameters
    std::string points_file_path, paths_file_path;
    if (!getInput("points_file_path", points_file_path))
    {
        points_file_path = points_file_path_;
    }
    if (!getInput("paths_file_path", paths_file_path))
    {
        paths_file_path = paths_file_path_;
    }

    try
    {
        // 2. Check if input file exists
        if (!std::filesystem::exists(points_file_path))
        {
            RCLCPP_ERROR(node_->get_logger(),
                         "Input file '%s' does not exist.",
                         points_file_path.c_str());
            publishStatus("file_not_found");
            return BT::NodeStatus::FAILURE;
        }

        // 3. Load input YAML
        YAML::Node input_yaml = YAML::LoadFile(points_file_path);
        YAML::Node fields_to_write;

        // Extract only the requested fields
        for (const auto &field : fields_to_copy_)
        {
            if (input_yaml[field])
            {
                fields_to_write[field] = input_yaml[field];
            }
            else
            {
                RCLCPP_WARN(node_->get_logger(),
                            "Field '%s' not found in '%s'.",
                            field.c_str(), points_file_path.c_str());
            }
        }

        // 4. Load existing paths.yaml if present
        YAML::Node paths_yaml;
        if (std::filesystem::exists(paths_file_path))
        {
            try
            {
                paths_yaml = YAML::LoadFile(paths_file_path);
            }
            catch (const YAML::Exception &e)
            {
                RCLCPP_WARN(node_->get_logger(),
                            "Failed to parse '%s': %s. Proceeding with empty paths.yaml.",
                            paths_file_path.c_str(), e.what());
                paths_yaml = YAML::Node();
            }
        }

        // 5. Construct new YAML content:
        //    - First add copied fields
        //    - Then add all other existing fields
        YAML::Node new_paths_yaml;
        for (const auto &field : fields_to_copy_)
        {
            if (fields_to_write[field])
            {
                new_paths_yaml[field] = fields_to_write[field];
            }
        }
        for (const auto &pair : paths_yaml)
        {
            // Avoid overwriting fields we just copied
            if (std::find(fields_to_copy_.begin(), fields_to_copy_.end(),
                          pair.first.as<std::string>()) == fields_to_copy_.end())
            {
                new_paths_yaml[pair.first] = pair.second;
            }
        }

        // 6. Write new content directly to file
        std::ofstream ofs(paths_file_path, std::ofstream::out | std::ofstream::trunc);
        if (!ofs.is_open())
        {
            std::string err = "Failed to open '" + paths_file_path +
                              "' for writing: " + std::strerror(errno);
            RCLCPP_ERROR(node_->get_logger(), "%s", err.c_str());
            publishStatus("paths_file_open_failed: " + err);
            return BT::NodeStatus::FAILURE;
        }

        ofs << new_paths_yaml;
        ofs.close();

        if (ofs.fail())
        {
            std::string err = "Failed to close '" + paths_file_path +
                              "': " + std::strerror(errno);
            RCLCPP_ERROR(node_->get_logger(), "%s", err.c_str());
            publishStatus("paths_file_close_failed: " + err);
            return BT::NodeStatus::FAILURE;
        }

        // 7. Success
        RCLCPP_INFO(node_->get_logger(),
                    "Successfully updated paths file '%s' with fields from '%s'.",
                    paths_file_path.c_str(), points_file_path.c_str());
        publishStatus("paths_file_updated");
        return BT::NodeStatus::SUCCESS;
    }
    catch (const YAML::Exception &e)
    {
        RCLCPP_ERROR(node_->get_logger(),
                     "YAML error: %s", e.what());
        publishStatus("yaml_error: " + std::string(e.what()));
        return BT::NodeStatus::FAILURE;
    }
    catch (const std::exception &e)
    {
        RCLCPP_ERROR(node_->get_logger(),
                     "Unexpected error: %s", e.what());
        publishStatus("general_error: " + std::string(e.what()));
        return BT::NodeStatus::FAILURE;
    }
}

// =============================
// Helper: Publish status message
// =============================
void CopyFields::publishStatus(const std::string &status)
{
    std_msgs::msg::String msg;
    msg.data = status;
    status_pub_->publish(msg);

    RCLCPP_INFO(node_->get_logger(),
                "Published status: '%s'", msg.data.c_str());
}

} // namespace bt_copy_fields
