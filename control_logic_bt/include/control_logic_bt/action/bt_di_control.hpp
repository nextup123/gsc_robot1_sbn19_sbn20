/**
 * @file bt_di_control.hpp
 * @author Adnan Alvi
 * @brief Header file for DIControl Behavior Tree node.
 * @version 1.6
 * @date 2025-12-16
 * @company Nextup Robotics Private Limited
 * @designation Robotics Software Engineer
 */

#ifndef BT_DI_CONTROL_HPP
#define BT_DI_CONTROL_HPP

#include <behaviortree_cpp_v3/action_node.h>
#include <rclcpp/rclcpp.hpp>
#include <nextup_joint_interfaces/msg/nextup_digital_inputs.hpp>

#include <array>
#include <string>

namespace bt_control
{

class DIControl : public BT::StatefulActionNode
{
public:
    DIControl(
        const std::string& name,
        const BT::NodeConfiguration& config,
        const rclcpp::Node::SharedPtr& node);

    static BT::PortsList providedPorts();

    BT::NodeStatus onStart() override;
    BT::NodeStatus onRunning() override;
    void onHalted() override;

private:
    // -------------------------
    // Internal DI storage
    // -------------------------
    struct DIState
    {
        bool di1{false};
        bool di2{false};
        bool di3{false};
        bool di4{false};
        bool di5{false};
    };

    std::array<DIState, 6> di_states_;

    // -------------------------
    // ROS
    // -------------------------
    rclcpp::Node::SharedPtr node_;
    rclcpp::Subscription<nextup_joint_interfaces::msg::NextupDigitalInputs>::SharedPtr subscription_;

    // -------------------------
    // Cached input values
    // -------------------------
    int driver_id_{0};
    int di_id_{0};
    int wait_time_{0};
    bool expected_status_{false};
    std::string status_name_;

    // -------------------------
    // BT runtime state
    // -------------------------
    rclcpp::Time start_time_;
    bool first_tick_{true};

    // -------------------------
    // Logging control
    // -------------------------
    double last_progress_log_ms_{0.0};  // For throttling waiting logs

    // -------------------------
    // Callback
    // -------------------------
    void jointStateCallback(
        const nextup_joint_interfaces::msg::NextupDigitalInputs::SharedPtr msg);
};

}  // namespace bt_control

#endif  // BT_DI_CONTROL_HPP