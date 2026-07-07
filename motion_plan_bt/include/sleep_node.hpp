#pragma once

#include "behaviortree_cpp_v3/action_node.h"
#include <chrono>
#include <thread>

class SleepNode : public BT::SyncActionNode
{
public:
  SleepNode(const std::string& name, const BT::NodeConfiguration& config)
    : BT::SyncActionNode(name, config) {}

  static BT::PortsList providedPorts()
  {
    return { BT::InputPort<int>("msec") };
  }

  BT::NodeStatus tick() override
  {
    int msec = 0;
    if (!getInput<int>("msec", msec)) {
      throw BT::RuntimeError("Missing parameter [msec]");
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(msec));
    return BT::NodeStatus::SUCCESS;
  }
};
