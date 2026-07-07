#pragma once

#include <behaviortree_cpp_v3/action_node.h>
#include <chrono>

class TimerStart : public BT::SyncActionNode
{
public:
    TimerStart(const std::string& name,
               const BT::NodeConfiguration& config);

    static BT::PortsList providedPorts();

    BT::NodeStatus tick() override;
};