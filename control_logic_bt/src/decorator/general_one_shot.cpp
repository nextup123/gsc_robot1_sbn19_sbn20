#include "control_logic_bt/decorator/general_one_shot.hpp"

GeneralOneShot::GeneralOneShot(const std::string& name, const BT::NodeConfiguration& config)
    : BT::DecoratorNode(name, config),
      already_ran_(false)
{
}

BT::PortsList GeneralOneShot::providedPorts()
{
  return {};
}

BT::NodeStatus GeneralOneShot::tick()
{
  // Get node from blackboard if not already set
  if (!node_)
  {
    if (!config().blackboard->get("node", node_))
    {
      // Node not found - log error and return SUCCESS (so tree continues)
      // This prevents the tree from failing due to missing node
      RCLCPP_ERROR(rclcpp::get_logger("GeneralOneShot"), 
                   "[%s] No 'node' found in blackboard, returning SUCCESS", 
                   name().c_str());
      return BT::NodeStatus::SUCCESS;
    }
  }

  // If already ran successfully, just return SUCCESS
  if (already_ran_)
  {
    return BT::NodeStatus::SUCCESS;
  }

  // Execute child
  const BT::NodeStatus child_state = child_node_->executeTick();

  // Once child finishes (either SUCCESS or FAILURE), mark as ran
  if (child_state == BT::NodeStatus::SUCCESS || child_state == BT::NodeStatus::FAILURE)
  {
    std::lock_guard<std::mutex> lock(mutex_);
    already_ran_ = true;
    
    if (node_)
    {
      RCLCPP_DEBUG(node_->get_logger(), "[%s] Completed with status: %s, will return SUCCESS on future ticks", 
                   name().c_str(), 
                   child_state == BT::NodeStatus::SUCCESS ? "SUCCESS" : "FAILURE");
    }
    
    // Always return SUCCESS after first execution
    return BT::NodeStatus::SUCCESS;
  }

  // Still running
  return BT::NodeStatus::RUNNING;
}

void GeneralOneShot::halt()
{
  // Reset state on halt
  already_ran_ = false;

  // Propagate halt to child
  if (child_node_)
  {
    child_node_->halt();
  }

  BT::DecoratorNode::halt();
}

GeneralOneShot::~GeneralOneShot()
{
  try
  {
    if (child_node_)
    {
      child_node_->halt();
    }
  }
  catch (...)
  {
    // Ignore exceptions during destruction
  }
}