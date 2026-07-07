#include "control_logic_bt/action/bt_do_control.hpp"
#include <rclcpp/rclcpp.hpp>
#include <nextup_joint_interfaces/msg/nextup_digital_outputs.hpp>
#include <thread>
#include <chrono>

namespace bt_control
{

DoControl::DoControl(const std::string& name,
                     const BT::NodeConfiguration& config,
                     const rclcpp::Node::SharedPtr& node)
    : BT::AsyncActionNode(name, config), node_(node)
{
    RCLCPP_INFO(node_->get_logger(),
                "Initializing Async DoControl BT node '%s'...", name.c_str());
}

BT::PortsList DoControl::providedPorts()
{
    return {
        BT::InputPort<int>("driver_id"),
        BT::InputPort<std::string>("do_id"),
        BT::InputPort<std::string>("control_name"),
        BT::InputPort<std::string>("type_of_control"),
        BT::InputPort<bool>("expected_action"),
        BT::InputPort<int>("push_wait")
    };
}

// Thread-safe publisher retrieval
rclcpp::Publisher<nextup_joint_interfaces::msg::NextupDigitalOutputs>::SharedPtr
DoControl::get_publisher(int driver_id)
{
    std::lock_guard<std::mutex> lock(publishers_mutex_);
    auto it = publishers_.find(driver_id);
    if (it != publishers_.end())
        return it->second;

    std::string topic =
        "/nextup_digital_output_controller_" +
        std::to_string(driver_id) + "/commands";

    auto pub = node_->create_publisher<
        nextup_joint_interfaces::msg::NextupDigitalOutputs>(topic, 10);

    publishers_[driver_id] = pub;
    RCLCPP_DEBUG(node_->get_logger(), "Created publisher for driver %d", driver_id);
    return pub;
}

void DoControl::publish_value(int driver_id, const std::string& do_id,
                              bool value, const std::string& control_name)
{
    nextup_joint_interfaces::msg::NextupDigitalOutputs msg;
    if (do_id == "1")          msg.do1 = {value};
    else if (do_id == "2")     msg.do2 = {value};
    else if (do_id == "3")     msg.do3 = {value};
    else if (do_id == "pi_p")  msg.pi_p = {value};

    auto pub = get_publisher(driver_id);
    pub->publish(msg);

    RCLCPP_INFO(node_->get_logger(),
        "Published %s = %s | control='%s' | driver=%d",
        do_id.c_str(), value ? "true" : "false",
        control_name.c_str(), driver_id);
}

BT::NodeStatus DoControl::tick()
{
    // Read inputs (in the async thread)
    int driver_id;
    if (!getInput("driver_id", driver_id)) {
        RCLCPP_ERROR(node_->get_logger(), "Missing 'driver_id'");
        return BT::NodeStatus::FAILURE;
    }

    std::string do_id;
    if (!getInput("do_id", do_id)) {
        RCLCPP_ERROR(node_->get_logger(), "Missing 'do_id'");
        return BT::NodeStatus::FAILURE;
    }

    std::string control_name;
    if (!getInput("control_name", control_name)) {
        RCLCPP_ERROR(node_->get_logger(), "Missing 'control_name'");
        return BT::NodeStatus::FAILURE;
    }

    std::string type_of_control;
    if (!getInput("type_of_control", type_of_control)) {
        RCLCPP_ERROR(node_->get_logger(), "Missing 'type_of_control'");
        return BT::NodeStatus::FAILURE;
    }

    bool expected_action;
    if (!getInput("expected_action", expected_action)) {
        RCLCPP_ERROR(node_->get_logger(), "Missing 'expected_action'");
        return BT::NodeStatus::FAILURE;
    }

    int push_wait = 250;
    if (type_of_control == "push" && !getInput("push_wait", push_wait)) {
        RCLCPP_WARN(node_->get_logger(), "No 'push_wait', using 250ms");
    }

    // Validation
    if (driver_id < 1 || driver_id > 6) {
        RCLCPP_ERROR(node_->get_logger(), "Invalid driver_id %d", driver_id);
        return BT::NodeStatus::FAILURE;
    }
    if (type_of_control != "push" && type_of_control != "switch") {
        RCLCPP_ERROR(node_->get_logger(), "Invalid type_of_control '%s'", type_of_control.c_str());
        return BT::NodeStatus::FAILURE;
    }
    if (do_id != "1" && do_id != "2" && do_id != "3" && do_id != "pi_p") {
        RCLCPP_ERROR(node_->get_logger(), "Invalid do_id '%s'", do_id.c_str());
        return BT::NodeStatus::FAILURE;
    }

    // Execute (this runs in a separate thread, so blocking sleep is OK)
    if (type_of_control == "switch") {
        publish_value(driver_id, do_id, expected_action, control_name);
        return BT::NodeStatus::SUCCESS;
    }
    else  // push
    {
        publish_value(driver_id, do_id, true, control_name);
        // Blocking sleep inside the async thread – does NOT block the tree
        std::this_thread::sleep_for(std::chrono::milliseconds(push_wait));
        publish_value(driver_id, do_id, false, control_name);
        return BT::NodeStatus::SUCCESS;
    }
}

}  // namespace bt_control
