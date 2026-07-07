#include "control_logic_bt/blackboard/publish_blackboard_node.hpp"

PublishBlackboard::PublishBlackboard(
    const std::string& name,
    const BT::NodeConfiguration& config)
    : BT::SyncActionNode(name, config)
{
    node_ =
        config.blackboard->get<rclcpp::Node::SharedPtr>("node");
}

BT::PortsList PublishBlackboard::providedPorts()
{
    return {
        BT::InputPort<std::string>("topic"),
        BT::InputPort<std::string>("key")
    };
}

BT::NodeStatus PublishBlackboard::tick()
{
    std::string topic;
    std::string key;

    if (!getInput("topic", topic) ||
        !getInput("key", key))
    {
        throw BT::RuntimeError(
            "Missing input in PublishBlackboard");
    }

    // lazy publisher creation
    if (!pub_ || pub_->get_topic_name() != topic)
    {
        pub_ =
            node_->create_publisher<std_msgs::msg::String>(
                topic,
                10);
    }

    std::string value;

    try
    {
        value =
            config().blackboard->get<std::string>(key);
    }
    catch (...)
    {
        throw BT::RuntimeError(
            "Blackboard key not found: " + key);
    }

    std_msgs::msg::String msg;
    msg.data = value;

    pub_->publish(msg);

    return BT::NodeStatus::SUCCESS;
}