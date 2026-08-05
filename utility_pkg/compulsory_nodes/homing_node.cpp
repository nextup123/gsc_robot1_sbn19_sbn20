// homing_moveit_only_node.cpp
#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/string.hpp>
#include <std_msgs/msg/bool.hpp>
#include <std_msgs/msg/float64_multi_array.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <moveit/move_group_interface/move_group_interface.h>
#include <mutex>
#include <thread>
#include <memory>
#include <cmath>
#include <iomanip>
#include <sstream>
#include <vector>

using String = std_msgs::msg::String;
using JointState = sensor_msgs::msg::JointState;

class RobotHomingMoveItOnly : public rclcpp::Node
{
public:
    RobotHomingMoveItOnly() : Node("robot_homing_moveit_only")
    {
        popup_pub_ = this->create_publisher<String>("/bt_toast_popup", 10);
        log_pub_ = this->create_publisher<String>("/logs_topic", 10);
        safety_left_pub_ = this->create_publisher<std_msgs::msg::Bool>("/safety_on_left", 10);
        safety_right_pub_ = this->create_publisher<std_msgs::msg::Bool>("/safety_on_right", 10);

        joint_state_sub_ = this->create_subscription<JointState>(
            "/joint_states", 200,
            [this](const JointState::SharedPtr msg)
            {
                std::lock_guard<std::mutex> lock(js_mutex_);
                last_js_ = *msg;
                js_version_++;
            });

        command_sub_ = this->create_subscription<String>(
            "/ui_commands", 10,
            std::bind(&RobotHomingMoveItOnly::ui_callback, this, std::placeholders::_1));

        timer_ = this->create_wall_timer(
            std::chrono::milliseconds(100),
            std::bind(&RobotHomingMoveItOnly::initialize_move_group, this));

        publish_log("RobotHoming (MoveIt-only) node initialized");
    }

private:
    // publishers/subscribers
    rclcpp::Publisher<String>::SharedPtr popup_pub_;
    rclcpp::Publisher<String>::SharedPtr log_pub_;
    rclcpp::Publisher<std_msgs::msg::Bool>::SharedPtr safety_left_pub_;
    rclcpp::Publisher<std_msgs::msg::Bool>::SharedPtr safety_right_pub_;
    rclcpp::Subscription<JointState>::SharedPtr joint_state_sub_;
    rclcpp::Subscription<String>::SharedPtr command_sub_;

    // joint state
    JointState last_js_;
    std::mutex js_mutex_;
    int js_version_ = 0;

    // moveit interface
    std::unique_ptr<moveit::planning_interface::MoveGroupInterface> move_group_;
    rclcpp::TimerBase::SharedPtr timer_;

    // ----- NEW FLAG -----
    bool homing_running_ = false;

    // params
    const double tol_ = 0.001;
    const int wait_updates_ = 10;
    const int wait_timeout_ms_ = 5000;

    // ---------------- helpers ----------------
    JointState get_js()
    {
        std::lock_guard<std::mutex> lock(js_mutex_);
        return last_js_;
    }

    void publish_popup(const std::string &txt)
    {
        String s; s.data = txt;
        popup_pub_->publish(s);
        RCLCPP_INFO(this->get_logger(), "%s", txt.c_str());
    }

    void publish_log(const std::string &txt)
    {
        String s; s.data = txt;
        log_pub_->publish(s);
        RCLCPP_INFO(this->get_logger(), "%s", txt.c_str());
    }

    bool is_within_tol(double a, double b, double tol)
    {
        return std::fabs(a - b) <= tol;
    }

    bool wait_for_js_updates(int count, int timeout_ms)
    {
        int start_version;
        {
            std::lock_guard<std::mutex> lock(js_mutex_);
            start_version = js_version_;
        }

        int target = start_version + count;
        int waited = 0;
        rclcpp::Rate r(100);

        publish_log("Waiting for " + std::to_string(count) + " new joint_state updates...");

        while (rclcpp::ok())
        {
            {
                std::lock_guard<std::mutex> lock(js_mutex_);
                if (js_version_ >= target) return true;
            }

            if (waited >= timeout_ms) break;

            r.sleep();
            waited += 10;
        }

        publish_log("Timeout waiting for joint_state updates.");
        return false;
    }

    void log_joint_vector(const std::string &label, const std::vector<double> &v)
    {
        std::ostringstream ss;
        ss << label << " [";
        for (size_t i=0;i<v.size();++i)
        {
            ss << std::fixed << std::setprecision(5) << v[i];
            if (i+1<v.size()) ss << ", ";
        }
        ss << "]";
        publish_log(ss.str());
    }

    void initialize_move_group()
    {
        if (!move_group_)
        {
            try
            {
                auto node_ptr = this->shared_from_this();
                move_group_ = std::make_unique<moveit::planning_interface::MoveGroupInterface>(node_ptr, "robot_manipulator");
                move_group_->setMaxVelocityScalingFactor(0.1);
                move_group_->setMaxAccelerationScalingFactor(0.05);
                publish_log("MoveGroupInterface initialized for group 'robot_manipulator'");
                timer_->cancel();
            }
            catch (const std::exception &e)
            {
                RCLCPP_ERROR(this->get_logger(), "MoveGroup init failed: %s", e.what());
            }
        }
    }

    bool plan_and_exec(const std::vector<double> &target, const std::string &desc)
    {
        if (!move_group_)
        {
            publish_log("MoveGroup not ready for " + desc);
            return false;
        }

        move_group_->setJointValueTarget(target);

        publish_log("Planning " + desc);
        moveit::planning_interface::MoveGroupInterface::Plan plan;

        if (move_group_->plan(plan) != moveit::core::MoveItErrorCode::SUCCESS)
        {
            publish_log("Planning FAILED for " + desc);
            return false;
        }

        publish_log("Executing " + desc);
        auto exec_res = move_group_->execute(plan);

        bool ok = (exec_res == moveit::core::MoveItErrorCode::SUCCESS);
        publish_log(std::string("Execute ") + (ok ? "SUCCESS" : "FAILED") + " for " + desc);

        return ok;
    }

    bool compare_indices_and_log(const JointState &live_js,
                                 const std::vector<int> &indices,
                                 const std::vector<double> &target_vals)
    {
        std::vector<double> live_vals;
        live_vals.reserve(indices.size());

        for (int idx : indices)
        {
            if ((size_t)idx < live_js.position.size())
                live_vals.push_back(live_js.position[idx]);
            else
                live_vals.push_back(0.0);
        }

        log_joint_vector("Target subset", target_vals);
        log_joint_vector("Live subset", live_vals);

        bool all_ok = true;

        for (size_t i=0;i<indices.size();++i)
        {
            double diff = std::fabs(live_vals[i] - target_vals[i]);
            publish_log("Joint(index " + std::to_string(indices[i]) + ") Diff = " + std::to_string(diff));

            if (diff > tol_) all_ok = false;
        }

        publish_log(all_ok ? "✅ subset MATCHED" : "❌ subset NOT MATCHED");
        return all_ok;
    }

    // ---------------- UI callback ----------------
    void ui_callback(const String::SharedPtr msg)
    {
        if (msg->data == "home")
        {
            // ---------- NEW LOGIC ----------
            if (homing_running_)
            {
                publish_log("⚠️ Homing already running — ignoring new request");
                publish_popup("homing is in progress,warn,5");

                return;
            }

            homing_running_ = true;
            publish_log("Received 'home' command. Starting MoveIt homing thread...");
            std::thread(&RobotHomingMoveItOnly::perform_homing_sequence, this).detach();
        }
    }

    // ---------------- Homing sequence ----------------
    void perform_homing_sequence()
    {
        publish_log("Starting homing sequence...");

        JointState js = get_js();

        if (js.position.size() < 6)
        {
            publish_log("Invalid joint state length");
            finish_homing(false);
            return;
        }

        // If already at home
        bool all_zero = true;
        for (int i=0;i<6;i++)
            if (!is_within_tol(js.position[i], 0.0, tol_)) all_zero = false;

        if (all_zero)
        {
            finish_homing(true);
            return;
        }

        // ---------- STEP A: Move joints 2–6 to zero ----------
        {
            std::vector<double> target(6, 0.0);
            target[0] = js.position[0]; // keep joint1

            log_joint_vector("STEP-A target", target);

            if (!plan_and_exec(target, "move joints 2-6 to zero"))
            {
                finish_homing(false);
                return;
            }

            if (!wait_for_js_updates(wait_updates_, wait_timeout_ms_))
            {
                finish_homing(false);
                return;
            }

            JointState afterA = get_js();
            std::vector<int> idx = {1,2,3,4,5};
            std::vector<double> tgt = {0,0,0,0,0};

            if (!compare_indices_and_log(afterA, idx, tgt))
            {
                finish_homing(false);
                return;
            }

            publish_log("STEP A OK");
        }

        // Refresh
        js = get_js();

        // ---------- STEP B: Move joint1 to zero ----------
        if (!is_within_tol(js.position[0], 0.0, tol_))
        {
            std::vector<double> target(6, 0.0);
            for (size_t i=1;i<6;i++) target[i] = js.position[i];

            log_joint_vector("STEP-B target", target);

            if (!plan_and_exec(target, "move joint1 to zero"))
            {
                finish_homing(false);
                return;
            }

            if (!wait_for_js_updates(wait_updates_, wait_timeout_ms_))
            {
                finish_homing(false);
                return;
            }

            JointState afterB = get_js();
            std::vector<int> idx = {0};
            std::vector<double> tgt = {0.0};

            if (!compare_indices_and_log(afterB, idx, tgt))
            {
                finish_homing(false);
                return;
            }

            publish_log("STEP B OK");
        }
        else
        {
            publish_log("STEP B skipped (joint1 already zero)");
        }

        finish_homing(true);
    }

    // ---------------- END homing ----------------
    void finish_homing(bool success)
    {
        publish_popup(success ? "homing done,success,10" : "homing failed,failure,0");
        homing_running_ = false;   // <<< RELEASE FLAG
        std_msgs::msg::Bool t;
        t.data = false;
        safety_left_pub_->publish(t);
        safety_right_pub_->publish(t);
    }
};

int main(int argc, char **argv)
{
    rclcpp::init(argc, argv);
    auto node = std::make_shared<RobotHomingMoveItOnly>();
    rclcpp::spin(node);
    rclcpp::shutdown();
    return 0;
}
