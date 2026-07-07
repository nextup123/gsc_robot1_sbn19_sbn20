#pragma once

#include <behaviortree_cpp_v3/action_node.h>
#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/int32.hpp>
#include <mutex>

class CycleCounterNode : public BT::SyncActionNode
{
public:
    CycleCounterNode(const std::string &name, const BT::NodeConfiguration &config)
        : BT::SyncActionNode(name, config), count_(0)
    {
        node_ = rclcpp::Node::make_shared("cycle_counter_node");
        pub_ = node_->create_publisher<std_msgs::msg::Int32>("/cycle_count", 10);

        // Spin the node in a separate thread
        std::thread([this]() { rclcpp::spin(node_); }).detach();
    }

    static BT::PortsList providedPorts()
    {
        return { BT::OutputPort<int>("cycle_count") };
    }

    BT::NodeStatus tick() override
    {
        int value = ++count_;

        // Set blackboard output
        setOutput("cycle_count", value);

        // Publish
        std_msgs::msg::Int32 msg;
        msg.data = value;
        pub_->publish(msg);

        return BT::NodeStatus::SUCCESS;
    }

private:
    int count_;
    rclcpp::Node::SharedPtr node_;
    rclcpp::Publisher<std_msgs::msg::Int32>::SharedPtr pub_;
};
