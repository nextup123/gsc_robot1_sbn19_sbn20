#pragma once

#include <behaviortree_cpp_v3/condition_node.h>

class Compare : public BT::ConditionNode
{
public:
    Compare(const std::string& name, const BT::NodeConfiguration& config);

    static BT::PortsList providedPorts();

    BT::NodeStatus tick() override;

private:
    bool compareInt(int left, int right, const std::string& op);
    bool compareFloat(double left, double right, const std::string& op);
    bool compareString(const std::string& left, const std::string& right, const std::string& op);
    bool compareBool(bool left, bool right, const std::string& op);
};