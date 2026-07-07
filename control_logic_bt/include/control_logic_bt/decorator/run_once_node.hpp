#pragma once

#include <behaviortree_cpp_v3/decorator_node.h>

class RunOnce : public BT::DecoratorNode
{
public:
    RunOnce(const std::string& name, const BT::NodeConfiguration& config);

    static BT::PortsList providedPorts() { return {}; }

    BT::NodeStatus tick() override;

private:
    bool has_run_;
};