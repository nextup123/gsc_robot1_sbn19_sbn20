#include "control_logic_bt/blackboard/compare_node.hpp"

Compare::Compare(const std::string &name, const BT::NodeConfiguration &config)
    : BT::ConditionNode(name, config)
{}

BT::PortsList Compare::providedPorts()
{
    return {
        BT::InputPort<std::string>("left"),
        BT::InputPort<std::string>("right"),
        BT::InputPort<std::string>("op"),
        BT::InputPort<std::string>("type") // optional
    };
}

BT::NodeStatus Compare::tick()

{
    std::string left_str, right_str, op, type;

    if (!getInput("left", left_str) ||
        !getInput("right", right_str) ||
        !getInput("op", op))
    {
        throw BT::RuntimeError("Missing input in Compare node");
    }

    // optional type
    getInput("type", type);

    bool result = false;

    try
    {
        // AUTO TYPE DETECTION
        if (type.empty())
        {
            // try int
            try {
                int left = std::stoi(left_str);
                int right = std::stoi(right_str);
                result = compareInt(left, right, op);
                return result ? BT::NodeStatus::SUCCESS : BT::NodeStatus::FAILURE;
            } catch (...) {}

            // try float
            try {
                double left = std::stod(left_str);
                double right = std::stod(right_str);
                result = compareFloat(left, right, op);
                return result ? BT::NodeStatus::SUCCESS : BT::NodeStatus::FAILURE;
            } catch (...) {}

            // fallback string
            result = compareString(left_str, right_str, op);
        }
        else if (type == "int")
        {
            result = compareInt(std::stoi(left_str), std::stoi(right_str), op);
        }
        else if (type == "float")
        {
            result = compareFloat(std::stod(left_str), std::stod(right_str), op);
        }
        else if (type == "bool")
        {
            bool left = (left_str == "true");
            bool right = (right_str == "true");
            result = compareBool(left, right, op);
        }
        else // string
        {
            result = compareString(left_str, right_str, op);
        }
    }
    catch (...)
    {
        throw BT::RuntimeError("Comparison failed");
    }

    return result ? BT::NodeStatus::SUCCESS : BT::NodeStatus::FAILURE;
}


bool Compare::compareInt(int left, int right, const std::string& op)
{
    if (op == "==") return left == right;
    if (op == "!=") return left != right;
    if (op == ">") return left > right;
    if (op == "<") return left < right;
    if (op == ">=") return left >= right;
    if (op == "<=") return left <= right;
    throw BT::RuntimeError("Invalid operator for int");
}

bool Compare::compareFloat(double left, double right, const std::string& op)
{
    if (op == "==") return left == right;
    if (op == "!=") return left != right;
    if (op == ">") return left > right;
    if (op == "<") return left < right;
    if (op == ">=") return left >= right;
    if (op == "<=") return left <= right;
    throw BT::RuntimeError("Invalid operator for float");
}

bool Compare::compareString(const std::string& left, const std::string& right, const std::string& op)
{
    if (op == "==") return left == right;
    if (op == "!=") return left != right;
    throw BT::RuntimeError("Invalid operator for string");
}

bool Compare::compareBool(bool left, bool right, const std::string& op)
{
    if (op == "==") return left == right;
    if (op == "!=") return left != right;
    throw BT::RuntimeError("Invalid operator for bool");
}