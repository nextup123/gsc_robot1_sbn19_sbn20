#ifndef POPUP_MSG_NODE_HPP
#define POPUP_MSG_NODE_HPP

#include "behaviortree_cpp_v3/action_node.h"
#include "rclcpp/rclcpp.hpp"
#include "std_msgs/msg/string.hpp"

class PopupMsgNode : public BT::SyncActionNode
{
public:
    PopupMsgNode(const std::string& name, const BT::NodeConfiguration& config);

    static BT::PortsList providedPorts()
    {
        return {
            BT::InputPort<std::string>("msg", "Message to display"),
            BT::InputPort<std::string>("type", "Type of popup (success/failure/warn)", "success"),
            BT::InputPort<int>("timeout", "Duration in seconds (0 = persistent)")
        };
    }

    BT::NodeStatus tick() override;

private:
    rclcpp::Node::SharedPtr node_;
    rclcpp::Publisher<std_msgs::msg::String>::SharedPtr popup_publisher_;
};

#endif // POPUP_MSG_NODE_HPP