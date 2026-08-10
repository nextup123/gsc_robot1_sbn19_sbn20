#pragma once

#include "behaviortree_cpp_v3/action_node.h"
#include <rclcpp/rclcpp.hpp>
#include <control_msgs/msg/dynamic_interface_group_values.hpp>
#include <atomic>
#include <mutex>
#include <string>

namespace bt_control
{

/**
 * @brief Async action node that drives a digital output on a GPIO device
 *        via the /nextup_gpio_command_controller/commands topic.
 *
 * All GPIO devices share a single command topic and are disambiguated by
 * gpio_id + do_id inside the message payload. The publisher is therefore
 * shared (static) across every instance of this node in the tree, so N uses
 * of GpioDoControl create exactly ONE publisher, not N.
 *
 * Lifetime: the shared publisher is reference-counted. It is created by the
 * first constructed instance and destroyed when the last instance is
 * destroyed, so rebuilding the tree does not leave a dangling publisher
 * bound to a destroyed node.
 */
class GpioDoControl : public BT::AsyncActionNode
{
public:
    GpioDoControl(const std::string& name,
                  const BT::NodeConfiguration& config,
                  const rclcpp::Node::SharedPtr& node);

    ~GpioDoControl() override;

    static BT::PortsList providedPorts();

    BT::NodeStatus tick() override;

    // Called by the BT engine (possibly from another thread) to interrupt an
    // in-flight tick(). We use it to break out of the push sleep and to stop
    // the second (de-assert) publish from firing after a halt.
    void halt() override;

private:
    // Returns false if the shared publisher is unavailable.
    bool publish_value(const std::string& gpio_id, const std::string& do_id,
                       bool value, const std::string& control_name);

    rclcpp::Node::SharedPtr node_;

    // Set by halt(); checked during the push sleep and before the second
    // publish. Reset at the start of each tick().
    std::atomic<bool> halt_requested_{false};

    // Shared across ALL instances — one publisher on the single shared
    // commands topic, created once by the first constructed instance and
    // destroyed with the last. publisher_mutex_ guards both the pointer and
    // the reference count, and serialises publish() calls.
    static rclcpp::Publisher<control_msgs::msg::DynamicInterfaceGroupValues>::SharedPtr publisher_;
    static std::mutex publisher_mutex_;
    static std::size_t instance_count_;
};

}  // namespace bt_control