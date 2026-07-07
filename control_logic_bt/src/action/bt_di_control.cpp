/**
 * @file bt_di_control.cpp
 * @author Adnan Alvi
 * @brief Behavior Tree node to monitor digital inputs with clean, pure logging.
 * @version 1.6
 * @date 2025-12-16
 * @company Nextup Robotics Private Limited
 * @designation Robotics Software Engineer
 */

#include "control_logic_bt/action/bt_di_control.hpp"

#include <rclcpp/rclcpp.hpp>
#include <algorithm>

namespace bt_control
{

DIControl::DIControl(
    const std::string& name,
    const BT::NodeConfiguration& config,
    const rclcpp::Node::SharedPtr& node)
    : BT::StatefulActionNode(name, config),
      node_(node),
      first_tick_(true),
      last_progress_log_ms_(0.0)
{
    RCLCPP_INFO(node_->get_logger(),
                "Initializing DIControl node '%s'...", name.c_str());

    di_states_.fill(DIState{});

    subscription_ =
        node_->create_subscription<nextup_joint_interfaces::msg::NextupDigitalInputs>(
            "/nextup_digital_inputs", 10,
            std::bind(&DIControl::jointStateCallback, this, std::placeholders::_1));
}

BT::PortsList DIControl::providedPorts()
{
    return {
        BT::InputPort<int>("driver_id"),
        BT::InputPort<int>("di_id"),
        BT::InputPort<std::string>("status_name"),
        BT::InputPort<bool>("expected_status"),
        BT::InputPort<int>("wait_time")
    };
}

// -------------------------
// Callback
// -------------------------
void DIControl::jointStateCallback(
    const nextup_joint_interfaces::msg::NextupDigitalInputs::SharedPtr msg)
{
    size_t count = std::min(msg->name.size(), di_states_.size());

    for (size_t i = 0; i < count; ++i)
    {
        di_states_[i].di1 = msg->di1[i];
        di_states_[i].di2 = msg->di2[i];
        di_states_[i].di3 = msg->di3[i];
        di_states_[i].di4 = msg->di4[i];
        di_states_[i].di5 = msg->di5[i];
    }
}

// -------------------------
// onStart
// -------------------------
BT::NodeStatus DIControl::onStart()
{
    int driver_id = 0;
    int di_id = 0;
    int wait_time = 200;  // default
    bool expected_status = false;
    std::string status_name;

    if (!getInput("driver_id", driver_id) ||
        !getInput("di_id", di_id) ||
        !getInput("status_name", status_name) ||
        !getInput("expected_status", expected_status))
    {
        RCLCPP_ERROR(node_->get_logger(),
                     "Missing required input for node '%s'",
                     name().c_str());
        return BT::NodeStatus::FAILURE;
    }

    getInput("wait_time", wait_time);

    if (driver_id < 1 || driver_id > 6 || di_id < 1 || di_id > 5 || wait_time < 0)
    {
        RCLCPP_ERROR(node_->get_logger(),
                     "Invalid inputs in '%s': driver_id=%d, di_id=%d, wait_time=%d",
                     name().c_str(), driver_id, di_id, wait_time);
        return BT::NodeStatus::FAILURE;
    }

    // Cache values
    driver_id_ = driver_id;
    di_id_ = di_id;
    expected_status_ = expected_status;
    status_name_ = status_name;
    wait_time_ = wait_time;

    start_time_ = node_->now();
    first_tick_ = true;
    last_progress_log_ms_ = 0.0;

    return BT::NodeStatus::RUNNING;
}

// -------------------------
// onRunning
// -------------------------
BT::NodeStatus DIControl::onRunning()
{
    int joint_index = driver_id_ - 1;
    bool current_state = false;

    switch (di_id_)
    {
        case 1: current_state = di_states_[joint_index].di1; break;
        case 2: current_state = di_states_[joint_index].di2; break;
        case 3: current_state = di_states_[joint_index].di3; break;
        case 4: current_state = di_states_[joint_index].di4; break;
        case 5: current_state = di_states_[joint_index].di5; break;
        default: 
        RCLCPP_INFO(node_->get_logger(),
                    "DI number invalid");
        return BT::NodeStatus::FAILURE;
    }

    double elapsed_ms = (node_->now() - start_time_).seconds() * 1000.0;

    // First tick: Always log start and initial condition
    if (first_tick_)
    {
        RCLCPP_INFO(node_->get_logger(),
                    "%s check started → %s (DI%d on driver %d, expected=%d)",
                    name().c_str(), status_name_.c_str(), di_id_, driver_id_, expected_status_);

        if (current_state == expected_status_)
        {
            RCLCPP_INFO(node_->get_logger(),
                        "%s → CONDITION ALREADY MET (DI%d=%d), succeeded in %.1f ms",
                        name().c_str(), di_id_, current_state, elapsed_ms);
        }
        else
        {
            RCLCPP_WARN(node_->get_logger(),
                        "%s → CONDITION NOT MET yet (DI%d=%d), waiting up to %d ms...",
                        name().c_str(), di_id_, current_state, wait_time_);
        }
        first_tick_ = false;
    }

    // Timeout
    if (elapsed_ms >= wait_time_)
    {
        if (current_state == expected_status_)
        {
            RCLCPP_INFO(node_->get_logger(),
                        "%s → CONDITION MET after %.1f ms → SUCCESS",
                        name().c_str(), elapsed_ms);
            return BT::NodeStatus::SUCCESS;
        }
        else
        {
            RCLCPP_ERROR(node_->get_logger(),
                         "%s → TIMEOUT: DI%d=%d (expected=%d) after %d ms → FAILURE",
                         name().c_str(), di_id_, current_state, expected_status_, wait_time_);
            return BT::NodeStatus::FAILURE;
        }
    }

    // Periodic progress log while waiting (every 1 second)
    if (current_state != expected_status_)
    {
        if (elapsed_ms - last_progress_log_ms_ >= 1000.0) 
        {
            RCLCPP_INFO(node_->get_logger(),
                        "%s → still waiting: DI%d=%d (expected=%d), elapsed=%.1f ms",
                        name().c_str(), di_id_, current_state, expected_status_, elapsed_ms);
            last_progress_log_ms_ = elapsed_ms;
        }
    }
    // Condition met during waiting
    else if (!first_tick_)
    {
        RCLCPP_INFO(node_->get_logger(),
                    "%s → CONDITION MET after %.1f ms → SUCCESS",
                    name().c_str(), elapsed_ms);
        return BT::NodeStatus::SUCCESS;
    }

    return BT::NodeStatus::RUNNING;
}

// -------------------------
// onHalted
// -------------------------
void DIControl::onHalted()
{
    RCLCPP_INFO(node_->get_logger(),
                "DIControl node '%s' halted", name().c_str());
}

}  // namespace bt_control