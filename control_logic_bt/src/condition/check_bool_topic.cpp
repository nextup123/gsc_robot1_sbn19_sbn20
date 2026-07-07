#include "control_logic_bt/condition/check_bool_topic.hpp"

using namespace std::chrono;

// ------------------------------------------------------------------
// Constructor: no ROS work (runs during tree validation too).
// ------------------------------------------------------------------
CheckBoolTopic::CheckBoolTopic(const std::string& name,
                               const BT::NodeConfiguration& config)
    : BT::StatefulActionNode(name, config)
{
}

BT::PortsList CheckBoolTopic::providedPorts()
{
    return {
        BT::InputPort<std::string>("topic", "ROS topic to check (std_msgs/Bool)"),
        BT::InputPort<std::string>("data",  "Expected value: true/false/1/0"),
        BT::InputPort<int>("timeout_ms", 0,
                           "Max time (ms) to wait for a fresh expected value. "
                           "0 = instant check (no waiting)."),
        BT::InputPort<int>("freshness_ms", 500,
                           "How long (ms) a received message stays valid. "
                           "Default 500. Prevents stale one-shot values from "
                           "succeeding forever.")
    };
}

// ------------------------------------------------------------------
// ensureNode: shared runner node from blackboard, or private fallback.
// ------------------------------------------------------------------
bool CheckBoolTopic::ensureNode()
{
    if (node_)
        return true;

    if (config().blackboard->get("node", node_) && node_)
    {
        self_spun_ = false;
        return true;
    }

    node_ = rclcpp::Node::make_shared("check_bool_topic_bt_node");
    self_spun_ = true;

    std::thread([n = node_]()
    {
        rclcpp::executors::SingleThreadedExecutor exec;
        exec.add_node(n);
        exec.spin();
    }).detach();

    RCLCPP_WARN(node_->get_logger(),
                "[CheckBoolTopic] No shared 'node' on blackboard; created a "
                "private node + spin thread as fallback.");
    return static_cast<bool>(node_);
}

// ------------------------------------------------------------------
// ensureSubscription: created once, kept alive; re-created on topic change.
// QoS RELIABLE / KEEP_LAST(10) / VOLATILE. Each message stamps arrival time.
// ------------------------------------------------------------------
void CheckBoolTopic::ensureSubscription(const std::string& topic)
{
    std::lock_guard<std::mutex> lock(sub_mutex_);

    if (sub_ && topic == subscribed_topic_)
        return;

    last_msg_ns_.store(0);
    latest_value_.store(false);

    rclcpp::QoS qos(rclcpp::KeepLast(10));
    qos.reliable();
    qos.durability_volatile();

    sub_ = node_->create_subscription<std_msgs::msg::Bool>(
        topic, qos,
        [this](const std_msgs::msg::Bool::SharedPtr msg)
        {
            latest_value_.store(msg->data);
            last_msg_ns_.store(
                duration_cast<nanoseconds>(
                    steady_clock::now().time_since_epoch()).count());
        });

    subscribed_topic_ = topic;

    RCLCPP_INFO(node_->get_logger(),
                "[CheckBoolTopic] Subscribed to '%s' (RELIABLE/KEEP_LAST(10)/VOLATILE)",
                topic.c_str());
}

// ------------------------------------------------------------------
// readPorts: parse + validate all ports into members.
// ------------------------------------------------------------------
bool CheckBoolTopic::readPorts(bool& expected)
{
    if (!getInput("topic", topic_) || topic_.empty())
    {
        RCLCPP_ERROR(node_->get_logger(), "[CheckBoolTopic] Missing 'topic' port");
        return false;
    }

    std::string data_str;
    if (!getInput("data", data_str) || data_str.empty())
    {
        RCLCPP_ERROR(node_->get_logger(), "[CheckBoolTopic] Missing 'data' port");
        return false;
    }

    if      (data_str == "true"  || data_str == "1") expected = true;
    else if (data_str == "false" || data_str == "0") expected = false;
    else
    {
        RCLCPP_ERROR(node_->get_logger(),
                     "[CheckBoolTopic] Invalid 'data' value '%s'. Use true/false/1/0",
                     data_str.c_str());
        return false;
    }

    timeout_ms_ = 0;
    getInput("timeout_ms", timeout_ms_);
    if (timeout_ms_ < 0)
        timeout_ms_ = 0;

    freshness_ms_ = 500;
    getInput("freshness_ms", freshness_ms_);
    if (freshness_ms_ <= 0)
        freshness_ms_ = 500;

    return true;
}

// ------------------------------------------------------------------
// evaluateOnce: drain callbacks, apply freshness gate, compare value.
// ------------------------------------------------------------------
BT::NodeStatus CheckBoolTopic::evaluateOnce(bool expected)
{
    if (!self_spun_)
        rclcpp::spin_some(node_);

    const int64_t last_ns = last_msg_ns_.load();
    if (last_ns == 0)
        return BT::NodeStatus::FAILURE;   // never received

    const int64_t now_ns =
        duration_cast<nanoseconds>(steady_clock::now().time_since_epoch()).count();
    const int64_t age_ms = (now_ns - last_ns) / 1000000;

    if (age_ms > freshness_ms_)
        return BT::NodeStatus::FAILURE;   // stale

    return (latest_value_.load() == expected)
               ? BT::NodeStatus::SUCCESS
               : BT::NodeStatus::FAILURE;
}

// ------------------------------------------------------------------
// onStart: first tick of an activation.
// ------------------------------------------------------------------
BT::NodeStatus CheckBoolTopic::onStart()
{
    if (!ensureNode())
        return BT::NodeStatus::FAILURE;

    if (!readPorts(expected_))
        return BT::NodeStatus::FAILURE;

    ensureSubscription(topic_);

    BT::NodeStatus result = evaluateOnce(expected_);

    // Instant mode (no timeout): return the immediate result.
    if (timeout_ms_ <= 0)
        return result;

    // Timeout mode: if already satisfied, succeed now.
    if (result == BT::NodeStatus::SUCCESS)
        return BT::NodeStatus::SUCCESS;

    // Otherwise arm the deadline and wait (non-blocking).
    deadline_     = steady_clock::now() + milliseconds(timeout_ms_);
    has_deadline_ = true;

    RCLCPP_INFO(node_->get_logger(),
                "[CheckBoolTopic] Waiting up to %d ms for '%s' == %s",
                timeout_ms_, topic_.c_str(), expected_ ? "true" : "false");

    return BT::NodeStatus::RUNNING;
}

// ------------------------------------------------------------------
// onRunning: subsequent ticks while waiting for the timeout.
// ------------------------------------------------------------------
BT::NodeStatus CheckBoolTopic::onRunning()
{
    BT::NodeStatus result = evaluateOnce(expected_);
    if (result == BT::NodeStatus::SUCCESS)
    {
        has_deadline_ = false;
        return BT::NodeStatus::SUCCESS;
    }

    if (has_deadline_ && steady_clock::now() >= deadline_)
    {
        has_deadline_ = false;
        RCLCPP_WARN(node_->get_logger(),
                    "[CheckBoolTopic] Timeout after %d ms waiting for '%s' == %s",
                    timeout_ms_, topic_.c_str(), expected_ ? "true" : "false");
        return BT::NodeStatus::FAILURE;
    }

    return BT::NodeStatus::RUNNING;
}

// ------------------------------------------------------------------
// onHalted: tree halted this node mid-wait.
// ------------------------------------------------------------------
void CheckBoolTopic::onHalted()
{
    has_deadline_ = false;
}