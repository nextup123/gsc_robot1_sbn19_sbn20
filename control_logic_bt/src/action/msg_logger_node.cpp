#include "control_logic_bt/action/msg_logger_node.hpp"
#include <iostream>

namespace bt_logger
{
rclcpp::Node::SharedPtr MsgLoggerNode::node_ = nullptr;
rclcpp::Publisher<std_msgs::msg::String>::SharedPtr MsgLoggerNode::publisher_ = nullptr;
std::once_flag MsgLoggerNode::init_flag_;

// Every message published by this node is a BT log, so it is tagged
// with a leading "[bt] " prefix. The frontend detects this prefix to
// route/colour the entry (and parses an optional [level] tag after it,
// e.g. "[bt] [success] ...").
static constexpr const char *BT_PREFIX = "[bt] ";

MsgLoggerNode::MsgLoggerNode(
    const std::string &name,
    const BT::NodeConfiguration &config)
    : BT::SyncActionNode(name, config)
{
    std::call_once(init_flag_, []()
                   {
        node_ = rclcpp::Node::make_shared("msg_logger_node");
        publisher_ = node_->create_publisher<std_msgs::msg::String>(
            "/logs_topic", 10);

        RCLCPP_INFO(node_->get_logger(),
                    "MsgLoggerNode initialized"); });
}

BT::PortsList MsgLoggerNode::providedPorts()
{
    return {
        BT::InputPort<std::string>("msg_log", "")};
}

BT::NodeStatus MsgLoggerNode::tick()
{
    try
    {
        std::string msg;

        // IMPORTANT: this will also accept {counter}
        if (!getInput("msg_log", msg))
        {
            RCLCPP_ERROR(node_->get_logger(),
                         "Missing input [msg_log]");
            publishStatus("msg_log missing_input");
            return BT::NodeStatus::FAILURE;
        }

        // Prefix every BT log with the [bt] tag.
        const std::string tagged = std::string(BT_PREFIX) + msg;

        // Console print
        std::cout << "[MsgLoggerNode]: " << tagged << std::endl;

        // ROS publish
        std_msgs::msg::String ros_msg;
        ros_msg.data = tagged;
        publisher_->publish(ros_msg);

        RCLCPP_INFO(node_->get_logger(),
                    "Published: %s", tagged.c_str());

        return BT::NodeStatus::SUCCESS;
    }
    catch (const std::exception &e)
    {
        RCLCPP_ERROR(node_->get_logger(),
                     "Exception: %s", e.what());
        publishStatus("error in MsgLoggerNode");
        return BT::NodeStatus::FAILURE;
    }
}

void MsgLoggerNode::publishStatus(const std::string &status)
{
    std_msgs::msg::String msg;
    msg.data = std::string(BT_PREFIX) + status;

    publisher_->publish(msg);

    RCLCPP_WARN(node_->get_logger(),
                "Status: %s", msg.data.c_str());
}

} // namespace bt_logger