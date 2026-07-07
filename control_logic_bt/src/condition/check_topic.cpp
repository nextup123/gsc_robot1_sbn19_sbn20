#include "control_logic_bt/condition/check_topic.hpp"
#include <algorithm>
#include <cctype>

using namespace std::chrono;

// ------------------------------------------------------------------
// Constructor: no ROS work (runs during tree validation too).
// ------------------------------------------------------------------
CheckTopic::CheckTopic(const std::string& name,
                       const BT::NodeConfiguration& config)
    : BT::StatefulActionNode(name, config)
{
}

BT::PortsList CheckTopic::providedPorts()
{
    return {
        BT::InputPort<std::string>("topic", "ROS topic to check"),
        BT::InputPort<std::string>("msg_type", "bool",
                                   "Message type: bool | int32 | string"),
        BT::InputPort<std::string>("data",
                                   "Expected value (parsed per msg_type)"),
        BT::InputPort<int>("timeout_ms", 0,
                           "Max time (ms) to wait for a fresh expected value. "
                           "0 = instant check (no waiting)."),
        BT::InputPort<int>("freshness_ms", 500,
                           "How long (ms) a received message stays valid. "
                           "Prevents stale one-shot values from succeeding "
                           "forever.")
    };
}

// ------------------------------------------------------------------
// parseMsgType
// ------------------------------------------------------------------
bool CheckTopic::parseMsgType(const std::string& s, MsgType& out)
{
    std::string t = s;
    std::transform(t.begin(), t.end(), t.begin(),
                   [](unsigned char c){ return std::tolower(c); });

    if      (t == "bool")                   { out = MsgType::BOOL;   return true; }
    else if (t == "int32" || t == "int")    { out = MsgType::INT32;  return true; }
    else if (t == "string" || t == "str")   { out = MsgType::STRING; return true; }
    return false;
}

// ------------------------------------------------------------------
// ensureNode: shared runner node from blackboard, or private fallback.
// ------------------------------------------------------------------
bool CheckTopic::ensureNode()
{
    if (node_)
        return true;

    if (config().blackboard->get("node", node_) && node_)
    {
        self_spun_ = false;
        return true;
    }

    node_ = rclcpp::Node::make_shared("check_topic_bt_node");
    self_spun_ = true;

    std::thread([n = node_]()
    {
        rclcpp::executors::SingleThreadedExecutor exec;
        exec.add_node(n);
        exec.spin();
    }).detach();

    RCLCPP_WARN(node_->get_logger(),
                "[CheckTopic] No shared 'node' on blackboard; created a "
                "private node + spin thread as fallback.");
    return static_cast<bool>(node_);
}

// ------------------------------------------------------------------
// ensureSubscription: create the correct-typed subscription once, or
// re-create if topic OR type changed. Only one sub is active at a time.
// QoS RELIABLE / KEEP_LAST(10) / VOLATILE. Each msg stamps arrival time.
// ------------------------------------------------------------------
void CheckTopic::ensureSubscription(const std::string& topic, MsgType type)
{
    std::lock_guard<std::mutex> lock(sub_mutex_);

    if (subscribed_ && topic == subscribed_topic_ && type == subscribed_type_)
        return;

    // Drop any previous subscriptions (topic or type changed).
    sub_bool_.reset();
    sub_int_.reset();
    sub_str_.reset();

    last_msg_ns_.store(0);
    latest_bool_.store(false);
    latest_int_.store(0);
    {
        std::lock_guard<std::mutex> slk(str_mutex_);
        latest_str_.clear();
    }

    rclcpp::QoS qos(rclcpp::KeepLast(10));
    qos.reliable();
    qos.durability_volatile();

    auto stamp = [this]()
    {
        last_msg_ns_.store(
            duration_cast<nanoseconds>(
                steady_clock::now().time_since_epoch()).count());
    };

    switch (type)
    {
        case MsgType::BOOL:
            sub_bool_ = node_->create_subscription<std_msgs::msg::Bool>(
                topic, qos,
                [this, stamp](const std_msgs::msg::Bool::SharedPtr msg)
                {
                    latest_bool_.store(msg->data);
                    stamp();
                });
            break;

        case MsgType::INT32:
            sub_int_ = node_->create_subscription<std_msgs::msg::Int32>(
                topic, qos,
                [this, stamp](const std_msgs::msg::Int32::SharedPtr msg)
                {
                    latest_int_.store(msg->data);
                    stamp();
                });
            break;

        case MsgType::STRING:
            sub_str_ = node_->create_subscription<std_msgs::msg::String>(
                topic, qos,
                [this, stamp](const std_msgs::msg::String::SharedPtr msg)
                {
                    {
                        std::lock_guard<std::mutex> slk(str_mutex_);
                        latest_str_ = msg->data;
                    }
                    stamp();
                });
            break;
    }

    subscribed_topic_ = topic;
    subscribed_type_  = type;
    subscribed_       = true;

    const char* tname = (type == MsgType::BOOL)  ? "bool"
                      : (type == MsgType::INT32) ? "int32" : "string";
    RCLCPP_INFO(node_->get_logger(),
                "[CheckTopic] Subscribed to '%s' as %s "
                "(RELIABLE/KEEP_LAST(10)/VOLATILE)", topic.c_str(), tname);
}

// ------------------------------------------------------------------
// readPorts: parse + validate all ports into members.
// ------------------------------------------------------------------
bool CheckTopic::readPorts()
{
    if (!getInput("topic", topic_) || topic_.empty())
    {
        RCLCPP_ERROR(node_->get_logger(), "[CheckTopic] Missing 'topic' port");
        return false;
    }

    std::string type_str = "bool";
    getInput("msg_type", type_str);
    if (!parseMsgType(type_str, type_))
    {
        RCLCPP_ERROR(node_->get_logger(),
                     "[CheckTopic] Invalid 'msg_type' '%s'. Use bool|int32|string",
                     type_str.c_str());
        return false;
    }

    std::string data_str;
    if (!getInput("data", data_str) || data_str.empty())
    {
        RCLCPP_ERROR(node_->get_logger(), "[CheckTopic] Missing 'data' port");
        return false;
    }

    switch (type_)
    {
        case MsgType::BOOL:
        {
            std::string d = data_str;
            std::transform(d.begin(), d.end(), d.begin(),
                           [](unsigned char c){ return std::tolower(c); });
            if      (d == "true"  || d == "1") expected_bool_ = true;
            else if (d == "false" || d == "0") expected_bool_ = false;
            else
            {
                RCLCPP_ERROR(node_->get_logger(),
                             "[CheckTopic] Invalid bool 'data' '%s'. Use true/false/1/0",
                             data_str.c_str());
                return false;
            }
            break;
        }
        case MsgType::INT32:
        {
            try {
                size_t pos = 0;
                expected_int_ = std::stoi(data_str, &pos);
                if (pos != data_str.size())
                    throw std::invalid_argument("trailing chars");
            } catch (const std::exception&) {
                RCLCPP_ERROR(node_->get_logger(),
                             "[CheckTopic] Invalid int32 'data' '%s'",
                             data_str.c_str());
                return false;
            }
            break;
        }
        case MsgType::STRING:
            expected_str_ = data_str;   // exact match, no transform
            break;
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
BT::NodeStatus CheckTopic::evaluateOnce()
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

    bool match = false;
    switch (type_)
    {
        case MsgType::BOOL:
            match = (latest_bool_.load() == expected_bool_);
            break;
        case MsgType::INT32:
            match = (latest_int_.load() == expected_int_);
            break;
        case MsgType::STRING:
        {
            std::lock_guard<std::mutex> slk(str_mutex_);
            match = (latest_str_ == expected_str_);
            break;
        }
    }

    return match ? BT::NodeStatus::SUCCESS : BT::NodeStatus::FAILURE;
}

// ------------------------------------------------------------------
// onStart
// ------------------------------------------------------------------
BT::NodeStatus CheckTopic::onStart()
{
    if (!ensureNode())
        return BT::NodeStatus::FAILURE;

    if (!readPorts())
        return BT::NodeStatus::FAILURE;

    ensureSubscription(topic_, type_);

    BT::NodeStatus result = evaluateOnce();

    if (timeout_ms_ <= 0)
        return result;                    // instant mode

    if (result == BT::NodeStatus::SUCCESS)
        return BT::NodeStatus::SUCCESS;

    deadline_     = steady_clock::now() + milliseconds(timeout_ms_);
    has_deadline_ = true;

    RCLCPP_INFO(node_->get_logger(),
                "[CheckTopic] Waiting up to %d ms for '%s' expected value",
                timeout_ms_, topic_.c_str());

    return BT::NodeStatus::RUNNING;
}

// ------------------------------------------------------------------
// onRunning
// ------------------------------------------------------------------
BT::NodeStatus CheckTopic::onRunning()
{
    BT::NodeStatus result = evaluateOnce();
    if (result == BT::NodeStatus::SUCCESS)
    {
        has_deadline_ = false;
        return BT::NodeStatus::SUCCESS;
    }

    if (has_deadline_ && steady_clock::now() >= deadline_)
    {
        has_deadline_ = false;
        RCLCPP_WARN(node_->get_logger(),
                    "[CheckTopic] Timeout after %d ms waiting on '%s'",
                    timeout_ms_, topic_.c_str());
        return BT::NodeStatus::FAILURE;
    }

    return BT::NodeStatus::RUNNING;
}

// ------------------------------------------------------------------
// onHalted
// ------------------------------------------------------------------
void CheckTopic::onHalted()
{
    has_deadline_ = false;
}