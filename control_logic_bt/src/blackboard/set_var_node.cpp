#include "control_logic_bt/blackboard/set_var_node.hpp"

SetVar::SetVar(const std::string& name,
               const BT::NodeConfiguration& config)
    : BT::SyncActionNode(name, config)
{}

BT::PortsList SetVar::providedPorts()
{
    return {
        BT::InputPort<std::string>("key"),
        BT::InputPort<std::string>("value")
    };
}

BT::NodeStatus SetVar::tick()
{
    std::string key, value;

    if (!getInput("key", key) ||
        !getInput("value", value))
    {
        throw BT::RuntimeError("Missing input in SetVar");
    }

    // ----------------------------------------
    // Resolve ${blackboard_var}
    // ----------------------------------------

    size_t start = value.find("${");

    while (start != std::string::npos)
    {
        size_t end = value.find("}", start);

        if (end == std::string::npos)
        {
            break;
        }

        std::string bb_key =
            value.substr(start + 2,
                         end - start - 2);

        std::string bb_value;

        try
        {
            bb_value =
                config().blackboard->get<std::string>(bb_key);
        }
        catch (...)
        {
            bb_value = "[undefined]";
        }

        value.replace(start,
                      end - start + 1,
                      bb_value);

        start = value.find("${");
    }

    // ----------------------------------------
    // Store final resolved value
    // ----------------------------------------

    config().blackboard->set(key, value);

    return BT::NodeStatus::SUCCESS;
}