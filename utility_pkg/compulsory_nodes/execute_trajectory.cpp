#include <rclcpp/rclcpp.hpp>
#include <yaml-cpp/yaml.h>
#include <std_msgs/msg/string.hpp>
#include <std_msgs/msg/bool.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <trajectory_msgs/msg/joint_trajectory.hpp>
#include <control_msgs/action/follow_joint_trajectory.hpp>
#include <rclcpp_action/rclcpp_action.hpp>
#include <filesystem>
#include <chrono>
#include <thread>
#include <mutex>
#include <atomic>
#include <unordered_map>
#include <vector>
#include <string>
#include <sstream>
#include <iomanip>

using FollowJointTrajectory = control_msgs::action::FollowJointTrajectory;
using GoalHandleFJT = rclcpp_action::ClientGoalHandle<FollowJointTrajectory>;
using String = std_msgs::msg::String;
using Bool = std_msgs::msg::Bool;
using JointState = sensor_msgs::msg::JointState;
using JointTrajectoryPoint = trajectory_msgs::msg::JointTrajectoryPoint;

namespace fs = std::filesystem;

class ExecuteTrajectory : public rclcpp::Node
{
public:
    ExecuteTrajectory() : Node("execute_trajectory_node")
    {
        this->declare_parameter<std::string>("yaml_file_path", "/home/nextup/NextupRobot/src/active_project_configs/planning_data/paths.yaml");
        yaml_file_path_ = this->get_parameter("yaml_file_path").as_string();

        RCLCPP_INFO(this->get_logger(), "Starting ExecuteTrajectory node...");
        RCLCPP_INFO(this->get_logger(), "YAML Path: %s", yaml_file_path_.c_str());

        initializeFileWatcher();
        loadTrajectory();

        traj_action_client_ = rclcpp_action::create_client<FollowJointTrajectory>(
            this, "/robot_manipulator_controller/follow_joint_trajectory");

        RCLCPP_INFO(this->get_logger(), "Waiting for action server...");
        if (!traj_action_client_->wait_for_action_server(std::chrono::seconds(5)))
        {
            RCLCPP_ERROR(this->get_logger(), "Action server not available!");
        }
        else
        {
            RCLCPP_INFO(this->get_logger(), "Action server connected!");
        }

        section_sub_ = this->create_subscription<String>(
            "/path_with_velocity_scale", 10,
            [this](const String::SharedPtr msg)
            { sectionCallback(msg); });

        reload_yaml_sub_ = this->create_subscription<Bool>(
            "/reload_yaml_execute_trajectory", 10,
            [this](const Bool::SharedPtr msg)
            {
                if (msg->data)
                {
                    RCLCPP_INFO(this->get_logger(), "Reload command → reloading paths.yaml");
                    loadTrajectory();
                }
            });

        joint_state_sub_ = this->create_subscription<JointState>(
            "/joint_states", 10,
            [this](const JointState::SharedPtr msg)
            {
                std::lock_guard<std::mutex> lock(joint_state_mutex_);
                joint_state_data_ = *msg;
            });

        status_pub_ = this->create_publisher<String>("/running_path_status", 10);
        path_names_pub_ = this->create_publisher<String>("/read_paths_from_yaml_file", 10);
        bt_popup_pub_ = this->create_publisher<String>("/bt_toast_popup", 10);
        logs_pub_ = this->create_publisher<String>("/logs_topic", 10);

        status_timer_ = this->create_wall_timer(
            std::chrono::milliseconds(100),
            [this]()
            { publishStatus(); });

        path_names_timer_ = this->create_wall_timer(
            std::chrono::seconds(2),
            [this]()
            { publishPathNames(); });

        RCLCPP_INFO(this->get_logger(), "Node ready. Send 'p1_p2,1.0' to start.");
        publishPathNames();
    }

private:
    struct TrajectoryPoint
    {
        std::vector<double> positions;
        std::vector<double> velocities;
        std::vector<double> accelerations;
    };

    struct PathData
    {
        std::string name;
        std::string plan_space;
        std::string start_point;
        std::string end_point;
        std::vector<TrajectoryPoint> data;
    };

    // ROS
    rclcpp_action::Client<FollowJointTrajectory>::SharedPtr traj_action_client_;
    rclcpp::Subscription<String>::SharedPtr section_sub_;
    rclcpp::Subscription<Bool>::SharedPtr reload_yaml_sub_;
    rclcpp::Subscription<JointState>::SharedPtr joint_state_sub_;
    rclcpp::Publisher<String>::SharedPtr status_pub_;
    rclcpp::Publisher<String>::SharedPtr path_names_pub_;
    rclcpp::Publisher<String>::SharedPtr bt_popup_pub_;
    rclcpp::Publisher<String>::SharedPtr logs_pub_;
    rclcpp::TimerBase::SharedPtr status_timer_;
    rclcpp::TimerBase::SharedPtr path_names_timer_;
    rclcpp::TimerBase::SharedPtr file_watcher_timer_;

    // Data
    std::unordered_map<std::string, PathData> path_map_;
    std::vector<std::string> path_names_in_order_;
    std::string current_path_name_;
    std::string current_status_;
    JointState joint_state_data_;
    std::string yaml_file_path_;
    fs::file_time_type last_mod_time_;

    // Sync
    std::mutex path_mutex_;
    std::mutex status_mutex_;
    std::mutex joint_state_mutex_;
    std::atomic<bool> trajectory_in_progress_{false};

    // === FILE WATCHER ===
    void initializeFileWatcher()
    {
        if (!fs::exists(yaml_file_path_))
        {
            RCLCPP_ERROR(this->get_logger(), "YAML file not found: %s", yaml_file_path_.c_str());
            return;
        }
        last_mod_time_ = fs::last_write_time(yaml_file_path_);
        file_watcher_timer_ = this->create_wall_timer(
            std::chrono::seconds(1),
            [this]()
            { checkFileChanges(); });
        RCLCPP_INFO(this->get_logger(), "Watching: %s", yaml_file_path_.c_str());
    }

    void checkFileChanges()
    {
        if (!fs::exists(yaml_file_path_))
            return;
        auto mod = fs::last_write_time(yaml_file_path_);
        if (mod != last_mod_time_)
        {
            RCLCPP_WARN(this->get_logger(), "YAML changed → reloading...");
            loadTrajectory();
            last_mod_time_ = mod;
        }
    }

    // === LOAD YAML ===
    void loadTrajectory()
    {
        std::lock_guard<std::mutex> lock(path_mutex_);
        RCLCPP_INFO(this->get_logger(), "Loading paths...");

        path_map_.clear();
        path_names_in_order_.clear();

        try
        {
            YAML::Node root = YAML::LoadFile(yaml_file_path_);
            if (!root["paths"] || !root["paths"].IsSequence())
            {
                RCLCPP_ERROR(this->get_logger(), "Invalid YAML: missing 'paths'");
                return;
            }

            for (const auto &path_node : root["paths"])
            {
                PathData path;
                path.name = path_node["name"].as<std::string>();
                path.plan_space = path_node["plan_space"] ? path_node["plan_space"].as<std::string>() : "N/A";
                path.start_point = path_node["start_point"] ? path_node["start_point"].as<std::string>() : "N/A";
                path.end_point = path_node["end_point"] ? path_node["end_point"].as<std::string>() : "N/A";

                if (!path_node["data"] || path_node["data"].size() == 0)
                {
                    RCLCPP_WARN(this->get_logger(), "Path '%s' has no data", path.name.c_str());
                    continue;
                }

                for (const auto &point_node : path_node["data"])
                {
                    TrajectoryPoint p;
                    p.positions = point_node["positions"].as<std::vector<double>>();
                    p.velocities = point_node["velocities"].as<std::vector<double>>();
                    p.accelerations = point_node["accelerations"].as<std::vector<double>>();
                    path.data.push_back(p);
                }

                path_map_[path.name] = path;
                path_names_in_order_.push_back(path.name);
            }

            RCLCPP_INFO(this->get_logger(), "Loaded %zu paths: [%s]",
                        path_names_in_order_.size(), join(path_names_in_order_, ", ").c_str());
        }
        catch (const std::exception &e)
        {
            RCLCPP_ERROR(this->get_logger(), "YAML error: %s", e.what());
        }
    }

    // === CALLBACK ===
    void sectionCallback(const String::SharedPtr msg)
    {
        RCLCPP_INFO(this->get_logger(), "Command: '%s'", msg->data.c_str());

        if (trajectory_in_progress_)
        {
            RCLCPP_WARN(this->get_logger(), "Already running. Ignoring new command.");
            return;
        }

        size_t comma = msg->data.find(',');
        if (comma == std::string::npos)
        {
            RCLCPP_ERROR(this->get_logger(), "Invalid format: '%s'", msg->data.c_str());
            sendPopup("Invalid format", "failure", 0);
            logsPopup("Invalid format", "failure", 0);
            return;
        }

        std::string name = msg->data.substr(0, comma);
        double speed = 1.0;
        try
        {
            speed = std::clamp(std::stod(msg->data.substr(comma + 1)), 0.01, 3.0);
        }
        catch (...)
        {
            speed = 1.0;
        }

        std::lock_guard<std::mutex> lock(path_mutex_);
        auto it = path_map_.find(name);
        if (it == path_map_.end())
        {
            RCLCPP_ERROR(this->get_logger(), "Path '%s' NOT FOUND!", name.c_str());
            sendPopup("Path not found", "failure", 0);
            logsPopup("Path not found", "failure", 0);
            return;
        }

        // Always use the latest joint state data before starting
        {
            std::lock_guard<std::mutex> jlock(joint_state_mutex_);
            if (joint_state_data_.position.empty())
            {
                RCLCPP_WARN(this->get_logger(), "No joint state data yet. Ignoring command.");
                return;
            }
        }

        RCLCPP_INFO(this->get_logger(), "Executing '%s' at speed %.2f", name.c_str(), speed);
        std::thread(&ExecuteTrajectory::executePath, this, it->second, speed).detach();
    }

    // === EXECUTE PATH ===
    void executePath(const PathData &path, double speed_multiplier)
    {
        // Always recheck current position before executing this path
        if (!checkStartPosition(path.data.front().positions))
        {
            RCLCPP_WARN(this->get_logger(), "Start position mismatch for '%s'!", path.name.c_str());
            sendPopup("Start position mismatch!", "warn", 20);
            setStatus("aborted");
            return;
        }

        trajectory_in_progress_ = true;
        setStatus("running");
        current_path_name_ = path.name;

        auto goal = FollowJointTrajectory::Goal();
        goal.trajectory.joint_names = {"joint1", "joint2", "joint3", "joint4", "joint5", "joint6"};
        goal.trajectory.header.stamp = rclcpp::Time(0);
        // goal.trajectory.header.stamp = this->now();

        double time = 0.0;
        const double dt = 0.1;

        for (const auto &pt : path.data)
        {
            time += dt / speed_multiplier;
            JointTrajectoryPoint tp;
            tp.positions = pt.positions;
            tp.time_from_start = rclcpp::Duration::from_seconds(time);

            tp.velocities.resize(pt.velocities.size());
            std::transform(pt.velocities.begin(), pt.velocities.end(), tp.velocities.begin(),
                           [speed_multiplier](double v)
                           { return v * speed_multiplier; });

            tp.accelerations.resize(pt.accelerations.size());
            std::transform(pt.accelerations.begin(), pt.accelerations.end(), tp.accelerations.begin(),
                           [speed_multiplier](double a)
                           { return a * speed_multiplier * speed_multiplier; });

            goal.trajectory.points.push_back(tp);
        }

        auto send_goal_options = rclcpp_action::Client<FollowJointTrajectory>::SendGoalOptions();
        send_goal_options.result_callback = [this, path_name = path.name, end_pos = path.data.back().positions](const GoalHandleFJT::WrappedResult &result)
        {
            trajectory_in_progress_ = false;

            bool controller_ok = (result.code == rclcpp_action::ResultCode::SUCCEEDED);
            bool position_ok = false;

            {
                std::lock_guard<std::mutex> lock(joint_state_mutex_);
                if (joint_state_data_.position.size() == end_pos.size())
                {
                    position_ok = true;
                    std::this_thread::sleep_for(std::chrono::milliseconds(100));

                    for (size_t i = 0; i < end_pos.size(); ++i)
                    {
                        if (std::abs(joint_state_data_.position[i] - end_pos[i]) > 0.08)
                        {
                            position_ok = false;
                            break;
                        }
                    }
                }
            }

            if (controller_ok && position_ok)
            {
                setStatus("completed");
                logsPopup(path_name + " completed", "success", 5);
                RCLCPP_INFO(this->get_logger(), "Path '%s' completed successfully and verified.", path_name.c_str());
            }
            else
            {
                setStatus("failed");
                std::string reason = controller_ok ? "End position mismatch!" : "Controller failed!";
                sendPopup(path_name + " " + reason, "failure", 0);
                logsPopup(path_name + " " + reason, "failure", 0);
                RCLCPP_ERROR(this->get_logger(), "Path '%s' failed: %s", path_name.c_str(), reason.c_str());
            }
        };

        RCLCPP_INFO(this->get_logger(), "Sending goal for '%s'...", path.name.c_str());
        traj_action_client_->async_send_goal(goal, send_goal_options);
    }

    // === POSITION CHECK ===
    bool checkStartPosition(const std::vector<double> &target)
    {
        std::lock_guard<std::mutex> lock(joint_state_mutex_);
        if (joint_state_data_.position.size() != target.size())
            return false;
        for (size_t i = 0; i < target.size(); ++i)
            if (std::abs(joint_state_data_.position[i] - target[i]) > 0.08)
                return false;
        return true;
    }

    // === STATUS & POPUP ===
    void setStatus(const std::string &status)
    {
        std::lock_guard<std::mutex> lock(status_mutex_);
        current_status_ = status;
    }

    void publishStatus()
    {
        std::lock_guard<std::mutex> lock(status_mutex_);
        if (!current_path_name_.empty() && !current_status_.empty())
        {
            String msg;
            msg.data = current_status_ + "," + current_path_name_;
            status_pub_->publish(msg);
        }
    }

    void sendPopup(const std::string &msg, const std::string &type, int timeout)
    {
        String popup;
        popup.data = msg + "," + type + "," + std::to_string(timeout);
        bt_popup_pub_->publish(popup);
    }


    void logsPopup(const std::string &msg, const std::string &type, int timeout)
    {
        String popup;
        popup.data = msg + "," + type + "," + std::to_string(timeout);
        logs_pub_->publish(popup);
    }

    void publishPathNames()
    {
        std::lock_guard<std::mutex> lock(path_mutex_);
        String msg;
        for (size_t i = 0; i < path_names_in_order_.size(); ++i)
        {
            if (i > 0)
                msg.data += ", ";
            msg.data += path_names_in_order_[i];
        }
        path_names_pub_->publish(msg);
    }

    std::string join(const std::vector<std::string> &v, const std::string &delim)
    {
        std::stringstream ss;
        for (size_t i = 0; i < v.size(); ++i)
        {
            if (i > 0)
                ss << delim;
            ss << v[i];
        }
        return ss.str();
    }
};

int main(int argc, char **argv)
{
    rclcpp::init(argc, argv);
    auto node = std::make_shared<ExecuteTrajectory>();
    rclcpp::executors::MultiThreadedExecutor exec;
    exec.add_node(node);
    exec.spin();
    rclcpp::shutdown();
    // return 0;
}
