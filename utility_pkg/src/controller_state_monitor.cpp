#include <rclcpp/rclcpp.hpp>
#include <controller_manager_msgs/srv/list_controllers.hpp>
#include <std_srvs/srv/trigger.hpp>
#include <yaml-cpp/yaml.h>

#include <chrono>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <unordered_map>
#include <vector>
#include <set>

using namespace std::chrono_literals;
using ListControllersSrv = controller_manager_msgs::srv::ListControllers;

class ControllerDashboard : public rclcpp::Node
{
public:
    ControllerDashboard() : Node("controller_dashboard")
    {
        client_ = this->create_client<ListControllersSrv>("/controller_manager/list_controllers");
        timer_ = this->create_wall_timer(2s, std::bind(&ControllerDashboard::poll, this));
        output_path_ = "/home/nextup/user_config_files/controller_diagnosis/controller_dashboard.yaml";

        
        live_feed_service_ = this->create_service<std_srvs::srv::Trigger>(
            "/controller_live_feed",
            std::bind(&ControllerDashboard::handle_live_feed, this, std::placeholders::_1, std::placeholders::_2));

        RCLCPP_INFO(this->get_logger(), "Controller Dashboard Started → %s", output_path_.c_str());
        RCLCPP_INFO(this->get_logger(), "Service /controller_live_feed is READY → call anytime for instant live update!");
    }

private:
    
    void handle_live_feed(
        const std::shared_ptr<std_srvs::srv::Trigger::Request>,
        std::shared_ptr<std_srvs::srv::Trigger::Response> res)
    {
        // RCLCPP_INFO(this->get_logger(), "/controller_live_feed called → Forcing LIVE update with accurate uptime!");
        force_refresh_requested_ = true;   
        poll();
        res->success = true;
        res->message = "Live refresh forced — latest uptime & status updated!";
    }

    void poll()
    {
        if (!client_->wait_for_service(1s)) {
            // RCLCPP_WARN_THROTTLE(this->get_logger(), *this->get_clock(), 5000, "Waiting for controller_manager...");
            return;
        }

        auto req = std::make_shared<ListControllersSrv::Request>();
        client_->async_send_request(req, [this](rclcpp::Client<ListControllersSrv>::SharedFuture future) {
            try {
                processControllerList(future.get()->controller);
            } catch (...) {
                // RCLCPP_ERROR(this->get_logger(), "Service call failed");
            }
        });
    }

    void processControllerList(const std::vector<controller_manager_msgs::msg::ControllerState>& controllers)
    {
        std::vector<std::string> active, inactive;
        bool changed = false;
        std::string latest_act, latest_deact;
        auto now = this->now();
        auto now_str = humanTime(now);

        controller_map_.clear();
        for (const auto& c : controllers) {
            controller_map_[c.name] = c;
        }

        for (const auto& c : controllers) {
            std::string name = c.name;
            std::string state = c.state;

            auto it = last_state_.find(name);
            if (it == last_state_.end() || it->second != state) {
                last_change_[name] = now;
                human_change_time_[name] = now_str;
                changed = true;
                if (it != last_state_.end()) {
                    if (state == "active") latest_act = name;
                    else latest_deact = name;
                }
            }
            last_state_[name] = state;
            (state == "active" ? active : inactive).push_back(name);
        }

        // KEY FIX: Force update when service is called
        bool force_update = force_refresh_requested_;
        force_refresh_requested_ = false;

        if (!changed && !first_run_ && !force_update) {
            return;  
        }
        first_run_ = false;

        saveYaml(active, inactive, latest_act, latest_deact, now_str);
    }

    void saveYaml(const std::vector<std::string>& active,
                  const std::vector<std::string>& inactive,
                  const std::string& latest_act,
                  const std::string& latest_deact,
                  const std::string& now_str)
    {
        YAML::Node root;

        root["system_status"]["active_controllers"]   = static_cast<int>(active.size());
        root["system_status"]["inactive_controllers"] = static_cast<int>(inactive.size());
        root["system_status"]["digital_outputs"]      = "0/6 active";
        root["system_status"]["last_update"]          = now_str;

        for (const auto& name : active) {
            std::string e = name;
            if (!latest_act.empty() && name == latest_act)
                e += "  <-- latest activated";
            root["system_status"]["active_list"].push_back(e);
        }

        for (const auto& name : inactive) {
            std::string e = name;
            if (!latest_deact.empty() && name == latest_deact)
                e += "  <-- latest deactivated";
            root["system_status"]["inactive_list"].push_back(e);
        }

        root["controller_details"];
        YAML::Node details = root["controller_details"];

        for (const auto& name : active) {
            const auto& c = controller_map_[name];
            auto interfaces = extractInterfaces(c.claimed_interfaces);
            auto joints = extractJoints(c.claimed_interfaces);

            details[name]["state"]              = "active";
            details[name]["last_state_change"]  = human_change_time_[name];
            details[name]["claimed_interfaces"] = formatInterfaces(interfaces);
            details[name]["uptime"]             = formatDuration(this->now() - last_change_[name]);

            if (joints.empty()) {
                details[name]["claimed_hardware"] = "none";
            } else {
                YAML::Node joint_list;
                for (const auto& j : joints) joint_list.push_back(j);
                details[name]["claimed_hardware"] = joint_list;
            }
        }

        for (const auto& name : inactive) {
            details[name]["state"]              = "inactive";
            details[name]["last_state_change"]  = human_change_time_[name];
            details[name]["claimed_interfaces"] = "none";
            details[name]["claimed_hardware"]   = "N/A";
            details[name]["uptime"]             = "N/A";
        }

        std::ofstream ofs(output_path_);
        if (ofs) {
            ofs << root;
            // RCLCPP_INFO(this->get_logger(), "YAML updated → %s", output_path_.c_str());
        }
    }

    std::vector<std::string> extractInterfaces(const std::vector<std::string>& claimed)
    {
        std::set<std::string> types;
        for (const auto& s : claimed) {
            size_t pos = s.find('/');
            if (pos != std::string::npos) {
                types.insert(s.substr(pos + 1));
            }
        }
        return {types.begin(), types.end()};
    }

    std::vector<std::string> extractJoints(const std::vector<std::string>& claimed)
    {
        std::set<std::string> joints;
        for (const auto& s : claimed) {
            size_t pos = s.find('/');
            if (pos != std::string::npos) {
                joints.insert(s.substr(0, pos));
            }
        }
        return {joints.begin(), joints.end()};
    }

    std::string formatInterfaces(const std::vector<std::string>& ifaces)
    {
        if (ifaces.empty()) return "none";
        std::ostringstream oss;
        for (size_t i = 0; i < ifaces.size(); ++i) {
            if (i > 0) oss << ", ";
            oss << ifaces[i];
        }
        return oss.str();
    }

    std::string formatDuration(const rclcpp::Duration& d)
    {
        int64_t secs = static_cast<int64_t>(d.seconds());
        int64_t h = secs / 3600;
        int64_t m = (secs / 60) % 60;
        int64_t s = secs % 60;

        std::ostringstream oss;
        oss << std::setfill('0') << std::setw(2) << m << "m "
            << std::setw(2) << s << "s";
        if (h > 0) oss << " (" << h << "h)";
        return oss.str();
    }

    std::string humanTime(const rclcpp::Time& t)
    {
        std::time_t time = static_cast<std::time_t>(t.seconds());
        std::ostringstream ss;
        ss << std::put_time(std::localtime(&time), "%Y-%m-%d %H:%M:%S");
        return ss.str();
    }


    rclcpp::Client<ListControllersSrv>::SharedPtr client_;
    rclcpp::TimerBase::SharedPtr timer_;
    rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr live_feed_service_;
    std::string output_path_ = "/home/nextup/user_config_files/controller_diagnosis/controller_dashboard.yaml";

    std::unordered_map<std::string, std::string> last_state_;
    std::unordered_map<std::string, rclcpp::Time> last_change_;
    std::unordered_map<std::string, std::string> human_change_time_;
    std::unordered_map<std::string, controller_manager_msgs::msg::ControllerState> controller_map_;

    bool first_run_ = true;
    bool force_refresh_requested_ = false;  
};

int main(int argc, char** argv)
{
    rclcpp::init(argc, argv);
    rclcpp::spin(std::make_shared<ControllerDashboard>());
    rclcpp::shutdown();
    return 0;
}