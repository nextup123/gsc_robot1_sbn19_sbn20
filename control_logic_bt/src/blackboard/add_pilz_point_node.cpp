#include "control_logic_bt/blackboard/add_pilz_point_node.hpp"
#include <sstream>
#include <vector>

AddPilzPoint::AddPilzPoint(const std::string& name,
                           const BT::NodeConfiguration& config)
    : BT::SyncActionNode(name, config)
{}

BT::PortsList AddPilzPoint::providedPorts()
{
    return {
        BT::InputPort<std::string>("point_name"),
        BT::InputPort<std::string>("speed"),
        BT::InputPort<std::string>("output_key") // same as parent
    };
}

BT::NodeStatus AddPilzPoint::tick()
{
    std::string point, speed, output_key;

    if (!getInput("point_name", point) ||
        !getInput("speed", speed) ||
        !getInput("output_key", output_key))
    {
        throw BT::RuntimeError("Missing input in AddPilzPoint");
    }

    std::string tmp_key = output_key + "_tmp";

    // get current vector
    auto vec = config().blackboard->get<std::vector<std::string>>(tmp_key);

    // format: point[speed]
    std::ostringstream oss;
    oss << point << "[" << speed << "]";

    vec.push_back(oss.str());

    // write back
    config().blackboard->set(tmp_key, vec);

    return BT::NodeStatus::SUCCESS;
}