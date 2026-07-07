#include "control_logic_bt/condition/check_bool_topic.hpp"

CheckBoolTopic::CheckBoolTopic(const std::string& name,
                               const BT::NodeConfiguration& config)
    : BT::ConditionNode(name, config)
{
    // DO NOT touch blackboard here — constructor runs during validation tree
    // creation where blackboard may not have "node" set yet → crash.
    // node_ is grabbed lazily on first tick() instead.
}

BT::PortsList CheckBoolTopic::providedPorts()
{
    return {
        BT::InputPort<std::string>("topic", "ROS topic to check (std_msgs/Bool)"),
        BT::InputPort<std::string>("data",  "Expected value: true/false/1/0")
    };
}

BT::NodeStatus CheckBoolTopic::tick()
{
    // --- lazy node grab (safe: only runs during real tree, not validation) ---
    if (!node_)
    {
        if (!config().blackboard->get("node", node_) || !node_)
        {
            // should never happen in real run
            return BT::NodeStatus::FAILURE;
        }
    }

    // --- read ports ---
    std::string topic;
    if (!getInput("topic", topic) || topic.empty())
    {
        RCLCPP_ERROR(node_->get_logger(), "[CheckBoolTopic] Missing 'topic' port");
        return BT::NodeStatus::FAILURE;
    }

    std::string data_str;
    if (!getInput("data", data_str) || data_str.empty())
    {
        RCLCPP_ERROR(node_->get_logger(), "[CheckBoolTopic] Missing 'data' port");
        return BT::NodeStatus::FAILURE;
    }

    bool expected;
    if      (data_str == "true"  || data_str == "1") expected = true;
    else if (data_str == "false" || data_str == "0") expected = false;
    else
    {
        RCLCPP_ERROR(node_->get_logger(),
                     "[CheckBoolTopic] Invalid 'data' value '%s'. Use true/false/1/0",
                     data_str.c_str());
        return BT::NodeStatus::FAILURE;
    }

    // --- (re)subscribe if topic changed ---
    if (topic != last_topic_)
    {
        has_message_.store(false);
        latest_value_.store(false);

        sub_ = node_->create_subscription<std_msgs::msg::Bool>(
            topic, rclcpp::SensorDataQoS(),
            [this](const std_msgs::msg::Bool::SharedPtr msg)
            {
                latest_value_.store(msg->data);
                has_message_.store(true);
            });

        last_topic_ = topic;
        RCLCPP_INFO(node_->get_logger(),
                    "[CheckBoolTopic] Subscribed to '%s'", topic.c_str());
    }

    // --- drain latest callbacks right now ---
    rclcpp::spin_some(node_);

    // --- no message yet ---
    if (!has_message_.load())
    {
        RCLCPP_WARN_THROTTLE(node_->get_logger(), *node_->get_clock(), 2000,
                             "[CheckBoolTopic] '%s' no message received yet",
                             topic.c_str());
        return BT::NodeStatus::FAILURE;
    }

    // --- check latest value ---
    bool current = latest_value_.load();
    if (current == expected)
    {
        RCLCPP_DEBUG(node_->get_logger(),
                     "[CheckBoolTopic] '%s' = %s → SUCCESS",
                     topic.c_str(), current ? "true" : "false");
        return BT::NodeStatus::SUCCESS;
    }

    RCLCPP_DEBUG(node_->get_logger(),
                 "[CheckBoolTopic] '%s' = %s (expected %s) → FAILURE",
                 topic.c_str(),
                 current  ? "true" : "false",
                 expected ? "true" : "false");
    return BT::NodeStatus::FAILURE;
}