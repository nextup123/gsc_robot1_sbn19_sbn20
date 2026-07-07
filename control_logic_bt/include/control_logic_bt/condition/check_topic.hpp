#pragma once

#include <behaviortree_cpp_v3/action_node.h>
#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/bool.hpp>
#include <std_msgs/msg/int32.hpp>
#include <std_msgs/msg/string.hpp>
#include <atomic>
#include <mutex>
#include <string>
#include <thread>
#include <chrono>

// CheckTopic
// ------------------------------------------------------------------
// Checks whether a topic is CURRENTLY publishing an expected value.
// Supports multiple message types via the `msg_type` port:
//   - "bool"   -> std_msgs/Bool     (data: true/false/1/0)
//   - "int32"  -> std_msgs/Int32    (data: integer, e.g. "42")
//   - "string" -> std_msgs/String   (data: exact string match)
//
// StatefulActionNode (non-blocking): can wait with a built-in timeout,
// so WaitUntilTrue is optional. While waiting it returns RUNNING.
//
// Value semantics are LIVE, not latched: a received message is only
// valid for `freshness_ms`. A stale one-shot value will NOT keep
// succeeding forever.
//
// Timeout:
//   timeout_ms <= 0  -> instant check (SUCCESS/FAILURE in one tick)
//   timeout_ms  > 0  -> wait up to timeout_ms for a fresh expected value
//                       (SUCCESS when matched, FAILURE on deadline,
//                        RUNNING while waiting)
//
// Ports:
//   topic         (std::string) : ROS topic name                 [required]
//   msg_type      (std::string) : "bool" | "int32" | "string"    [def "bool"]
//   data          (std::string) : expected value (parsed by type) [required]
//   timeout_ms    (int, opt)    : max wait in ms. 0 = instant.    [def 0]
//   freshness_ms  (int, opt)    : msg validity window in ms.      [def 500]
// ------------------------------------------------------------------
class CheckTopic : public BT::StatefulActionNode
{
public:
    enum class MsgType { BOOL, INT32, STRING };

    CheckTopic(const std::string& name,
               const BT::NodeConfiguration& config);

    static BT::PortsList providedPorts();

    BT::NodeStatus onStart() override;
    BT::NodeStatus onRunning() override;
    void onHalted() override;

private:
    bool ensureNode();
    void ensureSubscription(const std::string& topic, MsgType type);
    bool readPorts();                 // parse+validate ports into members
    BT::NodeStatus evaluateOnce();    // drain + freshness + compare

    static bool parseMsgType(const std::string& s, MsgType& out);

    rclcpp::Node::SharedPtr node_;

    // One of these is active depending on msg_type.
    rclcpp::Subscription<std_msgs::msg::Bool>::SharedPtr   sub_bool_;
    rclcpp::Subscription<std_msgs::msg::Int32>::SharedPtr  sub_int_;
    rclcpp::Subscription<std_msgs::msg::String>::SharedPtr sub_str_;

    bool self_spun_{false};

    std::string subscribed_topic_;
    MsgType     subscribed_type_{MsgType::BOOL};
    bool        subscribed_{false};
    std::mutex  sub_mutex_;

    // Latest received values (only the one matching msg_type is used).
    std::atomic<bool> latest_bool_{false};
    std::atomic<int>  latest_int_{0};
    std::string       latest_str_;
    std::mutex        str_mutex_;

    std::atomic<int64_t> last_msg_ns_{0};   // steady clock ns; 0 = never

    // Per-activation parsed config
    std::string topic_;
    MsgType     type_{MsgType::BOOL};
    bool        expected_bool_{false};
    int         expected_int_{0};
    std::string expected_str_;
    int         timeout_ms_{0};
    int         freshness_ms_{500};

    std::chrono::steady_clock::time_point deadline_{};
    bool        has_deadline_{false};
};