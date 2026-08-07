#include <rclcpp/rclcpp.hpp>

#include <trajectory_msgs/msg/joint_trajectory.hpp>
#include <std_msgs/msg/string.hpp>
#include <nextup_joint_interfaces/msg/nextup_digital_inputs.hpp>
#include <nextup_joint_interfaces/msg/nextup_emergency_trigger.hpp>

#include <vector>
#include <string>
#include <cmath>
#include <thread>
#include <chrono>
#include <memory>

class di5NanBurstGuard : public rclcpp::Node
{
public:
  di5NanBurstGuard()
  : Node("di5_nan_burst_guard")
  {
    pub_traj_ = create_publisher<trajectory_msgs::msg::JointTrajectory>(
      "/robot_manipulator_controller/joint_trajectory", 10);

    pub_exec_event_ = create_publisher<std_msgs::msg::String>(
      "/trajectory_execution_event", 10);

    pub_emergency_ = create_publisher<nextup_joint_interfaces::msg::NextupEmergencyTrigger>(
      "/nextup_emergency_trigger_controller/commands", 10);

    sub_di_ = create_subscription<nextup_joint_interfaces::msg::NextupDigitalInputs>(
      "/nextup_digital_inputs", 10,
      std::bind(&di5NanBurstGuard::on_di, this, std::placeholders::_1));

    RCLCPP_WARN(get_logger(), "==============================================");
    RCLCPP_WARN(get_logger(), " di5 NaN BURST GUARD STARTED (6 JOINT FIXED) ");
    RCLCPP_WARN(get_logger(), "==============================================");
  }

private:
  // ---------- CONSTANTS ----------
  static constexpr int JOINT_COUNT = 6;
  static constexpr int NAN_BURST_COUNT = 4;
  static constexpr int STOP_PUB_COUNT = 2;

  const std::vector<std::string> joint_names_ = {
    "joint1", "joint2", "joint3",
    "joint4", "joint5", "joint6"
  };

  // ---------- STATE ----------
  bool di5_latched_ = false;
  int  nan_count_   = 0;

  // ---------- ROS ----------
  rclcpp::Publisher<trajectory_msgs::msg::JointTrajectory>::SharedPtr pub_traj_;
  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr pub_exec_event_;
  rclcpp::Publisher<nextup_joint_interfaces::msg::NextupEmergencyTrigger>::SharedPtr pub_emergency_;
  rclcpp::Subscription<nextup_joint_interfaces::msg::NextupDigitalInputs>::SharedPtr sub_di_;

  // ---------- CALLBACK ----------
  void on_di(const nextup_joint_interfaces::msg::NextupDigitalInputs::SharedPtr msg)
  {
    if (static_cast<int>(msg->di5.size()) < JOINT_COUNT)
    {
      RCLCPP_ERROR_THROTTLE(
        get_logger(), *get_clock(), 2000,
        "di5 array size < %d, ignoring message", JOINT_COUNT);
      return;
    }

    bool di5_true = false;
    for (int i = 0; i < JOINT_COUNT; ++i)
    {
      if (msg->di5[i])
      {
        di5_true = true;
        break;
      }
    }

    // ---------- RISING EDGE ----------
    if (di5_true && !di5_latched_)
    {
      if (nan_count_ < NAN_BURST_COUNT)
      {
        publish_stop_burst();   // STOP x5 BEFORE NaN
        publish_nan();
        nan_count_++;

        RCLCPP_ERROR(get_logger(),
          "di5 TRUE -> STOP x%d + NaN PUBLISHED (%d/%d)",
          STOP_PUB_COUNT, nan_count_, NAN_BURST_COUNT);

        publish_nan();
      }

      if (nan_count_ >= NAN_BURST_COUNT)
      {
        di5_latched_ = true;
        RCLCPP_WARN(get_logger(), "NaN BURST COMPLETE -> waiting for di5 to clear");
      }
    }

    // ---------- RE-ARM ----------
    if (!di5_true && di5_latched_)
    {
      di5_latched_ = false;
      nan_count_   = 0;
      RCLCPP_WARN(get_logger(), "di5 CLEARED -> guard re-armed");
    }
  }

  // ---------- STOP BURST ----------
  void publish_stop_burst()
  {
    std_msgs::msg::String s;
    s.data = "stop";

    for (int i = 0; i < STOP_PUB_COUNT; ++i)
    {
      pub_exec_event_->publish(s);
      RCLCPP_WARN(get_logger(),
        "trajectory_execution_event -> 'stop' (%d/%d)", i + 1, STOP_PUB_COUNT);
      std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
  }

  // ---------- NaN TRAJECTORY ----------
  void publish_nan()
  {
    trajectory_msgs::msg::JointTrajectory traj;
    traj.header.stamp = now();
    traj.joint_names = joint_names_;

    trajectory_msgs::msg::JointTrajectoryPoint p;
    p.positions.resize(JOINT_COUNT, std::nan(""));
    p.time_from_start.sec = 1;
    p.time_from_start.nanosec = 0;

    traj.points.clear();
    traj.points.push_back(p);

    pub_traj_->publish(traj);

    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    nextup_joint_interfaces::msg::NextupEmergencyTrigger e;
    e.emergencytrigger = true;
    pub_emergency_->publish(e);
  }
};

int main(int argc, char **argv)
{
  rclcpp::init(argc, argv);
  rclcpp::spin(std::make_shared<di5NanBurstGuard>());
  rclcpp::shutdown();
  return 0;
}