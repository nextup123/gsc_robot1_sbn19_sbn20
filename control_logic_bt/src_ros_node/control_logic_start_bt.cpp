#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/string.hpp>
#include <csignal>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#include <dirent.h>
#include <fstream>
#include <string>
#include <cstring>

class ProcessManagerControlLogicNode : public rclcpp::Node
{
public:
    ProcessManagerControlLogicNode() : Node("process_manager_control_logic_bt"), child_pid_(-1)
    {
        control_sub_ = this->create_subscription<std_msgs::msg::String>(
            "/control_process_control_bt", 10,
            std::bind(&ProcessManagerControlLogicNode::onControl, this, std::placeholders::_1));

        status_pub_ = this->create_publisher<std_msgs::msg::String>("/control_process_control_bt_status", 10);

        timer_ = this->create_wall_timer(
            std::chrono::seconds(1),
            std::bind(&ProcessManagerControlLogicNode::publishStatus, this));

        RCLCPP_INFO(this->get_logger(), 
            "ProcessManagerControlLogicNode ready. Use /control_process_control_bt with 'start' or 'stop'. Status on /control_process_control_bt_status");
    }

private:
    void onControl(const std_msgs::msg::String::SharedPtr msg)
    {
        std::string cmd = msg->data;

        if (cmd == "start")
        {
            if (child_pid_ > 0)
            {
                RCLCPP_WARN(this->get_logger(), 
                    "Process already running (PID=%d). Ignoring start.", child_pid_);
                return;
            }

            RCLCPP_INFO(this->get_logger(), 
                "Starting process: ros2 run control_logic_bt control_logic_bt_runner");

            pid_t pid = fork();
            if (pid == 0)
            {
                setpgid(0, 0); // new process group
                execlp("ros2", "ros2", "run", "control_logic_bt", "control_logic_bt_runner", (char *)NULL);
                _exit(1);
            }
            else if (pid > 0)
            {
                child_pid_ = pid;
                setpgid(pid, pid);
                RCLCPP_INFO(this->get_logger(), "Started process with PID=%d", child_pid_);
            }
            else
            {
                RCLCPP_ERROR(this->get_logger(), "Failed to fork process!");
            }
        }
        else if (cmd == "stop")
        {
            if (child_pid_ > 0)
            {
                RCLCPP_INFO(this->get_logger(), 
                    "Stopping process group with PGID=%d", child_pid_);
                kill(-child_pid_, SIGTERM);
                waitpid(child_pid_, nullptr, 0);
                RCLCPP_INFO(this->get_logger(), "Process stopped cleanly (PID=%d)", child_pid_);
                child_pid_ = -1;
            }
            else
            {
                RCLCPP_INFO(this->get_logger(), "No managed process to stop.");
            }

            // cleanup stray processes
            cleanupStrayProcesses();
        }
        else
        {
            RCLCPP_WARN(this->get_logger(),
                        "Unknown command: '%s'. Use 'start' or 'stop'.", cmd.c_str());
        }

        publishStatus();
    }

    void publishStatus()
    {
        std_msgs::msg::String status_msg;

        if (child_pid_ > 0)
        {
            if (kill(child_pid_, 0) == 0)
            {
                status_msg.data = "RUNNING (PID=" + std::to_string(child_pid_) + ")";
            }
            else
            {
                RCLCPP_WARN(this->get_logger(), 
                            "Managed process (PID=%d) not alive anymore. Clearing state.", child_pid_);
                child_pid_ = -1;
                status_msg.data = "STOPPED (unexpected exit)";
            }
        }
        else
        {
            status_msg.data = "STOPPED";
        }

        status_pub_->publish(status_msg);
    }

    void cleanupStrayProcesses()
    {
        DIR* dir = opendir("/proc");
        if (!dir) {
            RCLCPP_ERROR(this->get_logger(), "Failed to open /proc");
            return;
        }

        struct dirent* entry;
        while ((entry = readdir(dir)) != nullptr) {
            if (entry->d_type != DT_DIR) continue;

            pid_t pid = atoi(entry->d_name);
            if (pid <= 0) continue;

            std::string cmdline_path = std::string("/proc/") + entry->d_name + "/cmdline";
            std::ifstream cmd_file(cmdline_path);
            if (!cmd_file.is_open()) continue;

            std::string cmdline;
            std::getline(cmd_file, cmdline, '\0');
            cmd_file.close();

            if (cmdline.find("control_logic_bt_runner") != std::string::npos) {
                RCLCPP_WARN(this->get_logger(),
                            "Force killing stray process PID=%d (%s)",
                            pid, cmdline.c_str());

                kill(pid, SIGKILL);
                waitpid(pid, nullptr, WNOHANG);
            }
        }
        closedir(dir);
    }

    rclcpp::Subscription<std_msgs::msg::String>::SharedPtr control_sub_;
    rclcpp::Publisher<std_msgs::msg::String>::SharedPtr status_pub_;
    rclcpp::TimerBase::SharedPtr timer_;
    pid_t child_pid_;
};

int main(int argc, char **argv)
{
    rclcpp::init(argc, argv);
    rclcpp::spin(std::make_shared<ProcessManagerControlLogicNode>());
    rclcpp::shutdown();
    return 0;
}
