#pragma once

#include <behaviortree_cpp_v3/action_node.h>

class MathExpression : public BT::SyncActionNode
{
public:
    MathExpression(const std::string& name,
                   const BT::NodeConfiguration& config);

    static BT::PortsList providedPorts();

    BT::NodeStatus tick() override;

private:
    double getValue(const std::string& key);
};