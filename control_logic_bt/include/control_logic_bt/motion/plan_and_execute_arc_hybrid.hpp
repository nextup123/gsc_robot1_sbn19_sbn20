#pragma once

/* ========================================================= */
/* ===================== INCLUDES ========================== */
/* ========================================================= */

#include <behaviortree_cpp_v3/action_node.h>

#include <rclcpp/rclcpp.hpp>
#include <moveit/move_group_interface/move_group_interface.h>

#include <moveit_msgs/msg/robot_trajectory.hpp>

#include <yaml-cpp/yaml.h>
#include <Eigen/Geometry>

#include <unordered_map>
#include <vector>
#include <string>
#include <memory>

/* ========================================================= */
/* ============ PLAN AND EXECUTE ARC HYBRID ================= */
/* ========================================================= */
/*
 * INDUSTRIAL-GRADE BT NODE
 *
 * - Curved Cartesian motion through multiple joint targets
 * - Motion logic unchanged
 * - Hardened for long-running (24x7) systems
 * - Safe YAML reload
 * - Safe MoveIt access
 * - No DDS participant leaks
 *
 * NOTE:
 *  - Executed trajectory and trajectory-name publishing
 *    are implemented internally in the .cpp file.
 *  - No public interface or BT port changes are required.
 */

class PlanAndExecuteArcHybrid : public BT::SyncActionNode
{
public:
  /* ------------------------------------------------------- */
  /* ------------------- CONSTRUCTOR ----------------------- */
  /* ------------------------------------------------------- */

  PlanAndExecuteArcHybrid(
    const std::string& name,
    const BT::NodeConfiguration& config);

  /* ------------------------------------------------------- */
  /* -------------------- BT PORTS ------------------------- */
  /* ------------------------------------------------------- */

  static BT::PortsList providedPorts();

  /* ------------------------------------------------------- */
  /* ---------------------- TICK --------------------------- */
  /* ------------------------------------------------------- */

  BT::NodeStatus tick() override;

private:
  /* ======================================================= */
  /* =================== CORE HELPERS ====================== */
  /* ======================================================= */

  /**
   * @brief Compute and plan a curved Cartesian path through
   *        multiple joint targets (LOGIC UNCHANGED)
   */
  bool executeCurvedCartesianMultiJointTargets(
    const std::vector<std::vector<double>>& joints_list,
    double speed,
    moveit::planning_interface::MoveGroupInterface::Plan& plan);

  /**
   * @brief Apply oscillation on joint-6
   *        (LOGIC UNCHANGED)
   */
  void applyJoint6Oscillation(
    moveit_msgs::msg::RobotTrajectory& traj,
    double cw_deg,
    double ccw_deg,
    double freq_hz);

  /**
   * @brief Load joint targets from YAML file
   *        (Hardened, schema unchanged)
   */
  bool loadJointTargetsFromYaml(const std::string& path);

private:
  /* ======================================================= */
  /* =================== ROS / MOVEIT ====================== */
  /* ======================================================= */

  std::shared_ptr<rclcpp::Node> node_;

  std::shared_ptr<
    moveit::planning_interface::MoveGroupInterface> move_group_;

  /* ======================================================= */
  /* ==================== DATA ============================= */
  /* ======================================================= */

  /**
   * Map:
   *   pose_name -> joint vector (6 DOF)
   */
  std::unordered_map<
    std::string,
    std::vector<double>> joint_targets_;
};