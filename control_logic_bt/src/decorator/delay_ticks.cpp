#include "control_logic_bt/decorator/delay_ticks.hpp"

DelayTicks::DelayTicks(const std::string& name,
                       const BT::NodeConfiguration& config)
  : BT::DecoratorNode(name, config),
    tick_counter_(0)
{
  if (!getInput<int>("ticks", ticks_required_))
  {
    throw BT::RuntimeError("Missing required input [ticks]");
  }
}

BT::PortsList DelayTicks::providedPorts()
{
  return { BT::InputPort<int>("ticks") };
}

BT::NodeStatus DelayTicks::tick()
{
    if (tick_counter_ < ticks_required_)
    {
        tick_counter_++;
        return BT::NodeStatus::SUCCESS;
    }

    auto child_state = child_node_->executeTick();

    if (child_state == BT::NodeStatus::SUCCESS ||
        child_state == BT::NodeStatus::FAILURE)
    {
        tick_counter_ = 0;   // reset delay cycle
    }

    return child_state;
}

void DelayTicks::halt()
{
  DecoratorNode::halt();
}