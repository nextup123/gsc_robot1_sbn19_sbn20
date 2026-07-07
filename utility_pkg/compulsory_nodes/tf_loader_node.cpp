// ===============================
// TF Loader from points.yaml (READ-ONLY)
// Auto reload on file change
// ===============================

#include <rclcpp/rclcpp.hpp>

#include <tf2_ros/transform_listener.h>
#include <tf2_ros/transform_broadcaster.h>
#include <tf2_ros/buffer.h>

#include <geometry_msgs/msg/transform_stamped.hpp>

#include <visualization_msgs/msg/marker.hpp>
#include <visualization_msgs/msg/marker_array.hpp>

#include <yaml-cpp/yaml.h>

#include <tf2/LinearMath/Quaternion.h>
#include <tf2/LinearMath/Transform.h>
#include <tf2_geometry_msgs/tf2_geometry_msgs.h>

#include <unordered_map>
#include <filesystem>
#include <mutex>
#include <cmath>
#include <algorithm>

class TFLoaderNode : public rclcpp::Node
{
public:
    TFLoaderNode()
        : Node("tf_loader_node")
    {
        points_yaml_ =
            "/home/nextup/NextupRobot/src/active_project_configs/planning_data/points.yaml";

        tf_buffer_ = std::make_shared<tf2_ros::Buffer>(this->get_clock());
        tf_listener_ = std::make_shared<tf2_ros::TransformListener>(*tf_buffer_);
        broadcaster_ = std::make_shared<tf2_ros::TransformBroadcaster>(this);

        marker_pub_ = this->create_publisher<visualization_msgs::msg::MarkerArray>(
            "/tf_name_markers", 10);

        // Publish TF continuously
        publish_timer_ = this->create_wall_timer(
            std::chrono::milliseconds(50),
            std::bind(&TFLoaderNode::publish_all_tf, this));

        // Watch file changes (like fs.watch)
        watch_timer_ = this->create_wall_timer(
            std::chrono::milliseconds(200),
            std::bind(&TFLoaderNode::watch_file, this));

        load_from_yaml();
        last_write_time_ = get_file_time();

        RCLCPP_INFO(this->get_logger(), "TF Loader Node Ready...");
    }

private:
    std::unordered_map<std::string, geometry_msgs::msg::TransformStamped> saved_tfs_;
    std::mutex mutex_;

    std::string points_yaml_;
    std::filesystem::file_time_type last_write_time_;

    rclcpp::TimerBase::SharedPtr publish_timer_;
    rclcpp::TimerBase::SharedPtr watch_timer_;

    std::shared_ptr<tf2_ros::Buffer> tf_buffer_;
    std::shared_ptr<tf2_ros::TransformListener> tf_listener_;
    std::shared_ptr<tf2_ros::TransformBroadcaster> broadcaster_;

    rclcpp::Publisher<visualization_msgs::msg::MarkerArray>::SharedPtr marker_pub_;

    double deg2rad(double deg) { return deg * M_PI / 180.0; }
    double cm2m(double cm) { return cm / 100.0; }

    // Robust bool parse: accepts true/false, yes/no, 1/0, on/off,
    // and tolerates capitalisation ("True", "FALSE", etc.)
    bool parse_bool(const YAML::Node &node, bool &out)
    {
        try {
            out = node.as<bool>();
            return true;
        } catch (const YAML::Exception &) {
            std::string s = node.as<std::string>();
            std::transform(s.begin(), s.end(), s.begin(),
                           [](unsigned char c) { return std::tolower(c); });
            if (s == "true" || s == "yes" || s == "1" || s == "on")  { out = true;  return true; }
            if (s == "false" || s == "no" || s == "0" || s == "off") { out = false; return true; }
            return false;
        }
    }

    // ================= FILE WATCH =================

    std::filesystem::file_time_type get_file_time()
    {
        if (!std::filesystem::exists(points_yaml_))
            return std::filesystem::file_time_type::min();

        return std::filesystem::last_write_time(points_yaml_);
    }

    void watch_file()
    {
        auto current = get_file_time();

        if (current != last_write_time_)
        {
            RCLCPP_INFO(this->get_logger(), "points.yaml changed → reloading");
            load_from_yaml();
            last_write_time_ = current;
        }
    }

    // ================= LOAD =================

    void load_from_yaml()
    {
        if (!std::filesystem::exists(points_yaml_))
        {
            RCLCPP_ERROR(this->get_logger(), "YAML not found: %s", points_yaml_.c_str());
            return;
        }

        YAML::Node root;
        try {
            root = YAML::LoadFile(points_yaml_);
        } catch (const YAML::Exception &e) {
            RCLCPP_ERROR(this->get_logger(), "YAML parse error: %s", e.what());
            return;
        }

        if (!root["points"])
        {
            RCLCPP_ERROR(this->get_logger(), "No 'points' key in YAML");
            return;
        }

        RCLCPP_INFO(this->get_logger(), "points block size: %zu", root["points"].size());

        std::lock_guard<std::mutex> lock(mutex_);
        saved_tfs_.clear();

        int loaded = 0;

        for (const auto &point : root["points"])
        {
            std::string name = point["name"] ? point["name"].as<std::string>() : "<noname>";

            if (!point["name"] || !point["coordinate"])
            {
                RCLCPP_WARN(this->get_logger(),
                            "skip '%s': missing name or coordinate", name.c_str());
                continue;
            }

            if (!point["is_tf"])
            {
                RCLCPP_WARN(this->get_logger(),
                            "skip '%s': no is_tf key", name.c_str());
                continue;
            }

            bool is_tf = false;
            if (!parse_bool(point["is_tf"], is_tf))
            {
                RCLCPP_WARN(this->get_logger(),
                            "skip '%s': is_tf not parseable as bool", name.c_str());
                continue;
            }

            if (!is_tf)
            {
                RCLCPP_WARN(this->get_logger(),
                            "skip '%s': is_tf=false", name.c_str());
                continue;
            }

            auto coord = point["coordinate"];

            geometry_msgs::msg::TransformStamped t;
            t.header.frame_id = "base_link";
            t.child_frame_id = name;

            t.transform.translation.x = cm2m(coord["x"].as<double>());
            t.transform.translation.y = cm2m(coord["y"].as<double>());
            t.transform.translation.z = cm2m(coord["z"].as<double>());

            double roll = deg2rad(coord["r"].as<double>());
            double pitch = deg2rad(coord["p"].as<double>());
            double yaw = deg2rad(coord["w"].as<double>());

            tf2::Quaternion q;
            q.setRPY(roll, pitch, yaw);
            q.normalize();

            t.transform.rotation = tf2::toMsg(q);

            saved_tfs_[name] = t;
            loaded++;

            RCLCPP_INFO(this->get_logger(), "Loaded TF: %s", name.c_str());
        }

        RCLCPP_INFO(this->get_logger(), "Total TFs loaded: %d", loaded);
    }

    // ================= PUBLISH =================

    void publish_all_tf()
    {
        std::lock_guard<std::mutex> lock(mutex_);

        visualization_msgs::msg::MarkerArray marker_array;
        int id = 0;

        for (auto &pair : saved_tfs_)
        {
            auto &tf_base = pair.second;

            try
            {
                auto base_to_end = tf_buffer_->lookupTransform(
                    "base_link",
                    "end",
                    tf2::TimePointZero);

                tf2::Transform T_base_end, T_base_p1;
                tf2::fromMsg(base_to_end.transform, T_base_end);
                tf2::fromMsg(tf_base.transform, T_base_p1);

                tf2::Transform T_end_p1 = T_base_end.inverse() * T_base_p1;

                geometry_msgs::msg::TransformStamped t_out;
                t_out.header.frame_id = "end";
                t_out.child_frame_id = pair.first;
                t_out.header.stamp = this->now();
                t_out.transform = tf2::toMsg(T_end_p1);

                broadcaster_->sendTransform(t_out);

                visualization_msgs::msg::Marker marker;
                marker.header.frame_id = "base_link";
                marker.header.stamp = this->now();

                marker.ns = "tf_names";
                marker.id = id++;

                marker.type = visualization_msgs::msg::Marker::TEXT_VIEW_FACING;
                marker.action = visualization_msgs::msg::Marker::ADD;

                marker.pose.position.x = tf_base.transform.translation.x;
                marker.pose.position.y = tf_base.transform.translation.y;
                marker.pose.position.z = tf_base.transform.translation.z + 0.05;

                marker.pose.orientation.w = 1.0;

                marker.scale.z = 0.05;

                marker.color.r = 1.0;
                marker.color.g = 1.0;
                marker.color.b = 0.0;
                marker.color.a = 1.0;

                marker.text = pair.first;

                marker_array.markers.push_back(marker);
            }
            catch (tf2::TransformException &ex)
            {
                RCLCPP_WARN(this->get_logger(), "%s", ex.what());
            }
        }

        marker_pub_->publish(marker_array);
    }
};

// ================= MAIN =================

int main(int argc, char **argv)
{
    rclcpp::init(argc, argv);
    rclcpp::spin(std::make_shared<TFLoaderNode>());
    rclcpp::shutdown();
    return 0;
}