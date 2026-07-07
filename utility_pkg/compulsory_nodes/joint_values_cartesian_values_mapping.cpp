#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/float64_multi_array.hpp>
#include <fstream>
#include <yaml-cpp/yaml.h>

#include <tf2_ros/transform_listener.h>
#include <tf2_ros/buffer.h>
#include <string>
#include <memory>
#include <Eigen/Geometry>
#include <nextup_joint_interfaces/msg/nextup_joint_state.hpp>
#include <ament_index_cpp/get_package_share_directory.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <std_msgs/msg/bool.hpp>


# define M_PI 3.14159265358979323846

using namespace std::chrono_literals;

class PositionUpdaterUI : public rclcpp::Node
{
public: 
    PositionUpdaterUI() : Node("joint_values_cartesian_values_mapping"){

        // Create a subscriber to the custom topic
        subscription_ = this->create_subscription<nextup_joint_interfaces::msg::NextupJointState>(
            "nextup_joint_states", 10, std::bind(&PositionUpdaterUI::topic_callback, this, std::placeholders::_1));
        
        // Create a publisher to the default topic
        publisher_ = this->create_publisher<sensor_msgs::msg::JointState>("joint_states", 10);

        joint_values_publisher_ = this->create_publisher<std_msgs::msg::Float64MultiArray>("/joint_values", 10);
        end_tf_publisher_ = this->create_publisher<std_msgs::msg::Float64MultiArray>("/cartesian_values", 10);

        tfBuffer_ = std::make_unique<tf2_ros::Buffer>(this->get_clock());
        tf_listener_ = std::make_shared<tf2_ros::TransformListener>(*tfBuffer_);

        timer_ = this->create_wall_timer(0.2s, std::bind(&PositionUpdaterUI::ui_update_timer, this));
    }

private:
    rclcpp::Subscription<sensor_msgs::msg::JointState>::SharedPtr joint_state_subscription_;
    std::unique_ptr<tf2_ros::Buffer> tfBuffer_;
    std::shared_ptr<tf2_ros::TransformListener> tf_listener_{nullptr};
    rclcpp::TimerBase::SharedPtr timer_{nullptr};
    rclcpp::Publisher<std_msgs::msg::Float64MultiArray>::SharedPtr joint_values_publisher_;
    rclcpp::Publisher<std_msgs::msg::Float64MultiArray>::SharedPtr end_tf_publisher_;
    sensor_msgs::msg::JointState joint_msg_;
    std::string yaml_file_;
    rclcpp::Subscription<nextup_joint_interfaces::msg::NextupJointState>::SharedPtr subscription_;
    rclcpp::Publisher<sensor_msgs::msg::JointState>::SharedPtr publisher_;

    void topic_callback(const nextup_joint_interfaces::msg::NextupJointState::SharedPtr msg)
    {
        sensor_msgs::msg::JointState new_msg;
        new_msg.header = msg->header;

        // Define the ordered joint names we want to publish
        std::vector<std::string> ordered_joint_names = {"joint1", "joint2", "joint3", "joint4", "joint5", "joint6"};

        // Resize vectors to hold data only for the specified joints
        new_msg.name.resize(ordered_joint_names.size());
        new_msg.position.resize(ordered_joint_names.size());
        new_msg.velocity.resize(ordered_joint_names.size());
        new_msg.effort.resize(ordered_joint_names.size());

        // Map the incoming joint names to indices for fast lookup
        std::unordered_map<std::string, size_t> joint_indices;
        for (size_t i = 0; i < msg->name.size(); ++i) {
            joint_indices[msg->name[i]] = i;
        }

        // Fetch data only for each joint in the specified order
        for (size_t i = 0; i < ordered_joint_names.size(); ++i) {
            const std::string& joint_name = ordered_joint_names[i];
            if (joint_indices.count(joint_name) > 0) {
                size_t index = joint_indices[joint_name];
                new_msg.name[i] = msg->name[index];
                new_msg.position[i] = msg->position[index];
                new_msg.velocity[i] = msg->velocity[index];
                new_msg.effort[i] = msg->effort[index];
            } else {
                RCLCPP_INFO(this->get_logger(), "Joint not found");
            }
        }

        joint_msg_ = new_msg;

        // Republish the filtered message with only joint1 to joint6
        publisher_->publish(new_msg);
    }

    void ui_update_timer(){
        // if (!homing_start) return;
        geometry_msgs::msg::TransformStamped pose;
        try {
            pose = tfBuffer_->lookupTransform("base_link", "end" ,tf2::TimePointZero); // to_frame, from_frame
        }
        catch(const tf2::TransformException & ex) {
            RCLCPP_INFO_ONCE(this->get_logger(), "Could not retrieve transform");
            return;
        }

        geometry_msgs::msg::Vector3 euler_angles = quaternion_to_euler({pose.transform.rotation.x, pose.transform.rotation.y, pose.transform.rotation.z, pose.transform.rotation.w});

        pose.transform.translation.x = std::round(pose.transform.translation.x * 10000) / 10000;
        pose.transform.translation.y = std::round(pose.transform.translation.y * 10000) / 10000;
        pose.transform.translation.z = std::round(pose.transform.translation.z * 10000) / 10000;

        std_msgs::msg::Float64MultiArray end_pose;
        end_pose.data = {pose.transform.translation.x * 100, pose.transform.translation.y * 100, pose.transform.translation.z * 100,
                         euler_angles.x, euler_angles.y, euler_angles.z};
    
        end_tf_publisher_->publish(end_pose);

        std_msgs::msg::Float64MultiArray joint_values;
        try {
            joint_values.data = {rad_to_deg(joint_msg_.position[0]), rad_to_deg(joint_msg_.position[1]), rad_to_deg(joint_msg_.position[2]),
                                rad_to_deg(joint_msg_.position[3]), rad_to_deg(joint_msg_.position[4]), rad_to_deg(joint_msg_.position[5])};

            joint_values_publisher_->publish(joint_values);
        }
        catch(std::exception &e){
            RCLCPP_INFO_ONCE(this->get_logger(), "Joint values are not coming");
            return;
        }
    }

    geometry_msgs::msg::Vector3 quaternion_to_euler(const std::array<double, 4>& quaternion) {
        double roll, pitch, yaw;
        double qx = quaternion[0], qy = quaternion[1], qz = quaternion[2], qw = quaternion[3];

        // Roll (X-axis rotation)
        roll = std::atan2(2.0 * (qw * qx + qy * qz), 1.0 - 2.0 * (qx * qx + qy * qy));

        // Pitch (Y-axis rotation)
        pitch = std::asin(2.0 * (qw * qy - qz * qx));

        // Yaw (Z-axis rotation)
        yaw = std::atan2(2.0 * (qw * qz + qx * qy), 1.0 - 2.0 * (qy * qy + qz * qz));

        geometry_msgs::msg::Vector3 euler;
        euler.x = rad_to_deg(roll);
        euler.y = rad_to_deg(pitch);
        euler.z = rad_to_deg(yaw);

        return euler;
    }

    double rad_to_deg(double value){
        return std::round(value * 180 / M_PI * 100) / 100;
    }

};

int main(int argc, char **argv){
    rclcpp::init(argc, argv);
    auto node = std::make_shared<PositionUpdaterUI>();
    rclcpp::spin(node);
    rclcpp::shutdown();
    return 0;
}