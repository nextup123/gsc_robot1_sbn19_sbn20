#ifndef CONTROL_LOGIC_BT__BT_DO_CONTROL_HPP_
#define CONTROL_LOGIC_BT__BT_DO_CONTROL_HPP_

#include "behaviortree_cpp_v3/action_node.h"  // v3 include
#include "rclcpp/rclcpp.hpp"
#include "nextup_joint_interfaces/msg/nextup_digital_outputs.hpp"
#include <unordered_map>
#include <mutex>
#include <chrono>

namespace bt_control
{

class DoControl : public BT::AsyncActionNode
{
public:
    DoControl(const std::string& name,
              const BT::NodeConfiguration& config,
              const rclcpp::Node::SharedPtr& node);

    static BT::PortsList providedPorts();

    // Override the virtual tick() from AsyncActionNode
    BT::NodeStatus tick() override;

private:
    rclcpp::Node::SharedPtr node_;

    // Publisher cache: one per driver_id
    std::unordered_map<int, rclcpp::Publisher<nextup_joint_interfaces::msg::NextupDigitalOutputs>::SharedPtr> publishers_;
    std::mutex publishers_mutex_;

    rclcpp::Publisher<nextup_joint_interfaces::msg::NextupDigitalOutputs>::SharedPtr
    get_publisher(int driver_id);

    void publish_value(int driver_id, const std::string& do_id, bool value, const std::string& control_name);
};

}  // namespace bt_control

#endif