#pragma once

#include "behaviortree_cpp_v3/decorator_node.h"
#include "rclcpp/rclcpp.hpp"
#include <atomic>
#include <mutex>
#include <memory>

class GeneralOneShot : public BT::DecoratorNode
{
public:
  GeneralOneShot(const std::string& name, const BT::NodeConfiguration& config);
  
  static BT::PortsList providedPorts();
  
  BT::NodeStatus tick() override;
  void halt() override;
  
  virtual ~GeneralOneShot();

private:
  std::atomic<bool> already_ran_;
  std::mutex mutex_;
  rclcpp::Node::SharedPtr node_;
};