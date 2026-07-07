/**
 * @file popup_msg_node.cpp
 * @author Adnan Alvi
 * @brief Behavior Tree node to publish a popup message with type and timeout.
 * @version 1.0
 * @date 2025-09-19
 * @company Nextup Robotics Private Limited
 * @designation Robotics Software Engineer
 */

#include "control_logic_bt/action/popup_msg_node.hpp"
#include <sstream>

namespace bt_popup
{

PopupMsgNode::PopupMsgNode(
    const std::string& name,
    const BT::NodeConfiguration& config)
    : BT::SyncActionNode(name, config)
{
    node_ = rclcpp::Node::make_shared("popup_msg_node");
    popup_publisher_ = node_->create_publisher<std_msgs::msg::String>(
        "/bt_toast_popup", 10);
    status_publisher_ = node_->create_publisher<std_msgs::msg::String>(
        "/popup_operation_status", 10);

    RCLCPP_INFO(node_->get_logger(), "Initializing PopupMsgNode BT node...");
}

BT::PortsList PopupMsgNode::providedPorts()
{
    return {
        BT::InputPort<std::string>("msg"),
        BT::InputPort<std::string>("type"),
        BT::InputPort<int>("timeout")
    };
}

BT::NodeStatus PopupMsgNode::tick()
{
    try {
        // Step 1: Retrieve input message
        std::string msg;
        if (!getInput<std::string>("msg", msg)) {
            RCLCPP_ERROR(node_->get_logger(),
                         "Missing required input [msg]");
            publishStatus("missing_input");
            return BT::NodeStatus::FAILURE;
        }

        // Step 2: Retrieve and validate optional type
        std::string type = "success"; // Default type
        if (getInput<std::string>("type", type)) {
            if (type != "success" && type != "failure" && type != "warn") {
                RCLCPP_WARN(node_->get_logger(),
                            "Invalid type '%s', defaulting to 'success'",
                            type.c_str());
                type = "success";
                publishStatus("invalid_type");
            }
        }

        // Step 3: Retrieve and validate optional timeout
        int timeout = 3; // Default timeout
        if (getInput<int>("timeout", timeout)) {
            if (timeout < 0) {
                RCLCPP_WARN(node_->get_logger(),
                            "Timeout cannot be negative, defaulting to 3 seconds");
                timeout = 3;
                publishStatus("invalid_timeout");
            }
        }

        // Step 4: Create and publish the popup message
        std::ostringstream oss;
        oss << msg << "," << type << "," << timeout;
        std_msgs::msg::String popup_msg;
        popup_msg.data = oss.str();
        popup_publisher_->publish(popup_msg);

        RCLCPP_INFO(node_->get_logger(),
                    "Published popup - Msg: '%s', Type: '%s', Timeout: %d",
                    msg.c_str(), type.c_str(), timeout);
        publishStatus("popup_published");

        return BT::NodeStatus::SUCCESS;
    }
    catch (const std::exception& e) {
        RCLCPP_ERROR(node_->get_logger(),
                     "Error in PopupMsgNode: %s", e.what());
        publishStatus("general_error");
        return BT::NodeStatus::FAILURE;
    }
}

void PopupMsgNode::publishStatus(const std::string& status)
{
    std_msgs::msg::String msg;
    msg.data = status;
    status_publisher_->publish(msg);
    RCLCPP_INFO(node_->get_logger(),
                "Published status: '%s'",
                msg.data.c_str());
}

} // namespace bt_popup