#include "control_logic_bt/blackboard/make_pilz_motion_node.hpp"
#include <sstream>

MakePilzMotion::MakePilzMotion(const std::string& name,
                               const BT::NodeConfiguration& config)
    : BT::ControlNode(name, config)
{}

BT::PortsList MakePilzMotion::providedPorts()
{
    return {
        BT::InputPort<std::string>("output_key")
    };
}

BT::NodeStatus MakePilzMotion::tick()
{
    std::string output_key;

    if (!getInput("output_key", output_key))
    {
        throw BT::RuntimeError("Missing [output_key] in MakePilzMotion");
    }

    // unique temp key per node instance
    tmp_key_ = output_key + "_tmp";

    // initialize container
    config().blackboard->set(tmp_key_, std::vector<std::string>{});

    // tick children sequentially (like Sequence)
    for (size_t i = 0; i < children_nodes_.size(); i++)
    {
        auto status = children_nodes_[i]->executeTick();

        if (status == BT::NodeStatus::FAILURE)
            return BT::NodeStatus::FAILURE;

        if (status == BT::NodeStatus::RUNNING)
            return BT::NodeStatus::RUNNING;
    }

    // collect result
    auto vec = config().blackboard->get<std::vector<std::string>>(tmp_key_);

    std::ostringstream oss;
    for (size_t i = 0; i < vec.size(); i++)
    {
        oss << vec[i];
        if (i != vec.size() - 1)
            oss << ",";
    }

    // store final string
    config().blackboard->set(output_key, oss.str());

    return BT::NodeStatus::SUCCESS;
}