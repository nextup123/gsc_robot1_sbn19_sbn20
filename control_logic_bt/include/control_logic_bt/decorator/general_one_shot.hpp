#pragma once

#include "behaviortree_cpp_v3/decorator_node.h"
#include "rclcpp/rclcpp.hpp"
#include <atomic>
#include <mutex>
#include <memory>

// GeneralOneShot
// ------------------------------------------------------------------
// One-shot decorator: ticks its child until the child completes once
// (SUCCESS or FAILURE), then returns SUCCESS on every subsequent tick
// without re-running the child. Reset on halt().
//
// The rclcpp node is injected via the constructor (registered with a
// builder in main.cpp), NOT pulled from the blackboard. This matters:
// when the node lives inside a SubTreePlus, the subtree has its OWN
// isolated blackboard that does NOT contain the "node" entry set in
// main(), so a blackboard lookup fails there. Constructor injection
// works identically in the root tree and in any subtree.
// ------------------------------------------------------------------
class GeneralOneShot : public BT::DecoratorNode
{
public:
  GeneralOneShot(const std::string& name,
                 const BT::NodeConfiguration& config,
                 rclcpp::Node::SharedPtr node);

  static BT::PortsList providedPorts();

  BT::NodeStatus tick() override;
  void halt() override;

  virtual ~GeneralOneShot();

private:
  std::atomic<bool> already_ran_;
  std::mutex mutex_;
  rclcpp::Node::SharedPtr node_;
};