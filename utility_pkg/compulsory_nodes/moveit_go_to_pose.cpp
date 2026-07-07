// ============================================================
//  moveit_go_to_pose_pilz.cpp
//  Pilz Industrial Motion Planner  +  Spline time parameterization
//
//  /joint_motion  TRUE  →  SPLINE PTP
//                           Pilz PTP path (joint space)
//                           + IterativeSplineParameterization
//
//  /cartesian_motion TRUE →  SPLINE LIN
//                           Pilz LIN path (straight Cartesian line)
//                           + IterativeSplineParameterization
//
//  TOPICS:
//    /ui_commands         "get_last_pose@<point>"  → points.yaml
//    /go_to_frame_point   "f1_point1"              → calibration.yaml
// ============================================================

#include <rclcpp/rclcpp.hpp>
#include <yaml-cpp/yaml.h>
#include <std_msgs/msg/string.hpp>
#include <std_msgs/msg/float64_multi_array.hpp>
#include <std_msgs/msg/bool.hpp>
#include <sensor_msgs/msg/joint_state.hpp>

#include <moveit/move_group_interface/move_group_interface.h>
#include <moveit/robot_state/robot_state.h>
#include <moveit/robot_trajectory/robot_trajectory.h>                          // NEW
#include <moveit/trajectory_processing/iterative_spline_parameterization.h>   // NEW

#include <geometry_msgs/msg/pose.hpp>
#include <Eigen/Geometry>

#include <vector>
#include <memory>
#include <mutex>
#include <thread>
#include <chrono>
#include <cmath>
#include <atomic>
#include <sstream>
#include <iomanip>

using String            = std_msgs::msg::String;
using Float64MultiArray = std_msgs::msg::Float64MultiArray;
using BoolMsg           = std_msgs::msg::Bool;
using JointState        = sensor_msgs::msg::JointState;

// ─────────────────────────────────────────────────────────────
//  Velocity / acceleration scaling
//  Spline parameterization re-applies these after Pilz planning,
//  so Pilz's own scaling is set to 1.0 (max) and spline controls
//  the actual speed envelope.
// ─────────────────────────────────────────────────────────────
static constexpr double SPLINE_PTP_VEL_SCALE = 0.40;   // 10 %
static constexpr double SPLINE_PTP_ACC_SCALE = 0.40;

static constexpr double SPLINE_LIN_VEL_SCALE = 0.40;   // 10 %
static constexpr double SPLINE_LIN_ACC_SCALE = 0.40;

// /go_to_frame_point always uses SPLINE PTP at this (very low) speed.
static constexpr double FRAME_PTP_VEL_SCALE = 0.05;    // 5 %
static constexpr double FRAME_PTP_ACC_SCALE = 0.05;

static constexpr char PLANNING_PIPELINE[] = "pilz_industrial_motion_planner";
static constexpr char MOVE_GROUP[]        = "robot_manipulator";

class PrintLastPositionNode : public rclcpp::Node
{
public:
    PrintLastPositionNode()
        : Node("moveit_go_to_pose")
    {
        // ── Subscribers ──────────────────────────────────────
        command_sub_ = this->create_subscription<String>(
            "/ui_commands", 10,
            std::bind(&PrintLastPositionNode::commandCallback, this, std::placeholders::_1));

        // NEW: frame/point topic → reads from calibration.yaml
        frame_point_sub_ = this->create_subscription<String>(
            "/go_to_tf_point", 10,
            std::bind(&PrintLastPositionNode::framePointCallback, this, std::placeholders::_1));

        joint_state_sub_ = this->create_subscription<JointState>(
            "/joint_states", 200,
            [this](const JointState::SharedPtr msg) {
                std::lock_guard<std::mutex> lk(js_mutex_);
                last_js_ = *msg;
                ++js_version_;
            });

        cartesian_sub_ = this->create_subscription<BoolMsg>(
            "/cartesian_motion", 10,
            std::bind(&PrintLastPositionNode::cartesianCallback, this, std::placeholders::_1));

        joint_motion_sub_ = this->create_subscription<BoolMsg>(
            "/joint_motion", 10,
            std::bind(&PrintLastPositionNode::jointCallback, this, std::placeholders::_1));

        // ── Publishers ───────────────────────────────────────
        lastpos_pub_ = this->create_publisher<Float64MultiArray>("/last_position", 10);
        toast_pub_   = this->create_publisher<String>("/bt_toast_popup", 10);

        // ── Parameters ───────────────────────────────────────
        file_path_ = this->declare_parameter<std::string>(
            "yaml_file", "/home/nextup/NextupRobot/src/active_project_configs/planning_data/points.yaml");

        // NEW: calibration file path
        calib_file_path_ = this->declare_parameter<std::string>(
            "calib_yaml_file",
            "/home/nextup/NextupRobot/src/active_project_configs/planning_data/calibration.yaml");

        // ── Deferred MoveGroup init ───────────────────────────
        timer_ = this->create_wall_timer(
            std::chrono::milliseconds(100),
            std::bind(&PrintLastPositionNode::initializeMoveGroup, this));

        RCLCPP_INFO(this->get_logger(),
            "moveit_go_to_pose (Pilz + Spline parameterization) initialized");
    }

private:
    // ── ROS interfaces ───────────────────────────────────────
    rclcpp::Subscription<String>::SharedPtr     command_sub_;
    rclcpp::Subscription<String>::SharedPtr     frame_point_sub_;   // NEW
    rclcpp::Subscription<JointState>::SharedPtr joint_state_sub_;
    rclcpp::Subscription<BoolMsg>::SharedPtr    cartesian_sub_;
    rclcpp::Subscription<BoolMsg>::SharedPtr    joint_motion_sub_;

    rclcpp::Publisher<Float64MultiArray>::SharedPtr lastpos_pub_;
    rclcpp::Publisher<String>::SharedPtr            toast_pub_;

    std::unique_ptr<moveit::planning_interface::MoveGroupInterface> move_group_;
    rclcpp::TimerBase::SharedPtr timer_;

    // ── Joint-state tracking ─────────────────────────────────
    JointState last_js_;
    std::mutex js_mutex_;
    uint64_t   js_version_ = 0;

    // ── State flags ──────────────────────────────────────────
    std::atomic<bool> busy_          {false};  // true from command received → motion complete
    std::atomic<bool> executing_     {false};  // true only during plan() + execute() phase
    std::atomic<bool> cartesian_mode_{false};
    std::atomic<bool> joint_mode_    {false};

    std::chrono::steady_clock::time_point joint_mode_time_;
    std::chrono::steady_clock::time_point cart_mode_time_;

    // ── Config ───────────────────────────────────────────────
    std::string    file_path_;
    std::string    calib_file_path_;   // NEW
    const double   tol_                 = 0.01;
    const uint64_t required_js_updates_ = 10;
    const int      js_wait_timeout_ms_  = 2000;

    // ════════════════════════════════════════════════════════
    //  MoveGroup initialisation  (runs once via timer)
    // ════════════════════════════════════════════════════════
    void initializeMoveGroup()
    {
        if (move_group_) return;
        try
        {
            auto node_ptr = this->shared_from_this();
            move_group_ = std::make_unique<moveit::planning_interface::MoveGroupInterface>(
                node_ptr, MOVE_GROUP);

            // Lock to Pilz pipeline; planner ID will be set per motion call
            move_group_->setPlanningPipelineId(PLANNING_PIPELINE);

            // Pilz handles its own time parameterization during plan();
            // we will OVERWRITE it with spline right after, so set Pilz
            // scaling to 1.0 here — spline scaling constants control speed.
            move_group_->setMaxVelocityScalingFactor(SPLINE_PTP_VEL_SCALE);
            move_group_->setMaxAccelerationScalingFactor(SPLINE_PTP_ACC_SCALE);

            RCLCPP_INFO(this->get_logger(),
                "MoveGroupInterface initialized → pipeline: %s", PLANNING_PIPELINE);
            timer_->cancel();
        }
        catch (const std::bad_weak_ptr &) {}
        catch (const std::exception &e)
        {
            RCLCPP_ERROR(this->get_logger(), "MoveGroup init exception: %s", e.what());
        }
    }

    // ════════════════════════════════════════════════════════
    //  SPLINE PARAMETERIZATION HELPER
    //
    //  Takes an already-planned trajectory and re-stamps it with
    //  smooth S-curve (spline) velocity / acceleration profiles.
    //
    //  Returns false if parameterization fails.
    // ════════════════════════════════════════════════════════
    bool applySplineParameterization(
        moveit::planning_interface::MoveGroupInterface::Plan &plan,
        double vel_scale,
        double acc_scale,
        const std::string &label)
    {
        // Build a RobotTrajectory from the plan message
        const moveit::core::RobotModelConstPtr robot_model = move_group_->getRobotModel();
        robot_trajectory::RobotTrajectory rt(robot_model, MOVE_GROUP);

        moveit::core::RobotStatePtr ref_state = move_group_->getCurrentState(2.0);
        if (!ref_state)
        {
            RCLCPP_ERROR(this->get_logger(),
                "[%s] Could not get current robot state for spline parameterization", label.c_str());
            return false;
        }

        rt.setRobotTrajectoryMsg(*ref_state, plan.trajectory_);

        // ── KEY FIX: strip all existing Pilz time stamps, velocities,
        //    and accelerations before spline runs.
        //
        //    Pilz already stamped the trajectory at 100% speed (because we
        //    set scaling=1.0 before plan()). If those hints remain,
        //    IterativeSplineParameterization sees conflicting data and fails
        //    to converge. Zeroing everything forces it to work from a clean
        //    slate using only the joint positions — which is exactly what
        //    it needs.
        for (size_t i = 0; i < rt.getWayPointCount(); ++i)
        {
            rt.getWayPointPtr(i)->zeroVelocities();
            rt.getWayPointPtr(i)->zeroAccelerations();
            rt.setWayPointDurationFromPrevious(i, 0.0);
        }

        RCLCPP_INFO(this->get_logger(),
            "[%s] Cleared Pilz time stamps on %zu waypoints – running spline from scratch",
            label.c_str(), rt.getWayPointCount());

        // Apply iterative spline parameterization
        trajectory_processing::IterativeSplineParameterization isp(/*add_points=*/true);
        bool ok = isp.computeTimeStamps(rt, vel_scale, acc_scale);
        if (!ok)
        {
            RCLCPP_ERROR(this->get_logger(),
                "[%s] IterativeSplineParameterization failed", label.c_str());
            return false;
        }

        // Write the re-parameterized trajectory back into the plan
        rt.getRobotTrajectoryMsg(plan.trajectory_);

        // Log total duration after spline
        if (!plan.trajectory_.joint_trajectory.points.empty())
        {
            const auto &last_pt = plan.trajectory_.joint_trajectory.points.back();
            double total_sec =
                last_pt.time_from_start.sec +
                last_pt.time_from_start.nanosec * 1e-9;
            RCLCPP_INFO(this->get_logger(),
                "[%s] Spline done: vel=%.0f%% acc=%.0f%%  duration=%.3f s",
                label.c_str(), vel_scale * 100.0, acc_scale * 100.0, total_sec);
        }
        return true;
    }

    // ════════════════════════════════════════════════════════
    //  Joint-state helpers
    // ════════════════════════════════════════════════════════
    JointState get_js_copy()
    {
        std::lock_guard<std::mutex> lk(js_mutex_);
        return last_js_;
    }

    bool wait_for_js_updates(uint64_t required, int timeout_ms)
    {
        uint64_t start;
        { std::lock_guard<std::mutex> lk(js_mutex_); start = js_version_; }
        int waited = 0;
        const int poll_ms = 10;
        while (rclcpp::ok())
        {
            { std::lock_guard<std::mutex> lk(js_mutex_);
              if (js_version_ >= start + required) return true; }
            if (waited >= timeout_ms) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(poll_ms));
            waited += poll_ms;
        }
        return false;
    }

    std::vector<double> reorder_from_js(const JointState &js)
    {
        std::vector<double> out(6, 0.0);
        for (size_t i = 0; i < js.name.size() && i < js.position.size(); ++i)
        {
            const auto &n = js.name[i];
            if      (n == "joint1") out[0] = js.position[i];
            else if (n == "joint2") out[1] = js.position[i];
            else if (n == "joint3") out[2] = js.position[i];
            else if (n == "joint4") out[3] = js.position[i];
            else if (n == "joint5") out[4] = js.position[i];
            else if (n == "joint6") out[5] = js.position[i];
        }
        return out;
    }

    bool compare_joints_and_log(const std::vector<double> &live,
                                 const std::vector<double> &target,
                                 double tol = 0.01)
    {
        bool all_ok = true;
        RCLCPP_INFO(this->get_logger(), "------------------------------------------------");
        RCLCPP_INFO(this->get_logger(), "JOINT COMPARISON LOG");
        for (size_t i = 0; i < 6; ++i)
        {
            double diff = std::fabs(live[i] - target[i]);
            RCLCPP_INFO(this->get_logger(),
                "Joint%zu -> Target: %.6f | Live: %.6f | Diff: %.6f",
                i + 1, target[i], live[i], diff);
            if (diff > tol)
            {
                RCLCPP_WARN(this->get_logger(),
                    "Joint%zu NOT MATCHED (Diff %.6f > Tol %.6f)", i + 1, diff, tol);
                all_ok = false;
            }
        }
        if (all_ok) RCLCPP_INFO(this->get_logger(), "ALL JOINTS MATCHED");
        return all_ok;
    }

    void publish_toast(const std::string &txt)
    {
        String m; m.data = txt;
        toast_pub_->publish(m);
        RCLCPP_INFO(this->get_logger(), "Toast: %s", txt.c_str());
    }

    // ════════════════════════════════════════════════════════
    //  Mode flag callbacks
    // ════════════════════════════════════════════════════════
    void jointCallback(const BoolMsg::SharedPtr msg)
    {
        if (!msg->data) return;

        if (busy_.load())
        {
            RCLCPP_WARN(this->get_logger(),
                "/joint_motion received but MOTION IS RUNNING – ignored");
            publish_toast("Motion in progress,warn,3");
            return;
        }
        joint_mode_.store(true);
        joint_mode_time_ = std::chrono::steady_clock::now();
        RCLCPP_INFO(this->get_logger(),
            "/joint_motion → TRUE   [will use SPLINE PTP]");
    }

    void cartesianCallback(const BoolMsg::SharedPtr msg)
    {
        if (!msg->data) return;

        if (busy_.load())
        {
            RCLCPP_WARN(this->get_logger(),
                "/cartesian_motion received but MOTION IS RUNNING – ignored");
            publish_toast("Motion in progress,warn,3");
            return;
        }
        cartesian_mode_.store(true);
        cart_mode_time_ = std::chrono::steady_clock::now();
        RCLCPP_INFO(this->get_logger(),
            "/cartesian_motion → TRUE   [will use SPLINE LIN]");
    }

    // ════════════════════════════════════════════════════════
    //  Command callback  – gate + dispatch  (points.yaml)
    // ════════════════════════════════════════════════════════
    void commandCallback(const String::SharedPtr msg)
    {
        const std::string prefix = "get_last_pose@";
        if (msg->data.rfind(prefix, 0) != 0) return;

        // Hard gate — blocks both planning and execution of any new command
        // while the current motion cycle is anywhere in progress
        if (busy_.load())
        {
            const std::string phase = executing_.load() ? "EXECUTING" : "PLANNING";
            RCLCPP_WARN(this->get_logger(),
                "New command REJECTED – robot is currently [%s]. "
                "Wait for motion to complete before sending next command.",
                phase.c_str());
            publish_toast("Motion in progress,warn,3");
            return;
        }

        busy_.store(true);
        std::string point = msg->data.substr(prefix.size());
        std::thread(&PrintLastPositionNode::handleGetLastPose, this, point).detach();
    }

    // ════════════════════════════════════════════════════════
    //  Frame-point callback  – gate + dispatch  (calibration.yaml)
    //
    //  Payload is the bare identifier, e.g. "f1_point1".
    //  No "get_last_pose@" prefix.
    // ════════════════════════════════════════════════════════
    void framePointCallback(const String::SharedPtr msg)
    {
        const std::string id = msg->data;   // e.g. "f1_point1"
        if (id.empty()) return;

        if (busy_.load())
        {
            const std::string phase = executing_.load() ? "EXECUTING" : "PLANNING";
            RCLCPP_WARN(this->get_logger(),
                "/go_to_frame_point REJECTED – robot is currently [%s]. "
                "Wait for motion to complete before sending next command.",
                phase.c_str());
            publish_toast("Motion in progress,warn,3");
            return;
        }

        busy_.store(true);
        std::thread(&PrintLastPositionNode::handleGoToFramePoint, this, id).detach();
    }

    // ════════════════════════════════════════════════════════
    //  Resolve motion type from current mode flags.
    //  Returns true on success and sets ptp/lin out-flags.
    //  Returns false if no mode selected (caller should abort).
    //  Clears the mode flags on success.
    // ════════════════════════════════════════════════════════
    bool resolveMotionType(bool &use_spline_ptp, bool &use_spline_lin)
    {
        use_spline_ptp = false;
        use_spline_lin = false;

        bool joint_flag = joint_mode_.load();
        bool cart_flag  = cartesian_mode_.load();

        if (!joint_flag && !cart_flag)
        {
            publish_toast("Select motion mode: Joint or Cartesian,warn,3");
            return false;
        }
        else if (joint_flag && cart_flag)
        {
            // Whichever flag arrived most recently wins
            if (joint_mode_time_ > cart_mode_time_) use_spline_ptp = true;
            else                                     use_spline_lin = true;
        }
        else if (joint_flag) use_spline_ptp = true;
        else                 use_spline_lin = true;

        // Latch and clear flags immediately
        joint_mode_.store(false);
        cartesian_mode_.store(false);

        RCLCPP_INFO(this->get_logger(), "Selected motion type: %s",
            use_spline_ptp ? "SPLINE PTP" : "SPLINE LIN");
        return true;
    }

    // ════════════════════════════════════════════════════════
    //  Core handler  – runs in detached thread  (points.yaml)
    // ════════════════════════════════════════════════════════
    void handleGetLastPose(std::string point_name)
    {
        try
        {
            RCLCPP_INFO(this->get_logger(),
                "Handling get_last_pose@%s", point_name.c_str());

            // ── 1. Resolve motion type ───────────────────────────
            bool use_spline_ptp = false;
            bool use_spline_lin = false;
            if (!resolveMotionType(use_spline_ptp, use_spline_lin))
            {
                busy_.store(false);
                return;
            }

            // ── 2. Load target joint values from YAML ────────────
            std::vector<double> target(6, 0.0);
            bool found = false;

            YAML::Node yaml;
            try { yaml = YAML::LoadFile(file_path_); }
            catch (const YAML::Exception &e)
            {
                RCLCPP_ERROR(this->get_logger(), "YAML load error: %s", e.what());
                publish_toast(point_name + " not found,failure,3");
                busy_.store(false);
                return;
            }

            if (!yaml["points"])
            {
                publish_toast(point_name + " not found,failure,3");
                busy_.store(false);
                return;
            }

            for (auto seg : yaml["points"])
            {
                if (!seg["name"]) continue;
                if (seg["name"].as<std::string>() != point_name) continue;
                if (!seg["joints_values"]) break;

                YAML::Node jv = seg["joints_values"];
                for (int i = 1; i <= 6; ++i)
                {
                    std::string k = "joint" + std::to_string(i);
                    if (jv[k])
                    {
                        try { target[i - 1] = jv[k].as<double>(); }
                        catch (...) { target[i - 1] = 0.0; }
                    }
                    else
                    {
                        RCLCPP_WARN(this->get_logger(),
                            "Missing %s for point %s – using 0.0",
                            k.c_str(), point_name.c_str());
                        target[i - 1] = 0.0;
                    }
                }
                found = true;
                break;
            }

            if (!found)
            {
                publish_toast(point_name + " not found,failure,3");
                busy_.store(false);
                return;
            }

            // Publish last position for UI
            Float64MultiArray fm; fm.data = target;
            lastpos_pub_->publish(fm);
            RCLCPP_INFO(this->get_logger(),
                "Published /last_position for %s", point_name.c_str());

            // ── 3-5. Shared motion pipeline ──────────────────────
            executeMotionToTarget(point_name, target, use_spline_ptp, use_spline_lin);
        }
        catch (const std::exception &e)
        {
            RCLCPP_ERROR(this->get_logger(), "Unhandled exception: %s", e.what());
            publish_toast("Error,failure,3");
            executing_.store(false);
            busy_.store(false);
        }
        catch (...)
        {
            RCLCPP_ERROR(this->get_logger(), "Unknown fatal error");
            publish_toast("Error,failure,3");
            executing_.store(false);
            busy_.store(false);
        }
    }

    // ════════════════════════════════════════════════════════
    //  Frame-point handler  – runs in detached thread
    //  (calibration.yaml, structure:  f1: point1: joints: jointN)
    // ════════════════════════════════════════════════════════
    void handleGoToFramePoint(std::string id)
    {
        try
        {
            RCLCPP_INFO(this->get_logger(),
                "Handling go_to_frame_point %s", id.c_str());

            // ── 1. Motion type is ALWAYS joint (SPLINE PTP) for this topic.
            //   No joint/cartesian flag check — frame-point moves are
            //   always slow joint moves regardless of mode flags.
            const bool use_spline_ptp = true;
            const bool use_spline_lin = false;

            // ── 2a. Split "f1_point1" → frame="f1", point="point1" ─
            //   Splits on the FIRST underscore. Frame = before, point = after.
            auto us = id.find('_');
            if (us == std::string::npos)
            {
                RCLCPP_ERROR(this->get_logger(),
                    "Bad frame-point id '%s' (expected like f1_point1)", id.c_str());
                publish_toast(id + " not found,failure,3");
                busy_.store(false);
                return;
            }
            std::string frame = id.substr(0, us);
            std::string point = id.substr(us + 1);

            // ── 2b. Load target joints from calibration.yaml ─────
            std::vector<double> target(6, 0.0);
            bool found = false;

            YAML::Node yaml;
            try { yaml = YAML::LoadFile(calib_file_path_); }
            catch (const YAML::Exception &e)
            {
                RCLCPP_ERROR(this->get_logger(), "Calib YAML load error: %s", e.what());
                publish_toast(id + " not found,failure,3");
                busy_.store(false);
                return;
            }

            if (yaml[frame] && yaml[frame][point] && yaml[frame][point]["joints"])
            {
                YAML::Node jv = yaml[frame][point]["joints"];
                for (int i = 1; i <= 6; ++i)
                {
                    std::string k = "joint" + std::to_string(i);
                    if (jv[k])
                    {
                        try { target[i - 1] = jv[k].as<double>(); }
                        catch (...) { target[i - 1] = 0.0; }
                    }
                    else
                    {
                        RCLCPP_WARN(this->get_logger(),
                            "Missing %s for %s – using 0.0", k.c_str(), id.c_str());
                        target[i - 1] = 0.0;
                    }
                }
                found = true;
            }

            if (!found)
            {
                RCLCPP_ERROR(this->get_logger(),
                    "Frame/point '%s' not found in calibration.yaml", id.c_str());
                publish_toast(id + " not found,failure,3");
                busy_.store(false);
                return;
            }

            // Publish last position for UI
            Float64MultiArray fm; fm.data = target;
            lastpos_pub_->publish(fm);
            RCLCPP_INFO(this->get_logger(),
                "Published /last_position for %s", id.c_str());

            // ── 3-5. Shared motion pipeline (forced slow PTP) ────
            executeMotionToTarget(id, target, use_spline_ptp, use_spline_lin,
                                  FRAME_PTP_VEL_SCALE, FRAME_PTP_ACC_SCALE);
        }
        catch (const std::exception &e)
        {
            RCLCPP_ERROR(this->get_logger(), "Unhandled exception: %s", e.what());
            publish_toast("Error,failure,3");
            executing_.store(false);
            busy_.store(false);
        }
        catch (...)
        {
            RCLCPP_ERROR(this->get_logger(), "Unknown fatal error");
            publish_toast("Error,failure,3");
            executing_.store(false);
            busy_.store(false);
        }
    }

    // ════════════════════════════════════════════════════════
    //  Shared motion pipeline
    //    3. Wait for MoveGroup
    //    4a. SPLINE PTP   /   4b. SPLINE LIN
    //    5. Joint verification
    //  Always clears busy_ before returning.
    // ════════════════════════════════════════════════════════
    void executeMotionToTarget(const std::string &label,
                                const std::vector<double> &target,
                                bool use_spline_ptp,
                                bool use_spline_lin,
                                double ptp_vel_scale = SPLINE_PTP_VEL_SCALE,
                                double ptp_acc_scale = SPLINE_PTP_ACC_SCALE)
    {
        // ── 3. Wait for MoveGroup ────────────────────────────
        int tries = 0;
        while (!move_group_ && tries < 50)
        {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
            ++tries;
        }
        if (!move_group_)
        {
            publish_toast(label + " not possible,failure,3");
            busy_.store(false);
            return;
        }

        // ════════════════════════════════════════════════════
        //  4a.  SPLINE PTP
        //       Pilz PTP  →  IterativeSplineParameterization
        // ════════════════════════════════════════════════════
        if (use_spline_ptp)
        {
            // Mark planning+execution phase – any new command now sees PLANNING in toast
            executing_.store(true);

            RCLCPP_INFO(this->get_logger(),
                "[SPLINE PTP] Planning joint-space path for '%s'", label.c_str());

            move_group_->setPlanningPipelineId(PLANNING_PIPELINE);
            move_group_->setPlannerId("PTP");

            // Set scaling to 1.0 – spline will re-stamp the trajectory
            move_group_->setMaxVelocityScalingFactor(1.0);
            move_group_->setMaxAccelerationScalingFactor(1.0);

            move_group_->setStartStateToCurrentState();
            move_group_->setJointValueTarget(target);

            moveit::planning_interface::MoveGroupInterface::Plan plan;
            if (move_group_->plan(plan) != moveit::core::MoveItErrorCode::SUCCESS)
            {
                RCLCPP_ERROR(this->get_logger(),
                    "[SPLINE PTP] Pilz planning failed for '%s'", label.c_str());
                publish_toast(label + " Joint not possible,failure,3");
                executing_.store(false);
                busy_.store(false);
                return;
            }

            // Apply spline time parameterization
            if (!applySplineParameterization(
                    plan, ptp_vel_scale, ptp_acc_scale, "SPLINE PTP"))
            {
                publish_toast(label + " Joint not possible,failure,3");
                executing_.store(false);
                busy_.store(false);
                return;
            }

            // toast suppressed – motion start notification removed
            RCLCPP_INFO(this->get_logger(),
                "[SPLINE PTP] Executing for '%s'", label.c_str());

            if (move_group_->execute(plan) != moveit::core::MoveItErrorCode::SUCCESS)
            {
                RCLCPP_ERROR(this->get_logger(),
                    "[SPLINE PTP] Execution failed for '%s'", label.c_str());
                publish_toast(label + " Joint not possible,failure,3");
                executing_.store(false);
                busy_.store(false);
                return;
            }

            executing_.store(false);
            RCLCPP_INFO(this->get_logger(),
                "[SPLINE PTP] Execution succeeded for '%s'", label.c_str());
        }

        // ════════════════════════════════════════════════════
        //  4b.  SPLINE LIN
        //       Pilz LIN (straight Cartesian line)
        //       →  IterativeSplineParameterization
        //
        //  Note: Pilz LIN guarantees a geometrically straight
        //  path. Spline re-parameterization preserves the path
        //  waypoints but smooths the velocity profile along it.
        // ════════════════════════════════════════════════════
        else if (use_spline_lin)
        {
            // Mark planning+execution phase – any new command now sees PLANNING in toast
            executing_.store(true);

            RCLCPP_INFO(this->get_logger(),
                "[SPLINE LIN] Computing FK target pose for '%s'", label.c_str());

            // Compute target Cartesian pose via FK
            const moveit::core::RobotModelConstPtr robot_model =
                move_group_->getRobotModel();
            const moveit::core::JointModelGroup *jmg =
                robot_model->getJointModelGroup(MOVE_GROUP);

            moveit::core::RobotState rs(robot_model);
            rs.setToDefaultValues();
            rs.setJointGroupPositions(jmg, target);
            rs.update();

            // Resolve end-effector link
            std::string ee_link = move_group_->getEndEffectorLink();
            if (ee_link.empty())
            {
                const auto &links = jmg->getLinkModelNames();
                if (!links.empty()) ee_link = links.back();
            }
            if (ee_link.empty())
            {
                RCLCPP_ERROR(this->get_logger(),
                    "[SPLINE LIN] Could not determine end-effector link");
                publish_toast(label + " Cartesian not possible,failure,3");
                executing_.store(false);
                busy_.store(false);
                return;
            }

            // Build target pose from FK
            const Eigen::Isometry3d ee_tf = rs.getGlobalLinkTransform(ee_link);
            geometry_msgs::msg::Pose target_pose;
            target_pose.position.x = ee_tf.translation().x();
            target_pose.position.y = ee_tf.translation().y();
            target_pose.position.z = ee_tf.translation().z();
            Eigen::Quaterniond q(ee_tf.rotation());
            target_pose.orientation.x = q.x();
            target_pose.orientation.y = q.y();
            target_pose.orientation.z = q.z();
            target_pose.orientation.w = q.w();

            RCLCPP_INFO(this->get_logger(),
                "[SPLINE LIN] EE target: x=%.4f y=%.4f z=%.4f  "
                "qx=%.4f qy=%.4f qz=%.4f qw=%.4f",
                target_pose.position.x, target_pose.position.y,
                target_pose.position.z,
                target_pose.orientation.x, target_pose.orientation.y,
                target_pose.orientation.z, target_pose.orientation.w);

            // Configure Pilz LIN
            move_group_->setPlanningPipelineId(PLANNING_PIPELINE);
            move_group_->setPlannerId("LIN");

            // IMPORTANT: For LIN we must pass the actual desired scaling to Pilz
            // BEFORE plan(). Pilz LIN validates every IK solution along the straight
            // Cartesian path against (joint_limit × scaling_factor) during planning.
            // Setting 1.0 here means full joint limits — joint2 (and others) can
            // violate their deceleration limit trying to hold the straight line at
            // full speed, so plan() fails before spline even runs.
            //
            // We pass SPLINE_LIN_VEL_SCALE / SPLINE_LIN_ACC_SCALE so Pilz validates
            // within the same safe envelope that spline will later apply.
            // After plan() succeeds we zero the Pilz timestamps and spline
            // re-stamps from scratch at the same scale — consistent and safe.
            move_group_->setMaxVelocityScalingFactor(SPLINE_LIN_VEL_SCALE);
            move_group_->setMaxAccelerationScalingFactor(SPLINE_LIN_ACC_SCALE);

            move_group_->setStartStateToCurrentState();
            move_group_->setPoseTarget(target_pose);

            moveit::planning_interface::MoveGroupInterface::Plan plan;
            if (move_group_->plan(plan) != moveit::core::MoveItErrorCode::SUCCESS)
            {
                RCLCPP_ERROR(this->get_logger(),
                    "[SPLINE LIN] Pilz planning failed for '%s'", label.c_str());
                publish_toast(label + " Cartesian not possible,failure,3");
                executing_.store(false);
                busy_.store(false);
                return;
            }

            // Apply spline time parameterization
            if (!applySplineParameterization(
                    plan, SPLINE_LIN_VEL_SCALE, SPLINE_LIN_ACC_SCALE, "SPLINE LIN"))
            {
                publish_toast(label + " Cartesian not possible,failure,3");
                executing_.store(false);
                busy_.store(false);
                return;
            }

            // toast suppressed – motion start notification removed
            RCLCPP_INFO(this->get_logger(),
                "[SPLINE LIN] Executing spline-smooth straight line for '%s'",
                label.c_str());

            if (move_group_->execute(plan) != moveit::core::MoveItErrorCode::SUCCESS)
            {
                RCLCPP_ERROR(this->get_logger(),
                    "[SPLINE LIN] Execution failed for '%s'", label.c_str());
                publish_toast(label + " Cartesian not possible,failure,3");
                executing_.store(false);
                busy_.store(false);
                return;
            }

            executing_.store(false);
            RCLCPP_INFO(this->get_logger(),
                "[SPLINE LIN] Execution succeeded for '%s'", label.c_str());
        }

        // ── 5. Joint verification ────────────────────────────
        bool got_updates =
            wait_for_js_updates(required_js_updates_, js_wait_timeout_ms_);
        if (!got_updates)
            RCLCPP_WARN(this->get_logger(),
                "Did not receive %lu joint_states updates within timeout",
                (unsigned long)required_js_updates_);

        JointState js_snapshot = get_js_copy();
        auto live = reorder_from_js(js_snapshot);

        RCLCPP_INFO(this->get_logger(),
            "LIVE Joint States (Reordered) AFTER execution:");
        for (size_t i = 0; i < live.size(); ++i)
            RCLCPP_INFO(this->get_logger(), "  Joint%zu = %.6f", i + 1, live[i]);

        bool match = compare_joints_and_log(live, target, tol_);
        publish_toast(match
            ? label + " Reached,success,3"
            : label + " Failed,failure,3");

        busy_.store(false);
    }
};

// ─────────────────────────────────────────────────────────────
int main(int argc, char **argv)
{
    rclcpp::init(argc, argv);
    auto node = std::make_shared<PrintLastPositionNode>();
    rclcpp::spin(node);
    rclcpp::shutdown();
    return 0;
}
