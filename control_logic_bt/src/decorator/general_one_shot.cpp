#include "control_logic_bt/decorator/general_one_shot.hpp"

GeneralOneShot::GeneralOneShot(const std::string& name,
                               const BT::NodeConfiguration& config,
                               rclcpp::Node::SharedPtr node)
    : BT::DecoratorNode(name, config),
      already_ran_(false),
      node_(std::move(node))
{
}

BT::PortsList GeneralOneShot::providedPorts()
{
  return {};
}

BT::NodeStatus GeneralOneShot::tick()
{
  setStatus(BT::NodeStatus::RUNNING);

  // If already ran once, short-circuit to SUCCESS without re-running child.
  if (already_ran_.load())
  {
    return BT::NodeStatus::SUCCESS;
  }

  // Execute child.
  const BT::NodeStatus child_state = child_node_->executeTick();

  // Once child finishes (SUCCESS or FAILURE), latch and never run again.
  if (child_state == BT::NodeStatus::SUCCESS ||
      child_state == BT::NodeStatus::FAILURE)
  {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      already_ran_.store(true);
    }

    // Child is done; make sure it's reset/halted so it isn't left RUNNING.
    haltChild();

    if (node_)
    {
      RCLCPP_DEBUG(node_->get_logger(),
                   "[%s] Completed with status: %s; returns SUCCESS henceforth",
                   name().c_str(),
                   child_state == BT::NodeStatus::SUCCESS ? "SUCCESS" : "FAILURE");
    }

    return BT::NodeStatus::SUCCESS;
  }

  // Child still running.
  return BT::NodeStatus::RUNNING;
}

void GeneralOneShot::halt()
{
  // Reset one-shot latch so the node can run again after a halt/reset.
  already_ran_.store(false);
  BT::DecoratorNode::halt();   // halts the child and sets IDLE
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
    // Ignore exceptions during destruction.
  }
}