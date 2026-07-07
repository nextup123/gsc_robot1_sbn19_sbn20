#pragma once

#include <behaviortree_cpp_v3/condition_node.h>

class WaitForBlackboardChange : public BT::ConditionNode
{
public:
    WaitForBlackboardChange(const std::string& name,
                            const BT::NodeConfiguration& config);

    static BT::PortsList providedPorts();

    BT::NodeStatus tick() override;

private:
    bool initialized_;
    std::string previous_value_;
};