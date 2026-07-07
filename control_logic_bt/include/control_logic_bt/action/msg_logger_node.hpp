#pragma once

#include <behaviortree_cpp_v3/action_node.h>
#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/string.hpp>
#include <string>
#include <mutex>

namespace bt_logger
{

class MsgLoggerNode : public BT::SyncActionNode
{
public:
    MsgLoggerNode(
        const std::string& name,
        const BT::NodeConfiguration& config);

    static BT::PortsList providedPorts();

    BT::NodeStatus tick() override;

private:
    static rclcpp::Node::SharedPtr node_;
    static rclcpp::Publisher<std_msgs::msg::String>::SharedPtr publisher_;
    static std::once_flag init_flag_;

    void publishStatus(const std::string& status);
};

}  // namespace bt_logger