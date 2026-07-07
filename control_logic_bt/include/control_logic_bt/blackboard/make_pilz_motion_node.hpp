#pragma once

#include <behaviortree_cpp_v3/control_node.h>
#include <vector>
#include <string>

class MakePilzMotion : public BT::ControlNode
{
public:
    MakePilzMotion(const std::string& name, const BT::NodeConfiguration& config);

    static BT::PortsList providedPorts();

    BT::NodeStatus tick() override;

private:
    std::string tmp_key_;
};