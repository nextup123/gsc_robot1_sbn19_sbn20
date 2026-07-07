#pragma once

#include "behaviortree_cpp_v3/control_node.h"
#include "rclcpp/rclcpp.hpp"
#include "std_msgs/msg/bool.hpp"
#include "std_msgs/msg/string.hpp"
#include <atomic>
#include <mutex>
#include <thread>

class AlternatingSelector : public BT::ControlNode
{
public:
  AlternatingSelector(const std::string &name, const BT::NodeConfiguration &config)
      : BT::ControlNode(name, config),
        cycle_count_(0),
        operation_mode_(OperationMode::BOTH)
  {
    static std::once_flag once_flag;
    std::call_once(once_flag, []()
                   {
      node_ = rclcpp::Node::make_shared("alternating_selector_node");

      // Declare parameter with descriptor
      rcl_interfaces::msg::ParameterDescriptor mode_desc;
      mode_desc.description = "Operation mode: 'cnc1', 'cnc2', or 'both'";
      mode_desc.additional_constraints = "Allowed values: cnc1, cnc2, both";
      node_->declare_parameter("operation_mode", "both", mode_desc);

      // Parameter callback for validation
      param_callback_ = node_->add_on_set_parameters_callback(
        [](const std::vector<rclcpp::Parameter>& params) {
          auto result = rcl_interfaces::msg::SetParametersResult();
          result.successful = true;
          for (const auto& param : params) {
            if (param.get_name() == "operation_mode") {
              const std::string& mode = param.as_string();
              if (mode != "cnc1" && mode != "cnc2" && mode != "both") {
                result.successful = false;
                result.reason = "Invalid mode. Must be 'cnc1', 'cnc2', or 'both'";
                RCLCPP_WARN(node_->get_logger(), "%s", result.reason.c_str());
              }
            }
          }
          return result;
        });

      // Reset subscription
      reset_sub_ = node_->create_subscription<std_msgs::msg::Bool>(
        "/reset_bt", 10,
        [](const std_msgs::msg::Bool::SharedPtr msg) {
          if (msg->data) {
            reset_requested_ = true;
          }
        });

      // CNC selection publisher and subscriber
      cnc_select_pub_ = node_->create_publisher<std_msgs::msg::String>("/select_cnc", 10);
      cnc_select_sub_ = node_->create_subscription<std_msgs::msg::String>(
        "/select_cnc", 10,
        [](const std_msgs::msg::String::SharedPtr msg) {
          const std::string& mode = msg->data;
          if (mode == "cnc1" || mode == "cnc2" || mode == "both") {
            // Update the parameter
            node_->set_parameter(rclcpp::Parameter("operation_mode", mode));
            
            // Publish acknowledgment
            auto ack_msg = std_msgs::msg::String();
            ack_msg.data = "received:" + mode;
            cnc_select_pub_->publish(ack_msg);
          }
          // } else {
          //   RCLCPP_WARN(node_->get_logger(), "Invalid mode received on /select_cnc: '%s'", mode.c_str());
            
          //   // Publish error acknowledgment
          //   auto ack_msg = std_msgs::msg::String();
          //   ack_msg.data = "error:invalid_mode";
          //   cnc_select_pub_->publish(ack_msg);
          // }
        });

      // Start ROS spinning thread
      spin_thread_ = std::thread([]() {
        rclcpp::executors::SingleThreadedExecutor exec;
        exec.add_node(node_);
        exec.spin();
      }); });
  }

  static BT::PortsList providedPorts()
  {
    return {BT::InputPort<std::string>("mode", "Operation mode: 'cnc1', 'cnc2', or 'both'")};
  }

  BT::NodeStatus tick() override
  {
    if (childrenCount() != 2)
    {
      throw BT::LogicError("AlternatingSelector needs exactly 2 children");
    }

    if (reset_requested_)
    {
      cycle_count_ = 0;
      reset_requested_ = false;
      running_child_valid_ = false;
      haltChildren();
    }

    // Resolve the mode. NOTE: an empty XML port (mode="") still counts as
    // "provided" in BT.CPP, so getInput() would succeed with "" and shadow
    // the live parameter set via /select_cnc. We therefore only honor the
    // port when it is non-empty; otherwise we read the 'operation_mode'
    // parameter (updated by the /select_cnc subscription).
    std::string mode_str;
    if (!getInput("mode", mode_str) || mode_str.empty())
    {
      mode_str = node_->get_parameter("operation_mode").as_string();
    }
    config().blackboard->set("mode", mode_str);

    if (mode_str == "cnc1")
    {
      operation_mode_ = OperationMode::CNC1_ONLY;
    }
    else if (mode_str == "cnc2")
    {
      operation_mode_ = OperationMode::CNC2_ONLY;
    }
    else if (mode_str == "both")
    {
      operation_mode_ = OperationMode::BOTH;
    }
    else
    {
      RCLCPP_WARN_THROTTLE(node_->get_logger(), *node_->get_clock(), 5000,
                           "[AlternatingSelector] Unknown mode '%s'; keeping current",
                           mode_str.c_str());
    }


    setStatus(BT::NodeStatus::RUNNING);

    // Decide which child to run. IMPORTANT: only pick a NEW child when we
    // are not already in the middle of running one. Otherwise cycle_count_
    // would advance every tick (100 Hz) and we'd thrash between children,
    // halting each mid-motion and never completing either branch.
    size_t selected_child = 0;
    switch (operation_mode_)
    {
    case OperationMode::CNC1_ONLY:
      selected_child = 0;
      break;
    case OperationMode::CNC2_ONLY:
      selected_child = 1;
      break;
    case OperationMode::BOTH:
      // If a child is already running, stay on it. Only advance the
      // alternation counter once the previous child has completed.
      selected_child = running_child_valid_
                           ? running_child_
                           : (cycle_count_ % 2);
      break;
    }

    // If the selection changed since last tick (e.g. mode switch), halt
    // the previously-running branch so it isn't left dangling.
    if (running_child_valid_ && running_child_ != selected_child)
    {
      haltChild(running_child_);
      running_child_valid_ = false;
    }
    haltChild(1 - selected_child);

    BT::TreeNode *child = children_nodes_[selected_child];
    BT::NodeStatus status = child->executeTick();

    if (status == BT::NodeStatus::RUNNING)
    {
      // Latch this child until it finishes.
      running_child_ = selected_child;
      running_child_valid_ = true;
    }
    else
    {
      // Child finished (SUCCESS/FAILURE). Clean up and, in BOTH mode,
      // advance to the other child for the next activation.
      haltChild(selected_child);
      running_child_valid_ = false;
      if (operation_mode_ == OperationMode::BOTH)
        ++cycle_count_;
    }

    return status;
  }

  void halt() override
  {
    running_child_valid_ = false;
    for (unsigned i = 0; i < childrenCount(); ++i)
    {
      haltChild(i);
    }
    setStatus(BT::NodeStatus::IDLE);
  }

  ~AlternatingSelector() override = default;

private:
  enum class OperationMode
  {
    CNC1_ONLY,
    CNC2_ONLY,
    BOTH
  };

  size_t cycle_count_;
  OperationMode operation_mode_;

  // Latch: which child is currently RUNNING (so we don't re-pick every tick).
  size_t running_child_{0};
  bool   running_child_valid_{false};

  // Static shared ROS 2 members
  static std::atomic_bool reset_requested_;
  static rclcpp::Node::SharedPtr node_;
  static rclcpp::Subscription<std_msgs::msg::Bool>::SharedPtr reset_sub_;
  static rclcpp::Subscription<std_msgs::msg::String>::SharedPtr cnc_select_sub_;
  static rclcpp::Publisher<std_msgs::msg::String>::SharedPtr cnc_select_pub_;
  static rclcpp::node_interfaces::OnSetParametersCallbackHandle::SharedPtr param_callback_;
  static std::thread spin_thread_;
};

// Static member initialization
std::atomic_bool AlternatingSelector::reset_requested_ = false;
rclcpp::Node::SharedPtr AlternatingSelector::node_ = nullptr;
rclcpp::Subscription<std_msgs::msg::Bool>::SharedPtr AlternatingSelector::reset_sub_ = nullptr;
rclcpp::Subscription<std_msgs::msg::String>::SharedPtr AlternatingSelector::cnc_select_sub_ = nullptr;
rclcpp::Publisher<std_msgs::msg::String>::SharedPtr AlternatingSelector::cnc_select_pub_ = nullptr;
rclcpp::node_interfaces::OnSetParametersCallbackHandle::SharedPtr AlternatingSelector::param_callback_ = nullptr;
std::thread AlternatingSelector::spin_thread_;