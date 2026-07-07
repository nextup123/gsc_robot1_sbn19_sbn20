#pragma once

#include <behaviortree_cpp_v3/decorator_node.h>

class DelayTicks : public BT::DecoratorNode
{
public:
    DelayTicks(const std::string& name, const BT::NodeConfiguration& config);

    static BT::PortsList providedPorts();

    BT::NodeStatus tick() override;

    void halt() override;

private:
    int ticks_required_;
    int tick_counter_;
};