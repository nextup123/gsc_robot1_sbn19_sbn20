#include "control_logic_bt/blackboard/subscribe_to_blackboard_node.hpp"

SubscribeToBlackboard::SubscribeToBlackboard(
    const std::string& name,
    const BT::NodeConfiguration& config)
    : BT::StatefulActionNode(name, config),
      message_received_(false)
{
    node_ =
        config.blackboard->get<rclcpp::Node::SharedPtr>("node");
}

BT::PortsList SubscribeToBlackboard::providedPorts()
{
    return {
        BT::InputPort<std::string>("topic"),
        BT::InputPort<std::string>("key")
    };
}

BT::NodeStatus SubscribeToBlackboard::onStart()
{
    if (!getInput("topic", topic_) ||
        !getInput("key", key_))
    {
        throw BT::RuntimeError(
            "Missing input in SubscribeToBlackboard");
    }

    message_received_ = false;

    sub_ = node_->create_subscription<std_msgs::msg::String>(
        topic_,
        10,
        [this](const std_msgs::msg::String::SharedPtr msg)
        {
            latest_msg_ = msg->data;
            message_received_ = true;
        });

    return BT::NodeStatus::RUNNING;
}

BT::NodeStatus SubscribeToBlackboard::onRunning()
{
    if (message_received_)
    {
        config().blackboard->set(key_, latest_msg_);

        return BT::NodeStatus::SUCCESS;
    }

    return BT::NodeStatus::RUNNING;
}

void SubscribeToBlackboard::onHalted()
{
    sub_.reset();
}