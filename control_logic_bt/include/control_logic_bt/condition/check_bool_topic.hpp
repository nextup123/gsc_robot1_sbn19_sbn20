#pragma once

#include <behaviortree_cpp_v3/action_node.h>
#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/bool.hpp>
#include <atomic>
#include <mutex>
#include <string>
#include <thread>
#include <chrono>

// CheckBoolTopic
// ------------------------------------------------------------------
// Checks whether a std_msgs/Bool topic is CURRENTLY publishing an
// expected value, with an OPTIONAL built-in wait/timeout so you do
// NOT need to wrap it in WaitUntilTrue.
//
// It is a StatefulActionNode (non-blocking): when waiting it returns
// RUNNING and lets the rest of the tree keep ticking. It never blocks
// the main tick loop.
//
// Value semantics are LIVE, not latched. A received message is only
// valid for `freshness_ms`. A stale one-shot value will NOT keep
// succeeding forever.
//
// Timeout semantics:
//   * timeout_ms omitted or <= 0  -> INSTANT check. One evaluation:
//       - fresh expected value  -> SUCCESS
//       - otherwise             -> FAILURE
//     (backward compatible with trees that relied on a plain check)
//   * timeout_ms > 0             -> WAIT up to timeout_ms for a fresh
//       expected value:
//       - as soon as fresh expected value seen -> SUCCESS
//       - deadline passes first                -> FAILURE
//       - while waiting                        -> RUNNING
//
// Ports:
//   topic         (std::string) : ROS topic, std_msgs/Bool   [required]
//   data          (std::string) : "true"/"false"/"1"/"0"     [required]
//   timeout_ms    (int, opt)    : max wait in ms. 0 = instant. Default 0.
//   freshness_ms  (int, opt)    : how long a msg stays valid. Default 500.
// ------------------------------------------------------------------
class CheckBoolTopic : public BT::StatefulActionNode
{
public:
    CheckBoolTopic(const std::string& name,
                   const BT::NodeConfiguration& config);

    static BT::PortsList providedPorts();

    // StatefulActionNode interface
    BT::NodeStatus onStart() override;
    BT::NodeStatus onRunning() override;
    void onHalted() override;

private:
    bool ensureNode();
    void ensureSubscription(const std::string& topic);

    // Read + validate ports into members. Returns false on bad config.
    bool readPorts(bool& expected);

    // Core evaluation shared by onStart/onRunning: drains callbacks and
    // returns SUCCESS if a fresh message equals `expected`, else FAILURE.
    BT::NodeStatus evaluateOnce(bool expected);

    rclcpp::Node::SharedPtr node_;
    rclcpp::Subscription<std_msgs::msg::Bool>::SharedPtr sub_;

    bool self_spun_{false};

    std::string subscribed_topic_;
    std::mutex  sub_mutex_;

    std::atomic<bool>    latest_value_{false};
    std::atomic<int64_t> last_msg_ns_{0};   // steady clock ns; 0 = never

    // Per-activation config / state
    std::string topic_;
    bool        expected_{false};
    int         timeout_ms_{0};
    int         freshness_ms_{500};
    std::chrono::steady_clock::time_point deadline_{};
    bool        has_deadline_{false};
};