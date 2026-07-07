#pragma once

#include "behaviortree_cpp_v3/action_node.h"
#include <iostream>
#include <stdexcept>

class ResetTreeTrigger : public BT::SyncActionNode
{
public:
  ResetTreeTrigger(const std::string& name, const BT::NodeConfiguration& config)
    : BT::SyncActionNode(name, config) {}

  static BT::PortsList providedPorts()
  {
    return {};
  }

  BT::NodeStatus tick() override
  {
    std::cout << "[ResetTreeTrigger] Tree reset requested!" << std::endl;
    throw BT::RuntimeError("RESET_TREE_REQUEST");
  }
};
