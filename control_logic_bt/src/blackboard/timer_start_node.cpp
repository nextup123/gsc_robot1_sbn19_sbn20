#include "control_logic_bt/blackboard/timer_start_node.hpp"

TimerStart::TimerStart(const std::string& name,
                       const BT::NodeConfiguration& config)
    : BT::SyncActionNode(name, config)
{}

BT::PortsList TimerStart::providedPorts()
{
    return {
        BT::InputPort<std::string>("key")
    };
}

BT::NodeStatus TimerStart::tick()
{
    std::string key;

    if (!getInput("key", key))
    {
        throw BT::RuntimeError("Missing [key] in TimerStart");
    }

    auto now = std::chrono::steady_clock::now();

    auto timestamp =
        std::chrono::duration_cast<std::chrono::milliseconds>(
            now.time_since_epoch()).count();

    config().blackboard->set(key + "_start",
                             std::to_string(timestamp));

    return BT::NodeStatus::SUCCESS;
}