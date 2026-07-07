#include <rclcpp/rclcpp.hpp>
#include <rclcpp/executors/multi_threaded_executor.hpp>
#include <nextup_joint_interfaces/msg/nextup_driver_status.hpp>
#include <nextup_joint_interfaces/msg/nextup_emergency_trigger.hpp>
#include <nextup_joint_interfaces/msg/nextup_reset_fault.hpp>
#include <std_msgs/msg/bool.hpp>
#include <std_msgs/msg/string.hpp>
#include <std_msgs/msg/int8.hpp>
#include <std_msgs/msg/float64_multi_array.hpp>
#include <geometry_msgs/msg/twist_stamped.hpp>
#include <trajectory_msgs/msg/joint_trajectory.hpp>
#include <trajectory_msgs/msg/joint_trajectory_point.hpp>
#include <control_msgs/msg/joint_trajectory_controller_state.hpp>
#include <nextup_joint_interfaces/msg/nextup_joint_state.hpp>
#include <thread>
#include <chrono>
#include <cmath>
#include <unordered_map>
#include <atomic>
#include <cstdint>
#include <std_srvs/srv/trigger.hpp>
#include <limits>

using namespace std::chrono_literals;

class ModeChangeNode : public rclcpp::Node
{
public:
    ModeChangeNode() : Node("mode_change_node")
    {
        joint_names_ = {"joint1", "joint2", "joint3", "joint4", "joint5", "joint6"};

        /* ============================================================
         * Publishers
         * ============================================================ */
        traj_pub_ = create_publisher<trajectory_msgs::msg::JointTrajectory>(
            "/robot_manipulator_controller/joint_trajectory", 10);
        mode_pub_ = create_publisher<std_msgs::msg::Float64MultiArray>(
            "/modeofoperation_command_controller/commands", 10);
        twist_pub_ = create_publisher<geometry_msgs::msg::TwistStamped>(
            "/servo_node/delta_twist_cmds", 10);
        toast_pub_ = create_publisher<std_msgs::msg::String>(
            "/bt_toast_popup", 10);
        emergency_pub_ = create_publisher<nextup_joint_interfaces::msg::NextupEmergencyTrigger>(
            "/nextup_emergency_trigger_controller/commands", 10);
        reset_fault_pub_ = create_publisher<nextup_joint_interfaces::msg::NextupResetFault>(
            "/nextup_reset_fault_controller/commands", 10);

        /* ============================================================
         * Subscribers
         * ============================================================ */
        mode_sub_ = create_subscription<std_msgs::msg::String>(
            "/change_mode", 10,
            std::bind(&ModeChangeNode::modeCallback, this, std::placeholders::_1));

        controller_state_sub_ = create_subscription<control_msgs::msg::JointTrajectoryControllerState>(
            "/robot_manipulator_controller/controller_state", 10,
            std::bind(&ModeChangeNode::controllerStateCallback, this, std::placeholders::_1));

        servo_status_sub_ = create_subscription<std_msgs::msg::Int8>(
            "/servo_node/status", 10,
            std::bind(&ModeChangeNode::servoStatusCallback, this, std::placeholders::_1));

        // /nextup_joint_states (NextupJointState) is the single source of
        // joint state. It feeds BOTH the mode-feedback wait AND the Mode 8
        // current-position publish. It already connects reliably with depth
        // 10 (proven by the working mode-feedback path), so no QoS change is
        // needed here. Staleness is handled by the timestamp guard below,
        // NOT by QoS.
        joint_state_sub_ = create_subscription<nextup_joint_interfaces::msg::NextupJointState>(
            "/nextup_joint_states", 10,
            std::bind(&ModeChangeNode::jointStateCallback, this, std::placeholders::_1));

        start_servo_client_ = create_client<std_srvs::srv::Trigger>("/servo_node/start_servo");

        driver_status_sub_ = create_subscription<nextup_joint_interfaces::msg::NextupDriverStatus>(
            "/nextup_driver_status", 10,
            std::bind(&ModeChangeNode::driverStatusCallback, this, std::placeholders::_1));

        reset_sub_ = create_subscription<std_msgs::msg::Bool>(
            "/reset_fault", 10,
            std::bind(&ModeChangeNode::resetCallback, this, std::placeholders::_1));

        RCLCPP_INFO(get_logger(), "Mode Change Node Started");
    }

private:
    static constexpr double TIMEOUT_SEC = 5.0;
    static constexpr double REPUBLISH_SEC = 0.5;
    // Max acceptable age of /nextup_joint_states before we refuse to publish it.
    static constexpr double JOINT_STATES_MAX_AGE_SEC = 0.2;

    std::atomic_bool mode_change_running_{false};
    std::vector<std::string> joint_names_;

    control_msgs::msg::JointTrajectoryControllerState::SharedPtr controller_state_;
    std_msgs::msg::Int8::SharedPtr servo_status_;
    nextup_joint_interfaces::msg::NextupJointState::SharedPtr joint_state_;
    nextup_joint_interfaces::msg::NextupDriverStatus::SharedPtr driver_status_;

    // Arrival time of the last /nextup_joint_states message, in nanoseconds.
    // Stored as atomic int64 (lock-free, no trivially-copyable concerns) so
    // the staleness check is safe across the executor threads.
    std::atomic<int64_t> last_joint_state_ns_{0};

    rclcpp::Subscription<nextup_joint_interfaces::msg::NextupDriverStatus>::SharedPtr driver_status_sub_;
    rclcpp::Publisher<trajectory_msgs::msg::JointTrajectory>::SharedPtr traj_pub_;
    rclcpp::Publisher<std_msgs::msg::Float64MultiArray>::SharedPtr mode_pub_;
    rclcpp::Publisher<geometry_msgs::msg::TwistStamped>::SharedPtr twist_pub_;
    rclcpp::Publisher<std_msgs::msg::String>::SharedPtr toast_pub_;
    rclcpp::Subscription<std_msgs::msg::String>::SharedPtr mode_sub_;
    rclcpp::Subscription<std_msgs::msg::Bool>::SharedPtr reset_sub_;
    rclcpp::Subscription<control_msgs::msg::JointTrajectoryControllerState>::SharedPtr controller_state_sub_;
    rclcpp::Subscription<std_msgs::msg::Int8>::SharedPtr servo_status_sub_;
    rclcpp::Subscription<nextup_joint_interfaces::msg::NextupJointState>::SharedPtr joint_state_sub_;
    rclcpp::Client<std_srvs::srv::Trigger>::SharedPtr start_servo_client_;
    rclcpp::Publisher<nextup_joint_interfaces::msg::NextupEmergencyTrigger>::SharedPtr emergency_pub_;
    rclcpp::Publisher<nextup_joint_interfaces::msg::NextupResetFault>::SharedPtr reset_fault_pub_;

    /* ============================================================
     * Callbacks
     * ============================================================ */
    void controllerStateCallback(const control_msgs::msg::JointTrajectoryControllerState::SharedPtr msg)
    {
        controller_state_ = msg;
    }

    void driverStatusCallback(const nextup_joint_interfaces::msg::NextupDriverStatus::SharedPtr msg)
    {
        driver_status_ = msg;
    }

    void servoStatusCallback(const std_msgs::msg::Int8::SharedPtr msg)
    {
        servo_status_ = msg;
    }

    void jointStateCallback(const nextup_joint_interfaces::msg::NextupJointState::SharedPtr msg)
    {
        joint_state_ = msg;
        last_joint_state_ns_.store(now().nanoseconds());
    }

    void releaseEmergency()
    {
        nextup_joint_interfaces::msg::NextupEmergencyTrigger msg;
        msg.emergencytrigger = false;
        emergency_pub_->publish(msg);
    }

    void pulseResetFault()
    {
        nextup_joint_interfaces::msg::NextupResetFault msg;
        msg.resetfault = true;
        reset_fault_pub_->publish(msg);
        rclcpp::sleep_for(200ms);
        msg.resetfault = false;
        reset_fault_pub_->publish(msg);
    }

    void resetCallback(const std_msgs::msg::Bool::SharedPtr msg)
    {
        if (!msg->data) return;
        if (mode_change_running_.exchange(true))
        {
            toast("Operation already running", false);
            return;
        }
        std::thread(&ModeChangeNode::executeReset, this).detach();
    }

    void executeReset()
    {
        auto cleanup = [this]() { mode_change_running_ = false; };
        RCLCPP_INFO(get_logger(), "Starting fault reset");

        if (!waitForNanState())
        {
            toast("NaN trajectory validation failed", false);
            cleanup();
            return;
        }
        toast("NaN trajectory verified", true);

        releaseEmergency();
        toast("Emergency released", true);

        pulseResetFault();

        if (!waitForOperationEnabled())
        {
            toast("Drives failed to reach OPERATION_ENABLED", false);
            cleanup();
            return;
        }
        toast("Operation enabled verified", true);

        executeModeChange(9);
        toast("RESET + MODE VERIFIED", true);
        cleanup();
    }

    bool startServo()
    {
        if (!start_servo_client_->wait_for_service(std::chrono::seconds(2)))
        {
            RCLCPP_ERROR(get_logger(), "Start servo service not available");
            return false;
        }
        auto request = std::make_shared<std_srvs::srv::Trigger::Request>();
        auto future = start_servo_client_->async_send_request(request);
        auto result = future.wait_for(std::chrono::seconds(5));
        if (result != std::future_status::ready)
        {
            RCLCPP_ERROR(get_logger(), "Start servo service timeout");
            return false;
        }
        auto response = future.get();
        RCLCPP_INFO(get_logger(), "Servo response: success=%d message=%s",
                    response->success, response->message.c_str());
        return response->success;
    }

    void modeCallback(const std_msgs::msg::String::SharedPtr msg)
    {
        if (mode_change_running_.exchange(true))
        {
            toast("Mode change already running", false);
            return;
        }
        if (msg->data != "8" && msg->data != "9")
        {
            mode_change_running_ = false;
            toast("Invalid mode request", false);
            return;
        }
        int mode = std::stoi(msg->data);
        std::thread(&ModeChangeNode::executeModeChange, this, mode).detach();
    }

    void toast(const std::string &text, bool success)
    {
        std_msgs::msg::String msg;
        msg.data = success ? text + ",success,10" : text + ",failure,0";
        toast_pub_->publish(msg);
        RCLCPP_WARN(get_logger(), "%s", msg.data.c_str());
    }

    void publishNanTrajectory()
    {
        trajectory_msgs::msg::JointTrajectory traj;
        traj.header.stamp = now();
        traj.joint_names = joint_names_;
        trajectory_msgs::msg::JointTrajectoryPoint p;
        p.positions.assign(joint_names_.size(), std::numeric_limits<double>::quiet_NaN());
        p.time_from_start = rclcpp::Duration::from_seconds(1.0);
        traj.points.push_back(p);
        traj_pub_->publish(traj);
    }

    void publishZeroTwist()
    {
        geometry_msgs::msg::TwistStamped msg;
        msg.header.stamp = now();
        msg.header.frame_id = "end";
        msg.twist.linear.x = 0.0;
        msg.twist.linear.y = 0.0;
        msg.twist.linear.z = 0.0;
        msg.twist.angular.x = 0.0;
        msg.twist.angular.y = 0.0;
        msg.twist.angular.z = 0.0;
        twist_pub_->publish(msg);
    }

    void publishMode(int mode)
    {
        std_msgs::msg::Float64MultiArray msg;
        msg.data.resize(joint_names_.size(), static_cast<double>(mode));
        mode_pub_->publish(msg);
    }

    // ==================== Only for Mode 8 ====================
    bool publishCurrentJointPositions()
    {
        // Guard 1: must have received at least one message.
        if (!joint_state_ || joint_state_->position.empty())
        {
            RCLCPP_ERROR(get_logger(), "No joint states received yet for mode 8");
            return false;
        }

        // Guard 2: the message we are holding must be FRESH. If the publisher
        // stopped, the callback stops firing and joint_state_ keeps pointing
        // at the LAST good message. Refuse to publish anything older than the
        // allowed age (or if we never received anything: last_ns == 0).
        const int64_t last_ns = last_joint_state_ns_.load();
        const double age = static_cast<double>(now().nanoseconds() - last_ns) / 1e9;
        if (last_ns == 0 || age > JOINT_STATES_MAX_AGE_SEC)
        {
            RCLCPP_ERROR(get_logger(),
                "Joint states stale (age=%.3fs > %.3fs), refusing to publish old data",
                age, JOINT_STATES_MAX_AGE_SEC);
            return false;
        }

        trajectory_msgs::msg::JointTrajectory traj;
        traj.header.stamp = now();
        traj.joint_names = joint_names_;

        trajectory_msgs::msg::JointTrajectoryPoint point;
        point.positions.resize(joint_names_.size(), 0.0);

        // /nextup_joint_states is NOT in joint1..joint6 order (it arrives as
        // joint2, joint3, joint1, ...), so map by name, never by index.
        std::unordered_map<std::string, double> pos_map;
        for (size_t i = 0; i < joint_state_->name.size() && i < joint_state_->position.size(); ++i)
        {
            pos_map[joint_state_->name[i]] = joint_state_->position[i];
        }

        bool success = true;
        for (size_t i = 0; i < joint_names_.size(); ++i)
        {
            auto it = pos_map.find(joint_names_[i]);
            if (it != pos_map.end())
            {
                point.positions[i] = it->second;
            }
            else
            {
                RCLCPP_WARN(get_logger(), "Joint %s not found in /nextup_joint_states", joint_names_[i].c_str());
                success = false;
            }
        }

        point.time_from_start = rclcpp::Duration::from_seconds(0.5);
        traj.points.push_back(point);

        traj_pub_->publish(traj);
        RCLCPP_INFO(get_logger(), "Published current joint positions to trajectory controller for mode 8");
        return success;
    }
    // ========================================================

    bool waitForOperationEnabled()
    {
        auto deadline = now() + rclcpp::Duration::from_seconds(TIMEOUT_SEC);
        while (rclcpp::ok() && now() < deadline)
        {
            if (driver_status_ && driver_status_->op_status.size() >= 6 && driver_status_->fault.size() >= 6)
            {
                bool ok = true;
                for (size_t i = 0; i < 6; i++)
                {
                    if (!driver_status_->op_status[i] || driver_status_->fault[i])
                    {
                        ok = false;
                        break;
                    }
                }
                if (ok)
                {
                    RCLCPP_INFO(get_logger(), "All drives OPERATION_ENABLED");
                    return true;
                }
            }
            rclcpp::sleep_for(200ms);
        }
        return false;
    }

    bool waitForNanState()
    {
        auto deadline = now() + rclcpp::Duration::from_seconds(TIMEOUT_SEC);
        publishNanTrajectory();
        auto last_pub = now();
        while (rclcpp::ok() && now() < deadline)
        {
            if (now() - last_pub > rclcpp::Duration::from_seconds(REPUBLISH_SEC))
            {
                publishNanTrajectory();
                last_pub = now();
            }
            if (controller_state_ && controller_state_->reference.positions.size() >= 6 &&
                controller_state_->error.positions.size() >= 6)
            {
                RCLCPP_INFO_THROTTLE(get_logger(), *get_clock(), 1000,
                    "ref0=%f err0=%f",
                    controller_state_->reference.positions[0],
                    controller_state_->error.positions[0]);

                bool all_nan = true;
                for (size_t i = 0; i < 6; ++i)
                {
                    if (!std::isnan(controller_state_->reference.positions[i]) ||
                        !std::isnan(controller_state_->error.positions[i]))
                    {
                        all_nan = false;
                        break;
                    }
                }
                if (all_nan)
                {
                    RCLCPP_INFO(get_logger(), "NaN state verified");
                    return true;
                }
            }
            rclcpp::sleep_for(100ms);
        }
        return false;
    }

    bool waitForServoIdle()
    {
        auto deadline = now() + rclcpp::Duration::from_seconds(TIMEOUT_SEC);
        while (rclcpp::ok() && now() < deadline)
        {
            if (servo_status_ && servo_status_->data == 0)
                return true;
            rclcpp::sleep_for(200ms);
        }
        return false;
    }

    bool waitForModeFeedback(int expected_mode)
    {
        auto deadline = now() + rclcpp::Duration::from_seconds(TIMEOUT_SEC);
        while (rclcpp::ok() && now() < deadline)
        {
            if (joint_state_ && joint_state_->modeofoperation.size() >= 6)
            {
                bool ok = true;
                for (size_t i = 0; i < 6; i++)
                {
                    if (static_cast<int>(joint_state_->modeofoperation[i]) != expected_mode)
                    {
                        ok = false;
                        break;
                    }
                }
                if (ok) return true;
            }
            rclcpp::sleep_for(200ms);
        }
        return false;
    }

    void executeModeChange(int mode)
    {
        auto cleanup = [this]() { mode_change_running_ = false; };

        RCLCPP_INFO(get_logger(), "Starting mode change to %d", mode);

        if (!startServo())
        {
            toast("Failed to start servo", false);
            cleanup();
            return;
        }

        publishZeroTwist();
        rclcpp::sleep_for(200ms);

        if (!waitForServoIdle())
        {
            toast("Servo not idle", false);
            cleanup();
            return;
        }
        toast("Servo idle verified", true);

        rclcpp::sleep_for(200ms);

        if (!waitForNanState())
        {
            toast("NaN trajectory validation failed", false);
            cleanup();
            return;
        }
        toast("NaN trajectory verified", true);

        // ==================== ONLY FOR MODE 8 ====================
        if (mode == 8)
        {
            rclcpp::sleep_for(300ms);  // settle time
            if (!publishCurrentJointPositions())
            {
                toast("Failed to publish current joint positions", false);
                cleanup();
                return;
            }
            rclcpp::sleep_for(500ms);  // give controller time to accept position
        }
        // =========================================================

        publishMode(mode);

        if (!waitForModeFeedback(mode))
        {
            toast("Mode verification failed", false);
            cleanup();
            return;
        }

        toast("MODE VERIFIED FROM FEEDBACK", true);
        cleanup();
    }
};

/* ============================================================
 * Main
 * ============================================================ */
int main(int argc, char **argv)
{
    rclcpp::init(argc, argv);
    auto node = std::make_shared<ModeChangeNode>();
    rclcpp::executors::MultiThreadedExecutor executor(rclcpp::ExecutorOptions(), 2);
    executor.add_node(node);
    executor.spin();
    rclcpp::shutdown();
    return 0;
}