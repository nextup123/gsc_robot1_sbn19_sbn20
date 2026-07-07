#pragma once

#include <behaviortree_cpp_v3/action_node.h>

class SetVar : public BT::SyncActionNode
{
public:
    SetVar(const std::string& name,
           const BT::NodeConfiguration& config);

    static BT::PortsList providedPorts();

    BT::NodeStatus tick() override;
};