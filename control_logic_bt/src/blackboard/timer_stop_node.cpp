#include "control_logic_bt/blackboard/timer_stop_node.hpp"

#include <chrono>
#include <sstream>

TimerStop::TimerStop(const std::string& name,
                     const BT::NodeConfiguration& config)
    : BT::SyncActionNode(name, config)
{}

BT::PortsList TimerStop::providedPorts()
{
    return {
        BT::InputPort<std::string>("key")
    };
}

BT::NodeStatus TimerStop::tick()
{
    std::string key;

    if (!getInput("key", key))
    {
        throw BT::RuntimeError("Missing [key] in TimerStop");
    }

    try
    {
        std::string start_str =
            config().blackboard->get<std::string>(key + "_start");

        long long start_ms = std::stoll(start_str);

        auto now = std::chrono::steady_clock::now();

        long long current_ms =
            std::chrono::duration_cast<std::chrono::milliseconds>(
                now.time_since_epoch()).count();

        double elapsed_sec =
            (current_ms - start_ms) / 1000.0;

        std::ostringstream oss;
        oss << elapsed_sec;

        config().blackboard->set(key, oss.str());
    }
    catch (...)
    {
        throw BT::RuntimeError("TimerStop failed");
    }

    return BT::NodeStatus::SUCCESS;
}