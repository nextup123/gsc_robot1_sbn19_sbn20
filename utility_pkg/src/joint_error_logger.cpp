#include <rclcpp/rclcpp.hpp>
#include <nextup_joint_interfaces/msg/nextup_joint_state.hpp>

#include <yaml-cpp/yaml.h>

#include <filesystem>
#include <fstream>
#include <chrono>
#include <iomanip>
#include <sstream>
#include <cmath>
#include <unordered_map>
#include <mutex>

namespace fs = std::filesystem;
using namespace std::chrono_literals;

class JointErrorLogger : public rclcpp::Node
{
public:
    JointErrorLogger()
        : Node("joint_error_logger")
    {
        log_file_path_ =
            "/home/nextup/user_config_files/error_container/error_logs.yaml";

        ensureFileExists();
        loadYamlOnce();

        sub_ = this->create_subscription<
            nextup_joint_interfaces::msg::NextupJointState>(
            "/nextup_joint_states",
            10,
            std::bind(&JointErrorLogger::callback, this, std::placeholders::_1));

        flush_timer_ = this->create_wall_timer(
            1s,
            std::bind(&JointErrorLogger::flushToDisk, this));

        RCLCPP_INFO(this->get_logger(),
                    "Joint Error Logger started (optimized, low CPU)");
    }

private:
    // ROS
    rclcpp::Subscription<
        nextup_joint_interfaces::msg::NextupJointState>::SharedPtr sub_;
    rclcpp::TimerBase::SharedPtr flush_timer_;

    // File
    std::string log_file_path_;

    // State
    YAML::Node root_;
    std::unordered_map<std::string, double> last_errors_;
    std::mutex mutex_;
    bool dirty_{false};

    // ================= CALLBACK =================

    void callback(
        const nextup_joint_interfaces::msg::NextupJointState::SharedPtr msg)
    {
        if (msg->name.size() != msg->lasterror.size())
        {
            RCLCPP_ERROR(this->get_logger(),
                         "name[] and lasterror[] size mismatch");
            return;
        }

        const std::string time_str = nowAsString();

        std::lock_guard<std::mutex> lock(mutex_);

        for (size_t i = 0; i < msg->name.size(); ++i)
        {
            const std::string &joint = msg->name[i];
            const double new_error = msg->lasterror[i];

            double old_error = NAN;
            if (last_errors_.count(joint))
                old_error = last_errors_[joint];

            if (sameError(old_error, new_error))
                continue;

            YAML::Node entry;
            entry["time"] = time_str;
            entry["joint"] = joint;

            // FIXED (no ternary type issue)
            if (std::isnan(new_error))
            {
                entry["last_error"] = "nan";
            }
            else
            {
                entry["last_error"] = new_error;
            }

            root_["error_logs"].push_back(entry);
            last_errors_[joint] = new_error;
            dirty_ = true;

            // RCLCPP_WARN(this->get_logger(),
            //             "Error change | %s : %s → %s",
            //             joint.c_str(),
            //             errorToString(old_error).c_str(),
            //             errorToString(new_error).c_str());
        }
    }

    // ================= TIMER =================

    void flushToDisk()
    {
        std::lock_guard<std::mutex> lock(mutex_);

        if (!dirty_)
            return;

        std::ofstream fout(log_file_path_, std::ios::out | std::ios::trunc);
        if (!fout.is_open())
        {
            RCLCPP_ERROR(this->get_logger(),
                         "Failed to open error log file for writing");
            return;
        }

        fout << root_;
        fout.close();

        dirty_ = false;
    }

    // ================= HELPERS =================

    bool sameError(double a, double b)
    {
        if (std::isnan(a) && std::isnan(b))
            return true;
        if (std::isnan(a) || std::isnan(b))
            return false;
        return std::fabs(a - b) < 1e-9;
    }

    std::string errorToString(double v)
    {
        return std::isnan(v) ? "nan" : std::to_string(v);
    }

    void ensureFileExists()
    {
        fs::path file_path(log_file_path_);
        fs::create_directories(file_path.parent_path());

        if (!fs::exists(file_path))
        {
            YAML::Node root;
            root["error_logs"] = YAML::Node(YAML::NodeType::Sequence);
            std::ofstream fout(log_file_path_);
            fout << root;
        }
    }

    void loadYamlOnce()
    {
        try
        {
            root_ = YAML::LoadFile(log_file_path_);
            if (!root_["error_logs"])
                root_["error_logs"] = YAML::Node(YAML::NodeType::Sequence);
        }
        catch (const std::exception &e)
        {
            RCLCPP_ERROR(this->get_logger(),
                         "Failed to load YAML file: %s", e.what());
            root_["error_logs"] = YAML::Node(YAML::NodeType::Sequence);
        }
    }

    std::string nowAsString()
    {
        auto now = std::chrono::system_clock::now();
        auto t = std::chrono::system_clock::to_time_t(now);
        auto ms =
            std::chrono::duration_cast<std::chrono::milliseconds>(
                now.time_since_epoch()) %
            1000;

        std::tm tm{};
        localtime_r(&t, &tm);

        std::stringstream ss;
        ss << std::put_time(&tm, "%d %b %Y | %H:%M:%S")
           << "." << std::setw(3) << std::setfill('0') << ms.count();

        return ss.str();
    }
};

// ================= MAIN =================

int main(int argc, char **argv)
{
    rclcpp::init(argc, argv);
    rclcpp::spin(std::make_shared<JointErrorLogger>());
    rclcpp::shutdown();
    return 0;
}
