#include "control_logic_bt/blackboard/math_expression_node.hpp"

#include <regex>
#include <sstream>

MathExpression::MathExpression(const std::string &name,
                               const BT::NodeConfiguration &config)
    : BT::SyncActionNode(name, config)
{
}

BT::PortsList MathExpression::providedPorts()
{
    return {
        BT::InputPort<std::string>("expression"),

        // optional variables
        BT::InputPort<std::string>("a"),
        BT::InputPort<std::string>("b"),
        BT::InputPort<std::string>("c"),
        BT::InputPort<std::string>("d"),
        BT::InputPort<std::string>("e"),

        BT::OutputPort<std::string>("result")};
}

double MathExpression::getValue(const std::string &key)
{
    std::string value;

    if (!getInput(key, value))
    {
        return 0.0;
    }

    if (value.empty())
    {
        return 0.0;
    }

    try
    {
        return std::stod(value);
    }
    catch (...)
    {
        return 0.0;
    }
}

BT::NodeStatus MathExpression::tick()
{
    std::string expression;

    if (!getInput("expression", expression))
    {
        throw BT::RuntimeError("Missing expression");
    }

    double a = getValue("a");
    double b = getValue("b");
    double c = getValue("c");
    double d = getValue("d");
    double e = getValue("e");

    // Replace variables in expression
    auto replace_all = [](std::string &str,
                          const std::string &from,
                          const std::string &to)
    {
        size_t start_pos = 0;

        while ((start_pos = str.find(from, start_pos)) != std::string::npos)
        {
            str.replace(start_pos, from.length(), to);
            start_pos += to.length();
        }
    };

    replace_all(expression, "a", std::to_string(a));
    replace_all(expression, "b", std::to_string(b));
    replace_all(expression, "c", std::to_string(c));
    replace_all(expression, "d", std::to_string(d));
    replace_all(expression, "e", std::to_string(e));

    // VERY SIMPLE evaluator (supports only + - * /)
    // Example: (10+20)*2

    try
    {
        // WARNING:
        // This is intentionally lightweight.
        // Replace later with exprtk/tinyexpr for production.

        double result = 0.0;

        // TEMPORARY SIMPLE HANDLING
        // currently supports only:
        // number op number

        std::stringstream ss(expression);

        double lhs, rhs;
        char op;

        ss >> lhs;

        while (ss >> op >> rhs)
        {
            switch (op)
            {
            case '+':
                lhs += rhs;
                break;

            case '-':
                lhs -= rhs;
                break;

            case '*':
                lhs *= rhs;
                break;

            case '/':
                if (rhs == 0)
                {
                    throw BT::RuntimeError("Division by zero");
                }

                lhs /= rhs;
                break;

            default:
                throw BT::RuntimeError("Unsupported operator");
            }
        }

        result = lhs;
        
        // setOutput("result", std::to_string(result));
        std::ostringstream oss;
        oss << result;

        setOutput("result", oss.str());
    }
    catch (...)
    {
        throw BT::RuntimeError("MathExpression evaluation failed");
    }

    return BT::NodeStatus::SUCCESS;
}