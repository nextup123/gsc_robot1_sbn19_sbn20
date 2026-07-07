#include "control_logic_bt/blackboard/modulo_node.hpp"

Modulo::Modulo(const std::string &name,
               const BT::NodeConfiguration &config)
    : BT::SyncActionNode(name, config)
{
}

BT::PortsList Modulo::providedPorts()
{
    return {
        BT::InputPort<std::string>("dividend"),
        BT::InputPort<std::string>("divisor"),
        BT::OutputPort<std::string>("result")};
}

BT::NodeStatus Modulo::tick()
{
    std::string dividend_str, divisor_str;

    if (!getInput("dividend", dividend_str) ||
        !getInput("divisor", divisor_str))
    {
        throw BT::RuntimeError("Missing input in Modulo");
    }

    try
    {
        int a = std::stoi(dividend_str);
        int b = std::stoi(divisor_str);

        if (b == 0)
        {
            throw BT::RuntimeError("Modulo division by zero");
        }

        int result = a % b;

        setOutput("result", std::to_string(result));
    }
    catch (...)
    {
        throw BT::RuntimeError("Modulo conversion failed");
    }

    return BT::NodeStatus::SUCCESS;
}