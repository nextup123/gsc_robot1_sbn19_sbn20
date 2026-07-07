/**
 * @file bt_points_path_verification.cpp
 * @author Adnan Alvi
 * @brief Implementation of Behavior Tree node to verify paths from specified paths.yaml against points.yaml with detailed logging.
 * @version 1.5
 * @date 2025-09-29
 * @company Nextup Robotics Private Limited
 * @designation Robotics Software Engineer
 */

#include "bt_point_path_verification.hpp"
#include <yaml-cpp/yaml.h>
#include <std_msgs/msg/string.hpp>
#include <array>
#include <vector>
#include <string>
#include <filesystem>
#include <cmath>
#include <sstream>

namespace bt_point_path_verification
{

PathVerifier::PathVerifier(
    const std::string& name,
    const BT::NodeConfiguration& config,
    const rclcpp::Node::SharedPtr& node)
    : BT::SyncActionNode(name, config), node_(node)
{
    RCLCPP_INFO(node_->get_logger(), "Initializing PathVerifier BT node '%s'...", name.c_str());
}

BT::PortsList PathVerifier::providedPorts()
{
    return {
        BT::InputPort<double>("tolerance", 1e-6, "Tolerance for floating-point comparison of joint values"),
        BT::InputPort<std::string>("paths_file_name", "paths.yaml", "Name or path of the paths YAML file"),
        BT::InputPort<std::string>("points_file_name", "points.yaml", "Name or path of the points YAML file")
    };
}

BT::NodeStatus PathVerifier::tick()
{
    // Get tolerance input
    double tolerance;
    if (!getInput("tolerance", tolerance) || tolerance <= 0.0) {
        RCLCPP_ERROR(node_->get_logger(), "Invalid or missing 'tolerance' for node '%s'. Must be positive.", name().c_str());
        return BT::NodeStatus::FAILURE;
    }

    // Get paths file name input
    std::string paths_file;
    if (!getInput("paths_file_name", paths_file) || paths_file.empty()) {
        RCLCPP_ERROR(node_->get_logger(), "Missing or empty 'paths_file_name' for node '%s'.", name().c_str());
        return BT::NodeStatus::FAILURE;
    }

    // Get points file name input
    std::string points_file;
    if (!getInput("points_file_name", points_file) || points_file.empty()) {
        RCLCPP_ERROR(node_->get_logger(), "Missing or empty 'points_file_name' for node '%s'.", name().c_str());
        return BT::NodeStatus::FAILURE;
    }

    // Resolve paths: assume relative paths are under specific directories if not absolute
    std::string paths_file_path = paths_file;
    if (!std::filesystem::path(paths_file).is_absolute()) {
        paths_file_path = "/home/nextup/NextupRobot/src/active_project_configs/planning_data" + paths_file;
    }

    std::string points_file_path = points_file;
    if (!std::filesystem::path(points_file).is_absolute()) {
        points_file_path = "/home/nextup/NextupRobot/src/active_project_configs/planning_data" + points_file;
    }

    // Check if files exist
    if (!std::filesystem::exists(paths_file_path)) {
        RCLCPP_ERROR(node_->get_logger(), "Paths file '%s' does not exist.", paths_file_path.c_str());
        return BT::NodeStatus::FAILURE;
    }
    if (!std::filesystem::exists(points_file_path)) {
        RCLCPP_ERROR(node_->get_logger(), "Points file '%s' does not exist.", points_file_path.c_str());
        return BT::NodeStatus::FAILURE;
    }

    RCLCPP_INFO(node_->get_logger(), "Loading points from '%s' and paths from '%s' with tolerance %g",
                points_file_path.c_str(), paths_file_path.c_str(), tolerance);

    const std::string toast_topic = "/bt_toast_popup";
    auto toast_pub = node_->create_publisher<std_msgs::msg::String>(toast_topic, 10);

    try {
        // Load points YAML
        YAML::Node points_node = YAML::LoadFile(points_file_path);
        if (!points_node["points"] || !points_node["points"].IsSequence()) {
            RCLCPP_ERROR(node_->get_logger(), "Invalid points YAML structure in '%s'", points_file_path.c_str());
            return BT::NodeStatus::FAILURE;
        }

        // Map point names to joint values (array of 6 doubles)
        std::unordered_map<std::string, std::array<double, 6>> point_joints;
        for (const auto& point : points_node["points"]) {
            std::string name = point["name"].as<std::string>();
            std::array<double, 6> joints = {
                point["joints_values"]["joint1"].as<double>(),
                point["joints_values"]["joint2"].as<double>(),
                point["joints_values"]["joint3"].as<double>(),
                point["joints_values"]["joint4"].as<double>(),
                point["joints_values"]["joint5"].as<double>(),
                point["joints_values"]["joint6"].as<double>()
            };
            point_joints[name] = joints;

            // Log loaded point joint values
            std::stringstream joints_ss;
            joints_ss << "[" << joints[0];
            for (size_t i = 1; i < 6; ++i) joints_ss << ", " << joints[i];
            joints_ss << "]";
            RCLCPP_INFO(node_->get_logger(), "Loaded point '%s' with joint values: %s",
                        name.c_str(), joints_ss.str().c_str());
        }

        // Load paths YAML
        YAML::Node paths_node = YAML::LoadFile(paths_file_path);
        if (!paths_node["paths"] || !paths_node["paths"].IsSequence()) {
            RCLCPP_ERROR(node_->get_logger(), "Invalid paths YAML structure in '%s'", paths_file_path.c_str());
            return BT::NodeStatus::FAILURE;
        }

        // Check if there are paths to verify
        if (paths_node["paths"].size() == 0) {
            RCLCPP_WARN(node_->get_logger(), "No paths to verify in '%s'", paths_file_path.c_str());
            return BT::NodeStatus::FAILURE;
        }

        bool all_matched = true;

        // Verify each path in the provided paths.yaml
        for (const auto& path : paths_node["paths"]) {
            std::string path_name = path["name"].as<std::string>();
            std::string start_point = path["start_point"].as<std::string>();
            std::string end_point = path["end_point"].as<std::string>();

            RCLCPP_INFO(node_->get_logger(), "Verifying path '%s' with start point '%s' and end point '%s'",
                        path_name.c_str(), start_point.c_str(), end_point.c_str());

            // Get start and end joints
            if (point_joints.find(start_point) == point_joints.end() ||
                point_joints.find(end_point) == point_joints.end()) {
                RCLCPP_ERROR(node_->get_logger(), "Missing point '%s' or '%s' for path '%s'",
                             start_point.c_str(), end_point.c_str(), path_name.c_str());
                all_matched = false;
                continue;
            }
            const auto& start_joints = point_joints[start_point];
            const auto& end_joints = point_joints[end_point];

            // Log joint values for start and end points
            std::stringstream start_joints_ss, end_joints_ss;
            start_joints_ss << "[" << start_joints[0];
            end_joints_ss << "[" << end_joints[0];
            for (size_t i = 1; i < 6; ++i) {
                start_joints_ss << ", " << start_joints[i];
                end_joints_ss << ", " << end_joints[i];
            }
            start_joints_ss << "]";
            end_joints_ss << "]";
            RCLCPP_INFO(node_->get_logger(), "Start point '%s' joint values: %s", start_point.c_str(), start_joints_ss.str().c_str());
            RCLCPP_INFO(node_->get_logger(), "End point '%s' joint values: %s", end_point.c_str(), end_joints_ss.str().c_str());

            // Get data positions list
            if (!path["data"] || !path["data"].IsSequence() || path["data"].size() == 0) {
                RCLCPP_ERROR(node_->get_logger(), "Invalid or empty data for path '%s'", path_name.c_str());
                all_matched = false;
                continue;
            }

            // Extract first and last positions
            const auto& first_data = path["data"][0]["positions"];
            const auto& last_data = path["data"][path["data"].size() - 1]["positions"];

            if (!first_data.IsSequence() || first_data.size() != 6 ||
                !last_data.IsSequence() || last_data.size() != 6) {
                RCLCPP_ERROR(node_->get_logger(), "Invalid positions data for path '%s'", path_name.c_str());
                all_matched = false;
                continue;
            }

            std::array<double, 6> first_positions, last_positions;
            for (size_t i = 0; i < 6; ++i) {
                first_positions[i] = first_data[i].as<double>();
                last_positions[i] = last_data[i].as<double>();
            }

            // Log path positions
            std::stringstream first_pos_ss, last_pos_ss;
            first_pos_ss << "[" << first_positions[0];
            last_pos_ss << "[" << last_positions[0];
            for (size_t i = 1; i < 6; ++i) {
                first_pos_ss << ", " << first_positions[i];
                last_pos_ss << ", " << last_positions[i];
            }
            first_pos_ss << "]";
            last_pos_ss << "]";
            RCLCPP_INFO(node_->get_logger(), "Path '%s' first positions: %s", path_name.c_str(), first_pos_ss.str().c_str());
            RCLCPP_INFO(node_->get_logger(), "Path '%s' last positions: %s", path_name.c_str(), last_pos_ss.str().c_str());

            // Compare with tolerance
            bool start_match = true, end_match = true;
            std::vector<std::string> start_mismatch_details, end_mismatch_details;
            for (size_t i = 0; i < 6; ++i) {
                double start_diff = std::abs(start_joints[i] - first_positions[i]);
                double end_diff = std::abs(end_joints[i] - last_positions[i]);
                if (start_diff > tolerance) {
                    start_match = false;
                    start_mismatch_details.push_back("joint" + std::to_string(i + 1) + ": " +
                                                    std::to_string(start_joints[i]) + " vs " +
                                                    std::to_string(first_positions[i]) + ", diff=" +
                                                    std::to_string(start_diff));
                }
                if (end_diff > tolerance) {
                    end_match = false;
                    end_mismatch_details.push_back("joint" + std::to_string(i + 1) + ": " +
                                                  std::to_string(end_joints[i]) + " vs " +
                                                  std::to_string(last_positions[i]) + ", diff=" +
                                                  std::to_string(end_diff));
                }
            }

            // Log comparison results
            if (start_match) {
                RCLCPP_INFO(node_->get_logger(), "Start point '%s' matches path '%s' within tolerance %g",
                            start_point.c_str(), path_name.c_str(), tolerance);
            } else {
                std::stringstream mismatch_ss;
                mismatch_ss << "Start point '" << start_point << "' does not match path '" << path_name << "': ";
                for (size_t i = 0; i < start_mismatch_details.size(); ++i) {
                    mismatch_ss << start_mismatch_details[i];
                    if (i < start_mismatch_details.size() - 1) mismatch_ss << ", ";
                }
                RCLCPP_ERROR(node_->get_logger(), "%s", mismatch_ss.str().c_str());
            }

            if (end_match) {
                RCLCPP_INFO(node_->get_logger(), "End point '%s' matches path '%s' within tolerance %g",
                            end_point.c_str(), path_name.c_str(), tolerance);
            } else {
                std::stringstream mismatch_ss;
                mismatch_ss << "End point '" << end_point << "' does not match path '" << path_name << "': ";
                for (size_t i = 0; i < end_mismatch_details.size(); ++i) {
                    mismatch_ss << end_mismatch_details[i];
                    if (i < end_mismatch_details.size() - 1) mismatch_ss << ", ";
                }
                RCLCPP_ERROR(node_->get_logger(), "%s", mismatch_ss.str().c_str());
            }

            if (!start_match || !end_match) {
                all_matched = false;
                std::string error_msg = start_point + " is not match with " + path_name + " path,failure,0";
                if (!start_match && !end_match) {
                    error_msg = start_point + " and " + end_point + " do not match with " + path_name + " path,failure,0";
                } else if (!end_match) {
                    error_msg = end_point + " is not match with " + path_name + " path,failure,0";
                }
                std_msgs::msg::String msg;
                msg.data = error_msg;
                toast_pub->publish(msg);
                RCLCPP_INFO(node_->get_logger(), "Published mismatch toast: '%s'", error_msg.c_str());
            }
        }

        // If all matched, publish success
        if (all_matched) {
            std_msgs::msg::String msg;
            msg.data = "✅ Verified Successfully,success, 20";
            toast_pub->publish(msg);
            RCLCPP_INFO(node_->get_logger(), "Published success toast: '%s'", msg.data.c_str());
            return BT::NodeStatus::SUCCESS;
        } else {
            return BT::NodeStatus::FAILURE;
        }
    } catch (const YAML::Exception& e) {
        RCLCPP_ERROR(node_->get_logger(), "YAML parsing error in PathVerifier node '%s': %s", name().c_str(), e.what());
        return BT::NodeStatus::FAILURE;
    } catch (const std::exception& e) {
        RCLCPP_ERROR(node_->get_logger(), "Error in PathVerifier node '%s': %s", name().c_str(), e.what());
        return BT::NodeStatus::FAILURE;
    }
}

}  // namespace bt_point_path_verification
