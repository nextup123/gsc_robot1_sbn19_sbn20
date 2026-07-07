#ifndef WAIT_UNTIL_TRUE_HPP_
#define WAIT_UNTIL_TRUE_HPP_

#include <behaviortree_cpp_v3/decorator_node.h>
#include <rclcpp/rclcpp.hpp>
#include <chrono>
#include <atomic>

class WaitUntilTrue : public BT::DecoratorNode
{
public:
  WaitUntilTrue(const std::string& name, const BT::NodeConfiguration& config);

  static BT::PortsList providedPorts()
  {
    return { 
      BT::InputPort<int>("timeout_ms", "Timeout in milliseconds. If not specified, waits indefinitely."),
      BT::InputPort<int>("check_interval_ms", "How often to check condition (default: 100ms)")
    };
  }

  virtual ~WaitUntilTrue() override;

  BT::NodeStatus tick() override;
  void halt() override;

private:
  void reset();
  bool isTimeoutReached() const;
  
  rclcpp::Node::SharedPtr node_;
  
  std::chrono::steady_clock::time_point start_time_;
  int timeout_ms_;
  int check_interval_ms_;
  bool has_timeout_;
  bool timer_started_;
  bool halted_;
};

#endif  // WAIT_UNTIL_TRUE_HPP_