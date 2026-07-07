#include "control_logic_bt/blackboard/arithmetic_node.hpp"

ArithmeticNode::ArithmeticNode(const std::string& name, const BT::NodeConfiguration& config)
    : BT::SyncActionNode(name, config)
{}

BT::PortsList ArithmeticNode::providedPorts()
{
    return {
        BT::InputPort<std::string>("a"),
        BT::InputPort<std::string>("b"),
        BT::InputPort<std::string>("op"),
        BT::OutputPort<std::string>("result")
    };
}

BT::NodeStatus ArithmeticNode::tick()
{
    std::string a_str, b_str, op;

    if (!getInput("a", a_str) ||
        !getInput("b", b_str) ||
        !getInput("op", op))
    {
        throw BT::RuntimeError("Missing input in ArithmeticNode");
    }

    try
    {
        // Try integer first
        int a = std::stoi(a_str);
        int b = std::stoi(b_str);

        int result = 0;

        if (op == "add")
            result = a + b;
        else if (op == "sub")
            result = a - b;
        else if (op == "mul")
            result = a * b;
        else if (op == "div")
        {
            if (b == 0)
                throw BT::RuntimeError("Division by zero");
            result = a / b;
        }
        else
        {
            throw BT::RuntimeError("Unknown operation: " + op);
        }

        setOutput("result", std::to_string(result));
    }
    catch (...)
    {
        throw BT::RuntimeError("ArithmeticNode conversion failed");
    }

    return BT::NodeStatus::SUCCESS;
}