#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/string.hpp>
#include <std_msgs/msg/bool.hpp>
#include <std_msgs/msg/int32.hpp>
#include <nextup_joint_interfaces/msg/nextup_emergency_trigger.hpp>

#include <yaml-cpp/yaml.h>

#include <filesystem>
#include <chrono>
#include <thread>
#include <mutex>
#include <unordered_map>
#include <string>
#include <optional>

using namespace std::chrono_literals;

class EmergencyManagerNode : public rclcpp::Node
{
public:
    EmergencyManagerNode(const std::string &yaml_path = "/home/nextup/NextupRobot/src/active_project_configs/emergency_manager.yaml",
                         std::chrono::milliseconds interval = 1000ms)
        : Node("emergency_manager_node"),
          yaml_path_(yaml_path),
          interval_(interval)
    {
        RCLCPP_INFO(this->get_logger(), "Starting EmergencyManagerNode");

        trigger_pub_ = this->create_publisher<nextup_joint_interfaces::msg::NextupEmergencyTrigger>(
            "/nextup_emergency_trigger_controller/commands", 10);

        toast_pub_ = this->create_publisher<std_msgs::msg::String>(
            "/bt_toast_popup", 10);

        try
        {
            loadConfig();
        }
        catch (const std::exception &e)
        {
            RCLCPP_ERROR(this->get_logger(), "Initial YAML load failed: %s", e.what());
        }
        catch (...)
        {
            RCLCPP_ERROR(this->get_logger(), "Unknown error during initial YAML load.");
        }

        watcher_ = std::thread([this]() { watchLoop(); });
    }

    ~EmergencyManagerNode()
    {
        stop_flag_ = true;
        if (watcher_.joinable())
            watcher_.join();
    }

private:
    struct TopicConfig
    {
        std::string yaml_key;
        std::string topic;
        std::string type;
        std::string expected;
        std::string connection;
        bool sent_once = false;
        rclcpp::SubscriptionBase::SharedPtr sub;
    };

    std::string yaml_path_;
    std::optional<std::filesystem::file_time_type> last_write_;
    std::chrono::milliseconds interval_;

    std::unordered_map<std::string, TopicConfig> map_;
    std::mutex lock_;

    std::atomic<bool> stop_flag_{false};
    std::thread watcher_;

    rclcpp::Publisher<nextup_joint_interfaces::msg::NextupEmergencyTrigger>::SharedPtr trigger_pub_;
    rclcpp::Publisher<std_msgs::msg::String>::SharedPtr toast_pub_;

    // ------------------------------------------------------------------
    // FILE WATCHER
    // ------------------------------------------------------------------
    void watchLoop()
    {
        while (!stop_flag_)
        {
            try
            {
                auto now = std::filesystem::last_write_time(yaml_path_);

                if (!last_write_ || now != *last_write_)
                {
                    last_write_ = now;
                    // RCLCPP_INFO(this->get_logger(), "YAML changed – reloading...");

                    try
                    {
                        loadConfig();
                    }
                    catch (const std::exception &e)
                    {
                        // RCLCPP_ERROR(this->get_logger(),
                        //              "Error reloading YAML: %s", e.what());
                    }
                    catch (...)
                    {
                        // RCLCPP_ERROR(this->get_logger(),
                        //              "Unknown error while reloading YAML.");
                    }
                }
            }
            catch (const std::filesystem::filesystem_error &e)
            {
                RCLCPP_ERROR(this->get_logger(),
                             "Filesystem error for YAML watcher: %s", e.what());
            }
            catch (...)
            {
                RCLCPP_ERROR(this->get_logger(),
                             "Unknown error in YAML watcher.");
            }

            std::this_thread::sleep_for(interval_);
        }
    }

    // ------------------------------------------------------------------
    // YAML LOADING
    // ------------------------------------------------------------------
    void loadConfig()
    {
        YAML::Node root;

        try
        {
            YAML::Node file = YAML::LoadFile(yaml_path_);
            if (!file["Emergency Manager"])
            {
                throw std::runtime_error("Missing 'Emergency Manager' root key");
            }
            root = file["Emergency Manager"];
        }
        catch (const YAML::BadFile &e)
        {
            throw std::runtime_error(std::string("Bad YAML file: ") + e.what());
        }
        catch (const YAML::ParserException &e)
        {
            throw std::runtime_error(std::string("YAML parse error: ") + e.what());
        }

        std::unordered_map<std::string, TopicConfig> newmap;

        for (auto it = root.begin(); it != root.end(); ++it)
        {
            std::string yaml_key = it->first.as<std::string>();
            auto node = it->second;

            if (!node["topic_name"] || !node["msg_type"] || !node["data"] || !node["connection"])
            {
                // RCLCPP_ERROR(this->get_logger(),
                //              "Missing required fields in YAML entry '%s'. Skipping.",
                //              yaml_key.c_str());
                continue;
            }

            TopicConfig cfg;
            cfg.yaml_key = yaml_key;

            try
            {
                cfg.topic = node["topic_name"].as<std::string>();
                cfg.type = node["msg_type"].as<std::string>();
                cfg.expected = node["data"].as<std::string>();
                cfg.connection = node["connection"].as<std::string>();
            }
            catch (const std::exception &e)
            {
                // RCLCPP_ERROR(this->get_logger(),
                //              "Type error in YAML entry '%s': %s",
                //              yaml_key.c_str(), e.what());
                continue;
            }

            // normalize connection
            for (auto &c : cfg.connection)
                c = std::tolower(c);

            if (cfg.connection != "always" &&
                cfg.connection != "only-once" &&
                cfg.connection != "no")
            {
                // RCLCPP_WARN(this->get_logger(),
                //             "Invalid connection option '%s' in '%s'. Defaulting to 'no'",
                //             cfg.connection.c_str(), yaml_key.c_str());
                cfg.connection = "no";
            }

            newmap[cfg.topic] = cfg;
        }

        // ----------------- UPDATE EXISTING MAP -----------------
        std::lock_guard<std::mutex> lk(lock_);

        // Remove old topics
        for (auto it = map_.begin(); it != map_.end();)
        {
            if (newmap.find(it->first) == newmap.end())
            {
            it->second.sub.reset();
            it = map_.erase(it);
            }
            else
                ++it;
        }

        // Add / Update new topics
        for (auto &kv : newmap)
        {
            std::string topic = kv.first;
            TopicConfig desired = kv.second;

            if (map_.find(topic) == map_.end())
            {
                map_[topic] = desired;
                if (desired.connection != "no")
                    createSubscriber(map_[topic]);
            }
            else
            {
                auto &current = map_[topic];
                bool recreate = (current.type != desired.type ||
                                 current.connection != desired.connection);

                current.expected = desired.expected;
                current.type = desired.type;
                current.connection = desired.connection;

                if (recreate)
                {
                    if (current.sub)
                        current.sub.reset();
                    if (current.connection != "no")
                        createSubscriber(current);
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // SUBSCRIBER CREATION
    // ------------------------------------------------------------------
    void createSubscriber(TopicConfig &cfg)
    {
        auto qos = rclcpp::QoS(10);

        try
        {
            if (cfg.type == "bool")
            {
                cfg.sub = this->create_subscription<std_msgs::msg::Bool>(
                    cfg.topic, qos,
                    [this, topic = cfg.topic](const std_msgs::msg::Bool::SharedPtr msg)
                    {
                        handleMsg(topic, msg->data ? "true" : "false");
                    });
            }
            else if (cfg.type == "string")
            {
                cfg.sub = this->create_subscription<std_msgs::msg::String>(
                    cfg.topic, qos,
                    [this, topic = cfg.topic](const std_msgs::msg::String::SharedPtr msg)
                    {
                        handleMsg(topic, msg->data);
                    });
            }
            else if (cfg.type == "int32")
            {
                cfg.sub = this->create_subscription<std_msgs::msg::Int32>(
                    cfg.topic, qos,
                    [this, topic = cfg.topic](const std_msgs::msg::Int32::SharedPtr msg)
                    {
                        handleMsg(topic, std::to_string(msg->data));
                    });
            }
            else
            {
                RCLCPP_ERROR(this->get_logger(),
                             "Unsupported msg_type '%s' for topic '%s'",
                             cfg.type.c_str(), cfg.topic.c_str());
            }
        }
        catch (const std::exception &e)
        {
            // RCLCPP_ERROR(this->get_logger(),
            //              "Failed creating subscriber for topic '%s': %s",
            //              cfg.topic.c_str(), e.what());
        }
    }

    // ------------------------------------------------------------------
    // MESSAGE HANDLER
    // ------------------------------------------------------------------
    void handleMsg(const std::string &topic, const std::string &value)
    {
        std::lock_guard<std::mutex> lk(lock_);

        if (map_.find(topic) == map_.end())
        {
            // RCLCPP_ERROR(this->get_logger(),
            //              "Received message for unknown topic '%s'. Ignoring.",
            //              topic.c_str());
            return;
        }

        auto &cfg = map_[topic];

        if (cfg.connection == "no")
            return;

        bool match = (value == cfg.expected);

        if (!match)
        {
            cfg.sent_once = false;
            return;
        }

        if (cfg.connection == "always")
            return publishBoth(topic);

        if (cfg.connection == "only-once" && !cfg.sent_once)
        {
            cfg.sent_once = true;
            return publishBoth(topic);
        }
    }

    // ------------------------------------------------------------------
    // EMERGENCY PUBLISHER
    // ------------------------------------------------------------------
    void publishBoth(const std::string &topic)
    {
        auto &cfg = map_[topic];

        try
        {
            nextup_joint_interfaces::msg::NextupEmergencyTrigger tmsg;
            tmsg.emergencytrigger = true;
            trigger_pub_->publish(tmsg);

            std_msgs::msg::String toast;
            toast.data = cfg.yaml_key + " fault topic: " + topic + ", failure,0";
            toast_pub_->publish(toast);

            // RCLCPP_WARN(this->get_logger(),
            //             "[EMERGENCY] Triggered from %s (%s) + Toast Popup Sent",
            //             topic.c_str(), cfg.yaml_key.c_str());
        }
        catch (const std::exception &e)
        {
            // RCLCPP_ERROR(this->get_logger(),
            //              "Publish error: %s", e.what());
        }
    }
};

int main(int argc, char **argv)
{
    rclcpp::init(argc, argv);
    rclcpp::spin(std::make_shared<EmergencyManagerNode>());
    rclcpp::shutdown();
    return 0;
}
