#pragma once

#include <behaviortree_cpp_v3/action_node.h>

class TimerReset : public BT::SyncActionNode
{
public:
    TimerReset(const std::string& name,
               const BT::NodeConfiguration& config);

    static BT::PortsList providedPorts();

    BT::NodeStatus tick() override;
};