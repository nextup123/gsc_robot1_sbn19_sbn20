#include "popup_msg_node.hpp"

PopupMsgNode::PopupMsgNode(const std::string& name, const BT::NodeConfiguration& config)
    : BT::SyncActionNode(name, config)
{
    node_ = rclcpp::Node::make_shared("popup_msg_node");
    popup_publisher_ = node_->create_publisher<std_msgs::msg::String>("/bt_toast_popup", 10);
}

BT::NodeStatus PopupMsgNode::tick()
{
    std::string msg;
    std::string type = "success"; // Default type
    int timeout = 3; // Default timeout

    // Get the message from the input port
    if (!getInput<std::string>("msg", msg))
    {
        RCLCPP_ERROR(node_->get_logger(), "PopupMsgNode: missing required input [msg]");
        return BT::NodeStatus::FAILURE;
    }

    // Get the optional type from the input port
    getInput<std::string>("type", type);

    // Get the optional timeout from the input port
    getInput<int>("timeout", timeout);

    // Validate the type
    if (type != "success" && type != "failure" && type != "warn")
    {
        RCLCPP_WARN(node_->get_logger(), "PopupMsgNode: invalid type '%s', defaulting to 'success'", type.c_str());
        type = "success";
    }

    // Validate timeout is not negative
    if (timeout < 0)
    {
        RCLCPP_WARN(node_->get_logger(), "PopupMsgNode: timeout cannot be negative, defaulting to 3 seconds");
        timeout = 3;
    }

    // Create and publish the message in format "msg,type,timeout"
    std_msgs::msg::String popup_msg;
    popup_msg.data = msg + "," + type + "," + std::to_string(timeout);
    popup_publisher_->publish(popup_msg);

    RCLCPP_INFO(node_->get_logger(), "PopupMsgNode: Published popup - Msg: '%s', Type: '%s', Timeout: %d", 
                msg.c_str(), type.c_str(), timeout);
    return BT::NodeStatus::SUCCESS;
}