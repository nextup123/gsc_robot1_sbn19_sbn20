#include <rclcpp/rclcpp.hpp>
#include <yaml-cpp/yaml.h>
#include <std_msgs/msg/string.hpp>
#include <std_msgs/msg/float64_multi_array.hpp>
#include <std_msgs/msg/bool.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <std_srvs/srv/set_bool.hpp> 

#include <moveit/move_group_interface/move_group_interface.h>
#include <moveit/robot_state/robot_state.h>
#include <moveit_msgs/msg/robot_trajectory.hpp>

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
using SetBool           = std_srvs::srv::SetBool; 

static constexpr double SPLINE_PTP_VEL_SCALE = 0.05;   
static constexpr double SPLINE_PTP_ACC_SCALE = 0.05;

static constexpr double SPLINE_LIN_VEL_SCALE = 0.05;   
static constexpr double SPLINE_LIN_ACC_SCALE = 0.05;

static constexpr char MOVE_GROUP[] = "robot_manipulator";

class PrintLastPositionNode : public rclcpp::Node
{
public:
    PrintLastPositionNode()
        : Node("moveit_go_to_pose")
    {
        // Mutually exclusive callback group to ensure parallel execution across threads
        callback_group_ = this->create_callback_group(rclcpp::CallbackGroupType::MutuallyExclusive);

        // Separate callback group for the pipeline-switch service so it never
        // queues behind high-frequency /joint_states callbacks or a blocking
        // initializeMoveGroup() timer tick that share callback_group_. With a
        // MultiThreadedExecutor, callbacks in different callback groups can be
        // dispatched to different threads and run concurrently, so this call
        // is serviced immediately regardless of what else is happening.
        service_callback_group_ = this->create_callback_group(rclcpp::CallbackGroupType::MutuallyExclusive);
        
        auto sub_options = rclcpp::SubscriptionOptions();
        sub_options.callback_group = callback_group_;

        command_sub_ = this->create_subscription<String>(
            "/ui_commands", 10,
            std::bind(&PrintLastPositionNode::commandCallback, this, std::placeholders::_1),
            sub_options);

        pipeline_srv_ = this->create_service<SetBool>(
            "/change_planning_pipeline",
            std::bind(&PrintLastPositionNode::pipelineServiceCallback, this, std::placeholders::_1, std::placeholders::_2),
            rmw_qos_profile_services_default,
            service_callback_group_);

        joint_state_sub_ = this->create_subscription<JointState>(
            "/joint_states", 200,
            [this](const JointState::SharedPtr msg) {
                std::lock_guard<std::mutex> lk(js_mutex_);
                last_js_ = *msg;
                ++js_version_;
            },
            sub_options);

        cartesian_sub_ = this->create_subscription<BoolMsg>(
            "/cartesian_motion", 10,
            std::bind(&PrintLastPositionNode::cartesianCallback, this, std::placeholders::_1),
            sub_options);

        joint_motion_sub_ = this->create_subscription<BoolMsg>(
            "/joint_motion", 10,
            std::bind(&PrintLastPositionNode::jointCallback, this, std::placeholders::_1),
            sub_options);

        lastpos_pub_ = this->create_publisher<Float64MultiArray>("/last_position", 10);
        toast_pub_   = this->create_publisher<String>("/bt_toast_popup", 10);

        file_path_ = this->declare_parameter<std::string>(
            "yaml_file", "/home/nextup/NextupRobot/src/active_project_configs/planning_data/points.yaml");

        timer_ = this->create_wall_timer(
            std::chrono::milliseconds(100),
            std::bind(&PrintLastPositionNode::initializeMoveGroup, this),
            callback_group_);

        RCLCPP_INFO(this->get_logger(), "moveit_go_to_pose (Strict Async Multi-Threaded) initialized");
    }

private:
    rclcpp::CallbackGroup::SharedPtr            callback_group_;
    rclcpp::CallbackGroup::SharedPtr            service_callback_group_;
    rclcpp::Subscription<String>::SharedPtr     command_sub_;
    rclcpp::Service<SetBool>::SharedPtr         pipeline_srv_;
    rclcpp::Subscription<JointState>::SharedPtr joint_state_sub_;
    rclcpp::Subscription<BoolMsg>::SharedPtr    cartesian_sub_;
    rclcpp::Subscription<BoolMsg>::SharedPtr    joint_motion_sub_;

    rclcpp::Publisher<Float64MultiArray>::SharedPtr lastpos_pub_;
    rclcpp::Publisher<String>::SharedPtr            toast_pub_;

    std::unique_ptr<moveit::planning_interface::MoveGroupInterface> move_group_;
    rclcpp::TimerBase::SharedPtr timer_;

    JointState last_js_;
    std::mutex js_mutex_;
    uint64_t   js_version_ = 0;

    std::atomic<bool> busy_          {false};  
    std::atomic<bool> cartesian_mode_{false};
    std::atomic<bool> joint_mode_    {false};
    std::atomic<bool> use_ompl_pipeline_{false};

    std::chrono::steady_clock::time_point joint_mode_time_;
    std::chrono::steady_clock::time_point cart_mode_time_;

    std::string    file_path_;
    const double   tol_                 = 0.01;
    const uint64_t required_js_updates_ = 10;
    const int      js_wait_timeout_ms_  = 2000;

    // Minimum fraction of the Cartesian path that must be achievable via IK
    // before we accept the trajectory. Below this, the path is considered
    // to have broken down (e.g. near a singularity or joint limit).
    static constexpr double CARTESIAN_MIN_FRACTION = 0.95;
    static constexpr double CARTESIAN_EEF_STEP     = 0.01; // 1 cm interpolation resolution

    void initializeMoveGroup()
    {
        if (move_group_) return;
        try
        {
            auto node_ptr = this->shared_from_this();
            move_group_ = std::make_unique<moveit::planning_interface::MoveGroupInterface>(node_ptr, MOVE_GROUP);
            timer_->cancel();
            RCLCPP_INFO(this->get_logger(), "MoveGroup Interface initialized successfully.");
        }
        catch (const std::bad_weak_ptr &) {}
        catch (const std::exception &e) {
            RCLCPP_ERROR(this->get_logger(), "MoveGroup Interface init exception: %s", e.what());
        }
    }

    // Builds a geometry_msgs Pose corresponding to the given joint target,
    // via forward kinematics. Used both by the OMPL joint-target-as-pose
    // path and the Cartesian path computation.
    geometry_msgs::msg::Pose forwardKinematicsPose(const std::vector<double> &target)
    {
        const moveit::core::RobotModelConstPtr robot_model = move_group_->getRobotModel();
        const moveit::core::JointModelGroup* jmg = robot_model->getJointModelGroup(MOVE_GROUP);
        moveit::core::RobotState rs(robot_model);
        rs.setJointGroupPositions(jmg, target);
        rs.update();

        geometry_msgs::msg::Pose target_pose;
        Eigen::Isometry3d ee_tf = rs.getGlobalLinkTransform(move_group_->getEndEffectorLink());
        target_pose.position.x = ee_tf.translation().x();
        target_pose.position.y = ee_tf.translation().y();
        target_pose.position.z = ee_tf.translation().z();
        Eigen::Quaterniond q(ee_tf.rotation());
        target_pose.orientation.x = q.x(); target_pose.orientation.y = q.y();
        target_pose.orientation.z = q.z(); target_pose.orientation.w = q.w();
        return target_pose;
    }

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
        while (rclcpp::ok())
        {
            { std::lock_guard<std::mutex> lk(js_mutex_); if (js_version_ >= start + required) return true; }
            if (waited >= timeout_ms) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
            waited += 10;
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

    bool compare_joints_and_log(const std::vector<double> &live, const std::vector<double> &target, double tol = 0.01)
    {
        bool all_ok = true;
        for (size_t i = 0; i < 6; ++i) {
            if (std::fabs(live[i] - target[i]) > tol) all_ok = false;
        }
        return all_ok;
    }

    void publish_toast(const std::string &txt)
    {
        String m; m.data = txt;
        toast_pub_->publish(m);
    }

    void pipelineServiceCallback(const std::shared_ptr<SetBool::Request> request,
                                 std::shared_ptr<SetBool::Response> response)
    {
        if (request->data) {
            use_ompl_pipeline_.store(true); 
            RCLCPP_INFO(this->get_logger(), "Service: Switched pipeline to OMPL");
            
            publish_toast("Set to OMPL,success,3");
            
            response->success = true;
            response->message = "Flipped to OMPL Planning Engine Module.";
        } else {
            use_ompl_pipeline_.store(false); 
            RCLCPP_INFO(this->get_logger(), "Service: Switched pipeline to PILZ");
            
            publish_toast("Set to PILZ,success,3");
            
            response->success = true;
            response->message = "Flipped to PILZ Industrial Planning Engine Module.";
        }
    }

    void jointCallback(const BoolMsg::SharedPtr msg) {
        if (!msg->data) return;
        joint_mode_.store(true);
        joint_mode_time_ = std::chrono::steady_clock::now();
    }

    void cartesianCallback(const BoolMsg::SharedPtr msg) {
        if (!msg->data) return;
        cartesian_mode_.store(true);
        cart_mode_time_ = std::chrono::steady_clock::now();
    }

    void commandCallback(const String::SharedPtr msg)
    {
        const std::string prefix = "get_last_pose@";
        if (msg->data.rfind(prefix, 0) != 0) return;

        if (busy_.load()) {
            publish_toast("Motion in progress,warn,3");
            return;
        }
        busy_.store(true);
        std::string point = msg->data.substr(prefix.size());
        std::thread(&PrintLastPositionNode::handleGetLastPose, this, point).detach(); 
    }

    void handleGetLastPose(std::string point_name)
    {
        try
        {
            if (!move_group_) { busy_.store(false); return; }

            bool joint_flag = joint_mode_.load();
            bool cart_flag  = cartesian_mode_.load();
            bool use_joint = false; bool use_cart = false;

            if (!joint_flag && !cart_flag) {
                publish_toast("Select Joint or Cartesian mode,warn,3");
                busy_.store(false); return;
            }
            if (joint_flag && cart_flag) {
                if (joint_mode_time_ > cart_mode_time_) use_joint = true; else use_cart = true;
            } else if (joint_flag) use_joint = true; else use_cart = true;

            joint_mode_.store(false); cartesian_mode_.store(false);

            std::vector<double> target(6, 0.0);
            YAML::Node yaml = YAML::LoadFile(file_path_);
            for (auto seg : yaml["points"]) {
                if (seg["name"] && seg["name"].as<std::string>() == point_name) {
                    YAML::Node jv = seg["joints_values"];
                    for (int i = 1; i <= 6; ++i) {
                        target[i-1] = jv["joint" + std::to_string(i)] ? jv["joint" + std::to_string(i)].as<double>() : 0.0;
                    }
                    break;
                }
            }

            Float64MultiArray fm; fm.data = target;
            lastpos_pub_->publish(fm);

            move_group_->setStartStateToCurrentState();
            moveit::planning_interface::MoveGroupInterface::Plan plan;
            bool plan_success = false;

            bool active_pipeline_is_ompl = use_ompl_pipeline_.load();

            if (active_pipeline_is_ompl) {
                if (use_joint) {
                    // Joint-space target: RRTConnect is fine here, no
                    // straight-line requirement for PTP-style joint motion.
                    move_group_->setPlanningPipelineId("ompl"); 
                    move_group_->setPlannerId("RRTConnectkConfigDefault"); 
                    move_group_->setMaxVelocityScalingFactor(SPLINE_PTP_VEL_SCALE);
                    move_group_->setMaxAccelerationScalingFactor(SPLINE_PTP_ACC_SCALE);
                    move_group_->setJointValueTarget(target);
                    plan_success = (move_group_->plan(plan) == moveit::core::MoveItErrorCode::SUCCESS);
                } else {
                    // Cartesian target under OMPL: RRTConnect is a sampling-based
                    // planner with no notion of a straight-line end-effector path,
                    // so plan()/setPoseTarget() here produced curved motion.
                    // Use computeCartesianPath() instead, which interpolates the
                    // EE pose linearly and solves IK per waypoint, then feed the
                    // result through the same spline parameterization as before.
                    move_group_->setMaxVelocityScalingFactor(SPLINE_LIN_VEL_SCALE);
                    move_group_->setMaxAccelerationScalingFactor(SPLINE_LIN_ACC_SCALE);

                    geometry_msgs::msg::Pose target_pose = forwardKinematicsPose(target);

                    std::vector<geometry_msgs::msg::Pose> waypoints;
                    waypoints.push_back(target_pose);

                    moveit_msgs::msg::RobotTrajectory cart_trajectory;
                    const double jump_threshold = 0.0; // disabled; deprecated but required by this signature
                    double fraction = move_group_->computeCartesianPath(
                        waypoints, CARTESIAN_EEF_STEP, jump_threshold, cart_trajectory);

                    plan_success = (fraction >= CARTESIAN_MIN_FRACTION);
                    if (plan_success) {
                        plan.trajectory_ = cart_trajectory;
                    } else {
                        RCLCPP_WARN(this->get_logger(),
                            "Cartesian path only %.1f%% achieved for '%s', aborting",
                            fraction * 100.0, point_name.c_str());
                    }
                }
            }
            else {
                move_group_->setPlanningPipelineId("pilz_industrial_motion_planner"); 
                if (use_joint) {
                    move_group_->setPlannerId("PTP"); 
                    move_group_->setMaxVelocityScalingFactor(1.0);
                    move_group_->setMaxAccelerationScalingFactor(1.0);
                    move_group_->setJointValueTarget(target);
                    plan_success = (move_group_->plan(plan) == moveit::core::MoveItErrorCode::SUCCESS);
                } else {
                    move_group_->setPlannerId("LIN"); 
                    move_group_->setMaxVelocityScalingFactor(SPLINE_LIN_VEL_SCALE);
                    move_group_->setMaxAccelerationScalingFactor(SPLINE_LIN_ACC_SCALE);

                    geometry_msgs::msg::Pose target_pose = forwardKinematicsPose(target);
                    move_group_->setPoseTarget(target_pose);
                    plan_success = (move_group_->plan(plan) == moveit::core::MoveItErrorCode::SUCCESS);
                }
            }

            if (plan_success) {
                publish_toast(point_name + " Motion Started,success,5");
                move_group_->execute(plan);
            } else {
                publish_toast(point_name + " Planning Failed,failure,3");
            }

            wait_for_js_updates(required_js_updates_, js_wait_timeout_ms_);
            bool match = compare_joints_and_log(reorder_from_js(get_js_copy()), target, tol_);
            publish_toast(match ? point_name + " Reached,success,10" : point_name + " Target Failed,failure,3");
            busy_.store(false);
        }
        catch (...) { publish_toast("System Error,failure,3"); busy_.store(false); }
    }
};

int main(int argc, char **argv) {
    rclcpp::init(argc, argv);
    auto node = std::make_shared<PrintLastPositionNode>();
    
    rclcpp::executors::MultiThreadedExecutor executor;
    executor.add_node(node);
    executor.spin();
    
    rclcpp::shutdown();
    return 0;
}
