// blend_executor.hpp
//
// BlendExecutor - a BehaviorTree.CPP v3 StatefulActionNode that executes a
// PRE-COMPUTED blended LIN/PTP path from blend_cache.yaml. No binary search at
// runtime: the search was done offline (UI -> blend_cache.yaml), so production
// pays ZERO search cost. The node just loads the named path and sends it once.
//
// BT XML:
//   <BlendExecutor path_name="pickup_sequence"/>
//
// Port:
//   path_name (input, std::string) : key in blend_cache.yaml to execute.
//
// Behaviour:
//   onStart()   - load cache entry for path_name, VERIFY its points still match
//                 points.yaml (joints), then async-send the sequence goal.
//   onRunning() - non-blocking poll of a done-flag; returns SUCCESS/FAILURE/RUNNING.
//   onHalted()  - best-effort cancel of the in-flight goal.
//
// SAFETY: if the cached path's points no longer exist (or joints changed) in
// points.yaml, the node FAILS loudly instead of running a stale plan. This is a
// fast check (no planning) so production stays fast.
//
// Async pattern matches BlendMotion: a shared static node + MultiThreadedExecutor
// on its own thread; the BT tree is never blocked.

#ifndef CONTROL_LOGIC_BT__BLEND_EXECUTOR_HPP_
#define CONTROL_LOGIC_BT__BLEND_EXECUTOR_HPP_

#include <atomic>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include <behaviortree_cpp_v3/action_node.h>

#include <rclcpp/rclcpp.hpp>
#include <rclcpp_action/rclcpp_action.hpp>

#include <moveit_msgs/action/move_group_sequence.hpp>
#include <moveit_msgs/msg/constraints.hpp>

namespace control_logic_bt
{

// One cached motion item, already at final values (no scaling at runtime).
struct CachedItem
{
  std::string name;
  std::string type;            // "PTP" or "LIN"
  double radius_cm = 0.0;
  double vel = 0.1;
  double acc = 0.1;
  std::vector<double> joints;  // filled from points.yaml at load time
};

class BlendExecutor : public BT::StatefulActionNode
{
public:
  using MoveGroupSequence = moveit_msgs::action::MoveGroupSequence;
  using GoalHandleSeq = rclcpp_action::ClientGoalHandle<MoveGroupSequence>;

  BlendExecutor(const std::string & name, const BT::NodeConfiguration & cfg);

  // Declares the path_name input port.
  static BT::PortsList providedPorts();

  // BT StatefulActionNode lifecycle.
  BT::NodeStatus onStart() override;
  BT::NodeStatus onRunning() override;
  void onHalted() override;

private:
  // Load the named path from the cache and validate against points.yaml.
  // Fills items_ on success; sets `reason` and returns false on any problem.
  bool loadPath(const std::string & path_name, std::string & reason);

  // Build a joint-goal constraint for one point.
  moveit_msgs::msg::Constraints makeJointGoal(const std::vector<double> & vals);

  // Build the full MoveGroupSequence goal from items_ (real execution).
  MoveGroupSequence::Goal buildGoal();

  // Per-instance execution state.
  std::vector<CachedItem> items_;
  std::atomic<bool> done_{false};
  std::atomic<bool> succeeded_{false};

  // Shared across ALL instances (one node/client/executor for the whole tree).
  static rclcpp::Node::SharedPtr s_node_;
  static rclcpp_action::Client<MoveGroupSequence>::SharedPtr s_client_;
  static rclcpp::executors::MultiThreadedExecutor::SharedPtr s_exec_;
  static std::thread s_spin_;
};

}  // namespace control_logic_bt

#endif  // CONTROL_LOGIC_BT__BLEND_EXECUTOR_HPP_