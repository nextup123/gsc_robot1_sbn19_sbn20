/**
 * @file bt_copy_fields.hpp
 * @author Adnan Alvi
 * @brief Header file for Behavior Tree node to copy specified fields from points.yaml to paths.yaml.
 * @version 1.0
 * @date 2025-09-17
 * @company Nextup Robotics Private Limited
 * @designation Robotics Software Engineer
 */

#ifndef BT_COPY_FIELDS_HPP_
#define BT_COPY_FIELDS_HPP_

#include <rclcpp/rclcpp.hpp>
#include <behaviortree_cpp_v3/action_node.h>
#include <std_msgs/msg/string.hpp>
#include <string>
#include <vector>

namespace bt_copy_fields
{

class CopyFields : public BT::SyncActionNode
{
public:
    CopyFields(
        const std::string& name,
        const BT::NodeConfiguration& config,
        const rclcpp::Node::SharedPtr& node);

    static BT::PortsList providedPorts();

    BT::NodeStatus tick() override;

private:
    rclcpp::Node::SharedPtr node_;
    std::string points_file_path_;
    std::string paths_file_path_;
    std::vector<std::string> fields_to_copy_;
    rclcpp::Publisher<std_msgs::msg::String>::SharedPtr status_pub_;

    void publishStatus(const std::string& status);
};

}  // namespace bt_copy_fields

#endif  // BT_COPY_FIELDS_HPP_