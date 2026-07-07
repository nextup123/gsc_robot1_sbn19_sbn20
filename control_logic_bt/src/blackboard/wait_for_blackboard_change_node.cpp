#include "control_logic_bt/blackboard/wait_for_blackboard_change_node.hpp"

WaitForBlackboardChange::WaitForBlackboardChange(
    const std::string& name,
    const BT::NodeConfiguration& config)
    : BT::ConditionNode(name, config),
      initialized_(false)
{}

BT::PortsList WaitForBlackboardChange::providedPorts()
{
    return {
        BT::InputPort<std::string>("key")
    };
}

BT::NodeStatus WaitForBlackboardChange::tick()
{
    std::string key;

    if (!getInput("key", key))
    {
        throw BT::RuntimeError(
            "Missing [key] in WaitForBlackboardChange");
    }

    std::string current_value;

    try
    {
        current_value =
            config().blackboard->get<std::string>(key);
    }
    catch (...)
    {
        return BT::NodeStatus::RUNNING;
    }

    // first tick initialization
    if (!initialized_)
    {
        previous_value_ = current_value;
        initialized_ = true;

        return BT::NodeStatus::RUNNING;
    }

    // detect change
    if (current_value != previous_value_)
    {
        previous_value_ = current_value;

        return BT::NodeStatus::SUCCESS;
    }

    return BT::NodeStatus::RUNNING;
}