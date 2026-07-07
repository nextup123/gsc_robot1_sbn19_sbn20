#include "control_logic_bt/control/pause_control_node.hpp"
#include <chrono>
#include <thread>

using namespace std::chrono_literals;

// ---------- Static Variables -------------
rclcpp::Node::SharedPtr PauseControlUtil::node_ = nullptr;
rclcpp::Subscription<std_msgs::msg::Bool>::SharedPtr PauseControlUtil::sub_ = nullptr;
std::atomic<bool> PauseControlUtil::paused_{false};

// ---------- PauseControlUtil Implementation -------------
void PauseControlUtil::set_node(rclcpp::Node::SharedPtr node)
{
  node_ = node;
  sub_ = node_->create_subscription<std_msgs::msg::Bool>(
    "/pause", 10, PauseControlUtil::callback);
}

void PauseControlUtil::callback(const std_msgs::msg::Bool::SharedPtr msg)
{
  paused_ = msg->data;
}

void PauseControlUtil::wait_if_paused()
{
  while (paused_) {
    rclcpp::sleep_for(100ms);
    rclcpp::spin_some(node_);
  }
}

bool PauseControlUtil::is_paused()
{
  return paused_;
}

// ---------- PauseControlNode Implementation -------------

PauseControlNode::PauseControlNode(const std::string& name, const BT::NodeConfiguration& config)
: BT::ControlNode(name, config)
{}

BT::PortsList PauseControlNode::providedPorts()
{
  return {};
}

BT::NodeStatus PauseControlNode::tick()
{
  PauseControlUtil::wait_if_paused();

  for (size_t index = 0; index < children_nodes_.size(); ++index)
  {
    setStatus(BT::NodeStatus::RUNNING);
    
    // Check pause state before executing child
    PauseControlUtil::wait_if_paused();
    
    const BT::NodeStatus child_status = children_nodes_[index]->executeTick();

    // Check pause state after child execution
    PauseControlUtil::wait_if_paused();

    // If we're paused, return RUNNING to maintain the current state
    if (PauseControlUtil::is_paused()) {
      return BT::NodeStatus::RUNNING;
    }

    switch (child_status)
    {
      case BT::NodeStatus::SUCCESS:
        continue;
      case BT::NodeStatus::RUNNING:
        return BT::NodeStatus::RUNNING;
      case BT::NodeStatus::FAILURE:
        return BT::NodeStatus::FAILURE;
      default:
        return BT::NodeStatus::FAILURE;
    }
  }

  return BT::NodeStatus::SUCCESS;
}
