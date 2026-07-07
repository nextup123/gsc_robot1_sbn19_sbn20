#include "control_logic_bt/decorator/run_once_node.hpp"

RunOnce::RunOnce(const std::string& name, const BT::NodeConfiguration& config)
    : BT::DecoratorNode(name, config), has_run_(false)
{}

BT::NodeStatus RunOnce::tick()
{
    if (has_run_)
    {
        // Skip child after first execution
        return BT::NodeStatus::SUCCESS;
    }

    if (!child_node_)
    {
        throw BT::RuntimeError("RunOnce must have a child");
    }

    auto status = child_node_->executeTick();

    if (status == BT::NodeStatus::SUCCESS)
    {
        has_run_ = true;
    }

    return status;
}