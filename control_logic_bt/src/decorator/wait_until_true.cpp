#include "control_logic_bt/decorator/wait_until_true.hpp"
#include <rclcpp/rclcpp.hpp>

WaitUntilTrue::WaitUntilTrue(const std::string& name, const BT::NodeConfiguration& config)
  : BT::DecoratorNode(name, config)
  , timeout_ms_(0)
  , check_interval_ms_(100)
  , has_timeout_(false)
  , timer_started_(false)
  , halted_(false)
{
  // Use a shared node from the blackboard instead of creating a new one
  if (!config.blackboard->get("node", node_))
  {
    // Fallback: create node only if not provided (for backward compatibility)
    node_ = rclcpp::Node::make_shared("wait_until_true_bt_node");
  }
}

WaitUntilTrue::~WaitUntilTrue()
{
  halt();
}

void WaitUntilTrue::halt()
{
  halted_ = true;
  if (child_node_)
  {
    child_node_->halt();
  }
  BT::DecoratorNode::halt();
}

void WaitUntilTrue::reset()
{
  timer_started_ = false;
  has_timeout_ = false;
  halted_ = false;
}

bool WaitUntilTrue::isTimeoutReached() const
{
  if (!has_timeout_ || !timer_started_)
    return false;
    
  auto current_time = std::chrono::steady_clock::now();
  auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(current_time - start_time_).count();
  
  return elapsed_ms >= timeout_ms_;
}

BT::NodeStatus WaitUntilTrue::tick()
{
  // Reset halt flag at start of new tick
  if (halted_)
  {
    reset();
  }
  
  // Check if we have a child
  if (child_node_ == nullptr)
  {
    RCLCPP_ERROR(node_->get_logger(), "[%s] No child node provided", name().c_str());
    return BT::NodeStatus::FAILURE;
  }

  // Initialize timeout on first tick
  if (!timer_started_)
  {
    // Read timeout parameter
    auto timeout_result = getInput<int>("timeout_ms", timeout_ms_);
    has_timeout_ = timeout_result.has_value();
    
    // Read check interval parameter
    auto interval_result = getInput<int>("check_interval_ms", check_interval_ms_);
    if (interval_result.has_value() && check_interval_ms_ <= 0)
    {
      check_interval_ms_ = 100; // Default if invalid
    }
    
    if (has_timeout_)
    {
      start_time_ = std::chrono::steady_clock::now();
      timer_started_ = true;
      RCLCPP_INFO(node_->get_logger(), "[%s] Starting timeout timer: %d ms", name().c_str(), timeout_ms_);
    }
    
    RCLCPP_DEBUG(node_->get_logger(), "[%s] Check interval: %d ms", name().c_str(), check_interval_ms_);
  }

  // Check timeout before ticking child
  if (isTimeoutReached())
  {
    RCLCPP_WARN(node_->get_logger(), "[%s] Timeout reached after %d ms", name().c_str(), timeout_ms_);
    reset();
    return BT::NodeStatus::FAILURE;
  }

  // Tick the child node
  BT::NodeStatus child_status = child_node_->executeTick();

  // Handle different child statuses
  switch (child_status)
  {
    case BT::NodeStatus::SUCCESS:
      RCLCPP_INFO(node_->get_logger(), "[%s] Condition met successfully", name().c_str());
      reset();
      return BT::NodeStatus::SUCCESS;
      
    case BT::NodeStatus::FAILURE:
      // Condition not met yet, continue waiting
      RCLCPP_DEBUG(node_->get_logger(), "[%s] Condition not met, waiting... (timeout: %s)", 
                   name().c_str(), 
                   has_timeout_ ? std::to_string(timeout_ms_).c_str() : "none");
      // Return RUNNING to keep waiting
      return BT::NodeStatus::RUNNING;
      
    case BT::NodeStatus::RUNNING:
      // Child is still running its own async operation
      RCLCPP_DEBUG(node_->get_logger(), "[%s] Child still running, waiting...", name().c_str());
      return BT::NodeStatus::RUNNING;
      
    default:
      RCLCPP_ERROR(node_->get_logger(), "[%s] Unexpected child status: %d", name().c_str(), static_cast<int>(child_status));
      reset();
      return BT::NodeStatus::FAILURE;
  }
}