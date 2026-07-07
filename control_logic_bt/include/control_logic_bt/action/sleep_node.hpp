#pragma once
#include "behaviortree_cpp_v3/action_node.h"
#include <chrono>

class SleepNode : public BT::StatefulActionNode
{
public:
  SleepNode(const std::string& name, const BT::NodeConfiguration& config)
    : BT::StatefulActionNode(name, config) {}

  static BT::PortsList providedPorts()
  {
    return { BT::InputPort<int>("msec") };
  }

  BT::NodeStatus onStart() override
  {
    int msec = 0;
    if (!getInput<int>("msec", msec)) {
      throw BT::RuntimeError("Missing parameter [msec]");
    }
    if (msec <= 0) {
      return BT::NodeStatus::SUCCESS;
    }

    deadline_ = std::chrono::steady_clock::now() +
                std::chrono::milliseconds(msec);
    return BT::NodeStatus::RUNNING;
  }

  BT::NodeStatus onRunning() override
  {
    if (std::chrono::steady_clock::now() >= deadline_) {
      return BT::NodeStatus::SUCCESS;
    }
    return BT::NodeStatus::RUNNING;
  }

  void onHalted() override
  {
    // nothing to clean — no thread, no resource
  }

private:
  std::chrono::steady_clock::time_point deadline_;
};