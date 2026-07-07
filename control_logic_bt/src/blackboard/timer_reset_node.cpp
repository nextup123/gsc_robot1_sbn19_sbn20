#include "control_logic_bt/blackboard/timer_reset_node.hpp"

TimerReset::TimerReset(const std::string& name,
                       const BT::NodeConfiguration& config)
    : BT::SyncActionNode(name, config)
{}

BT::PortsList TimerReset::providedPorts()
{
    return {
        BT::InputPort<std::string>("key")
    };
}

BT::NodeStatus TimerReset::tick()
{
    std::string key;

    if (!getInput("key", key))
    {
        throw BT::RuntimeError("Missing [key] in TimerReset");
    }

    config().blackboard->set(key, "0");
    config().blackboard->set(key + "_start", "0");

    return BT::NodeStatus::SUCCESS;
}