#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/string.hpp>
#include <std_srvs/srv/trigger.hpp>

#include <controller_manager_msgs/srv/list_controllers.hpp>
#include <yaml-cpp/yaml.h>
#include <rcpputils/filesystem_helper.hpp>

#include <chrono>
#include <sstream>
#include <vector>
#include <set>
#include <unordered_map>

using namespace std::chrono_literals;
using ListControllersSrv = controller_manager_msgs::srv::ListControllers;
using TriggerSrv = std_srvs::srv::Trigger;

/* ================= DATA STRUCT ================= */

struct NodeEntry
{
  std::string display_name;   // Human-readable name
  std::string ros_name;       // Actual ROS node name
};

/* ================= NODE CLASS ================= */

class StartupMonitorNode : public rclcpp::Node
{
public:
  StartupMonitorNode()
  : Node("startup_monitor_node")
  {
    load_yaml_config();

    /* ---- Publishers ---- */
    active_pub_  = create_publisher<std_msgs::msg::String>(
      "/active_nodes_report", 10);
    missing_pub_ = create_publisher<std_msgs::msg::String>(
      "/inactive_nodes_report", 10);
    extra_pub_   = create_publisher<std_msgs::msg::String>(
      "/extra_nodes_report", 10);

    /* ---- Controller Manager Client ---- */
    controller_client_ =
      create_client<ListControllersSrv>("/controller_manager/list_controllers");

    /* ---- Services ---- */
    start_srv_ = create_service<TriggerSrv>(
      "monitoring_start",
      std::bind(&StartupMonitorNode::startMonitoring, this,
                std::placeholders::_1, std::placeholders::_2));

    stop_srv_ = create_service<TriggerSrv>(
      "monitoring_stop",
      std::bind(&StartupMonitorNode::stopMonitoring, this,
                std::placeholders::_1, std::placeholders::_2));

    /* ---- Timer ---- */
    timer_ = create_wall_timer(
      2s, std::bind(&StartupMonitorNode::tick, this));

    RCLCPP_DEBUG(
      get_logger(),
      "[DEBUG] Node started | startup monitoring enabled");
  }

private:
  /* ================= YAML LOAD ================= */

  void load_yaml_config()
  {
    const std::string path =
      "/home/nextup/user_config_files/ros_node_controller_monitor/monitor.yaml";

    if (!rcpputils::fs::exists(path))
      throw std::runtime_error("monitor.yaml not found");

    YAML::Node cfg = YAML::LoadFile(path);

    for (const auto &n : cfg["nodes"])
    {
      nodes_.push_back({
        n["name"].as<std::string>(),
        n["ros_name"].as<std::string>()
      });
    }

    for (const auto &c : cfg["controllers"])
      controllers_.push_back(c["name"].as<std::string>());
  }

  /* ================= TIMER ================= */

  void tick()
  {
    RCLCPP_DEBUG(
      get_logger(),
      "[DEBUG] tick | monitoring=%d startup_done=%d manual_mode=%d",
      monitoring_enabled_, startup_phase_done_, manual_mode_);

    if (!monitoring_enabled_)
      return;

    poll_controllers();
    check_system_state();
  }

  /* ================= CONTROLLER POLL ================= */

  void poll_controllers()
  {
    if (!controller_client_->wait_for_service(1s))
      return;

    auto req = std::make_shared<ListControllersSrv::Request>();

    controller_client_->async_send_request(
      req,
      [this](rclcpp::Client<ListControllersSrv>::SharedFuture future)
      {
        controller_states_.clear();
        for (const auto &c : future.get()->controller)
          controller_states_[c.name] = c.state;
      });
  }

  /* ================= SYSTEM CHECK ================= */

  void check_system_state()
  {
    bool all_ok = true;
    std::ostringstream active, missing, extra;

    auto node_names =
      get_node_graph_interface()->get_node_names();

    /* ---- Expected Nodes ---- */
    std::set<std::string> expected_ros_nodes;
    for (const auto &n : nodes_)
      expected_ros_nodes.insert(n.ros_name);

    for (const auto &n : nodes_)
    {
      bool found = false;
      for (const auto &an : node_names)
      {
        if (an == n.ros_name ||
            (an.size() > n.ros_name.size() &&
             an.compare(an.size() - n.ros_name.size(),
                        n.ros_name.size(), n.ros_name) == 0))
        {
          found = true;
          break;
        }
      }

      if (found)
        active << n.display_name << ", ";
      else
      {
        missing << n.display_name << ", ";
        all_ok = false;
      }
    }

    /* ---- Extra Nodes ---- */
    for (const auto &an : node_names)
    {
      bool expected = false;
      for (const auto &en : expected_ros_nodes)
      {
        if (an == en ||
            (an.size() > en.size() &&
             an.compare(an.size() - en.size(), en.size(), en) == 0))
        {
          expected = true;
          break;
        }
      }

      if (!expected && an != "/startup_monitor_node")
        extra << an << ", ";
    }

    /* ---- Controllers ---- */
    if (controller_states_.empty())
    {
      all_ok = false;
    }
    else
    {
      for (const auto &c : controllers_)
      {
        auto it = controller_states_.find(c);
        if (it != controller_states_.end() && it->second == "active")
          active << c << ", ";
        else
        {
          missing << c << ", ";
          all_ok = false;
        }
      }
    }

    auto clean = [](std::ostringstream &oss) {
      std::string s = oss.str();
      if (s.size() >= 2) s.erase(s.size() - 2);
      return s;
    };

    publish(clean(active), clean(missing), clean(extra));

    /* ---- AUTO STOP (STARTUP MODE ONLY) ---- */
    if (all_ok && !startup_phase_done_ && !manual_mode_)
    {
      RCLCPP_DEBUG(
        get_logger(),
        "[DEBUG] Startup verification complete → auto-stop publishing");

      startup_phase_done_ = true;
      monitoring_enabled_ = false;
    }

    if (!all_ok)
      startup_phase_done_ = false;
  }

  /* ================= PUBLISH ================= */

  void publish(const std::string &a,
               const std::string &m,
               const std::string &e)
  {
    std_msgs::msg::String msg;

    // Active
    if (!a.empty())
    {
      msg.data = a;
      active_pub_->publish(msg);
    }

    // Missing / inactive
    msg.data = m.empty() ? "none" : m;
    missing_pub_->publish(msg);

    // Extra ROS nodes
    msg.data = e.empty() ? "none" : e;
    extra_pub_->publish(msg);
  }

  /* ================= SERVICES ================= */

  void startMonitoring(const TriggerSrv::Request::SharedPtr,
                       TriggerSrv::Response::SharedPtr res)
  {
    monitoring_enabled_ = true;
    startup_phase_done_ = false;
    manual_mode_ = true;

    RCLCPP_DEBUG(
      get_logger(),
      "[DEBUG] monitoring_start → manual monitoring enabled");

    res->success = true;
    res->message = "start successfully";
  }

  void stopMonitoring(const TriggerSrv::Request::SharedPtr,
                      TriggerSrv::Response::SharedPtr res)
  {
    monitoring_enabled_ = false;
    manual_mode_ = false;

    RCLCPP_DEBUG(
      get_logger(),
      "[DEBUG] monitoring_stop → monitoring disabled");

    res->success = true;
    res->message = "stop successfully";
  }

  /* ================= MEMBERS ================= */

  std::vector<NodeEntry> nodes_;
  std::vector<std::string> controllers_;
  std::unordered_map<std::string, std::string> controller_states_;

  bool monitoring_enabled_ = true;     // auto-start
  bool startup_phase_done_ = false;
  bool manual_mode_ = false;

  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr active_pub_;
  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr missing_pub_;
  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr extra_pub_;

  rclcpp::Service<TriggerSrv>::SharedPtr start_srv_;
  rclcpp::Service<TriggerSrv>::SharedPtr stop_srv_;

  rclcpp::Client<ListControllersSrv>::SharedPtr controller_client_;
  rclcpp::TimerBase::SharedPtr timer_;
};

/* ================= MAIN ================= */

int main(int argc, char **argv)
{
  rclcpp::init(argc, argv);
  rclcpp::spin(std::make_shared<StartupMonitorNode>());
  return 0;
}
