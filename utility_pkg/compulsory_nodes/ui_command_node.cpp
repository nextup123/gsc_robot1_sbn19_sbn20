#include <rclcpp/rclcpp.hpp>
#include <geometry_msgs/msg/twist_stamped.hpp>
#include <control_msgs/msg/joint_jog.hpp>
#include <std_msgs/msg/string.hpp>
#include <thread>
#include <std_msgs/msg/float64_multi_array.hpp>
#include <rcl_interfaces/msg/set_parameters_result.hpp>

// TF
#include <tf2_ros/transform_listener.h>
#include <tf2_ros/buffer.h>
#include <tf2/LinearMath/Quaternion.h>
#include <tf2/LinearMath/Matrix3x3.h>

class UiServo : public rclcpp::Node
{
public:
    UiServo() : Node("ui_command_node")
    {
        RCLCPP_INFO(this->get_logger(), "Node started");

        // ---------------- PARAMETERS ---------------- //
        this->declare_parameter("frame_to_publish", "end");
        this->declare_parameter("max_joint_vel_cmd", 0.2);
        this->declare_parameter("max_twist_vel_cmd_", 0.2);

        this->get_parameter("frame_to_publish", frame_to_publish_);
        this->get_parameter("max_joint_vel_cmd", max_joint_vel_cmd_);
        this->get_parameter("max_twist_vel_cmd_", max_twist_vel_cmd_);

        RCLCPP_INFO(this->get_logger(), "Joint vel = %f", max_joint_vel_cmd_);
        RCLCPP_INFO(this->get_logger(), "Twist vel = %f", max_twist_vel_cmd_);
        RCLCPP_INFO(this->get_logger(), "Initial frame_to_publish = %s", frame_to_publish_.c_str());

        // TF INIT
        tf_buffer_   = std::make_shared<tf2_ros::Buffer>(this->get_clock());
        tf_listener_ = std::make_shared<tf2_ros::TransformListener>(*tf_buffer_);

        // PARAM CALLBACK
        param_callback_handle_ =
            this->add_on_set_parameters_callback(
                std::bind(&UiServo::onParamChange, this, std::placeholders::_1));

        // ---------------- SUBSCRIBERS ---------------- //
        ui_cmnd_subscriber_ =
            this->create_subscription<std_msgs::msg::String>(
                "ui_commands", 10,
                std::bind(&UiServo::topic_callback, this, std::placeholders::_1));

        frame_mode_subscriber_ =
            this->create_subscription<std_msgs::msg::String>(
                "/frame_mode", 10,
                std::bind(&UiServo::frame_mode_callback, this, std::placeholders::_1));

        // ---------------- PUBLISHERS ---------------- //
        twist_pub_ =
            this->create_publisher<geometry_msgs::msg::TwistStamped>(
                "/servo_node/delta_twist_cmds", 10);

        velocity_pub_ =
            this->create_publisher<std_msgs::msg::Float64MultiArray>(
                "/robot_manipulator_velocity_controller/commands", 10);

        // ---------------- INIT VALUES ---------------- //
        joint_vel_cmd = 0.0;
        twist_vel_cmd = 0.0;
        time_of_accel = 1;

        joint_accel_ = max_joint_vel_cmd_ / 100 / time_of_accel;
        twist_accel_ = max_twist_vel_cmd_ / 100 / time_of_accel;

        sign = 1;

        RCLCPP_INFO(this->get_logger(), "Frame switch topic ready: /frame_mode");
    }

private:
    // ================= PARAM =================
    rcl_interfaces::msg::SetParametersResult
    onParamChange(const std::vector<rclcpp::Parameter> &params)
    {
        rcl_interfaces::msg::SetParametersResult result;
        result.successful = true;

        for (const auto &p : params)
        {
            if (p.get_name() == "frame_to_publish")
            {
                frame_to_publish_ = p.as_string();
                RCLCPP_INFO(this->get_logger(),
                            "Frame changed → %s", frame_to_publish_.c_str());
            }
        }
        return result;
    }

    void frame_mode_callback(const std_msgs::msg::String::SharedPtr msg)
    {
        frame_to_publish_ = msg->data;
        RCLCPP_WARN(this->get_logger(),
                    "Frame switched → %s", frame_to_publish_.c_str());
    }

    // ================= MAIN =================
    void topic_callback(std_msgs::msg::String msg)
    {
        data = msg.data;

        twist_msg = geometry_msgs::msg::TwistStamped();
        velocity_msg.data = {0, 0, 0, 0, 0, 0};

        if (prev_data == data)
        {
            if (data[1] == 'j')
                joint_vel_cmd = std::min(max_joint_vel_cmd_, joint_vel_cmd + joint_accel_);
            if (data[1] == 'c')
                twist_vel_cmd = std::min(max_twist_vel_cmd_, twist_vel_cmd + twist_accel_);
        }

        // ---------------- JOINT ---------------- //
        if (data[1] == 'j')
        {
            if (data[0] == '+')
            {
                if (data[2] == '1') velocity_msg.data = {joint_vel_cmd, 0, 0, 0, 0, 0};
                if (data[2] == '2') velocity_msg.data = {0, joint_vel_cmd, 0, 0, 0, 0};
                if (data[2] == '3') velocity_msg.data = {0, 0, joint_vel_cmd, 0, 0, 0};
                if (data[2] == '4') velocity_msg.data = {0, 0, 0, joint_vel_cmd, 0, 0};
                if (data[2] == '5') velocity_msg.data = {0, 0, 0, 0, joint_vel_cmd, 0};
                if (data[2] == '6') velocity_msg.data = {0, 0, 0, 0, 0, joint_vel_cmd};
            }
            else if (data[0] == '-')
            {
                if (data[2] == '1') velocity_msg.data = {-joint_vel_cmd, 0, 0, 0, 0, 0};
                if (data[2] == '2') velocity_msg.data = {0, -joint_vel_cmd, 0, 0, 0, 0};
                if (data[2] == '3') velocity_msg.data = {0, 0, -joint_vel_cmd, 0, 0, 0};
                if (data[2] == '4') velocity_msg.data = {0, 0, 0, -joint_vel_cmd, 0, 0};
                if (data[2] == '5') velocity_msg.data = {0, 0, 0, 0, -joint_vel_cmd, 0};
                if (data[2] == '6') velocity_msg.data = {0, 0, 0, 0, 0, -joint_vel_cmd};
            }
            else if (data[0] == '0')
            {
                while (joint_vel_cmd > 0)
                {
                    sign = (prev_data[0] == '+') ? 1 : -1;
                    joint_vel_cmd = std::max(joint_vel_cmd - joint_accel_, 0.0);

                    if (data[2] == '1') velocity_msg.data = {joint_vel_cmd * sign, 0, 0, 0, 0, 0};
                    if (data[2] == '2') velocity_msg.data = {0, joint_vel_cmd * sign, 0, 0, 0, 0};
                    if (data[2] == '3') velocity_msg.data = {0, 0, joint_vel_cmd * sign, 0, 0, 0};
                    if (data[2] == '4') velocity_msg.data = {0, 0, 0, joint_vel_cmd * sign, 0, 0};
                    if (data[2] == '5') velocity_msg.data = {0, 0, 0, 0, joint_vel_cmd * sign, 0};
                    if (data[2] == '6') velocity_msg.data = {0, 0, 0, 0, 0, joint_vel_cmd * sign};

                    publish_velocity();
                }
            }

            publish_velocity();
            prev_data = data;
        }

        // ---------------- CARTESIAN ---------------- //
        else if (data[1] == 'c')
        {
            if (data[0] == '+')
            {
                if (data[2] == 'x') twist_msg.twist.linear.x = twist_vel_cmd;
                if (data[2] == 'y') twist_msg.twist.linear.y = twist_vel_cmd;
                if (data[2] == 'z') twist_msg.twist.linear.z = twist_vel_cmd;
                if (data[2] == 'r') twist_msg.twist.angular.x = twist_vel_cmd;
                if (data[2] == 'p') twist_msg.twist.angular.y = twist_vel_cmd;
                if (data[2] == 'w') twist_msg.twist.angular.z = twist_vel_cmd;
            }
            else if (data[0] == '-')
            {
                if (data[2] == 'x') twist_msg.twist.linear.x = -twist_vel_cmd;
                if (data[2] == 'y') twist_msg.twist.linear.y = -twist_vel_cmd;
                if (data[2] == 'z') twist_msg.twist.linear.z = -twist_vel_cmd;
                if (data[2] == 'r') twist_msg.twist.angular.x = -twist_vel_cmd;
                if (data[2] == 'p') twist_msg.twist.angular.y = -twist_vel_cmd;
                if (data[2] == 'w') twist_msg.twist.angular.z = -twist_vel_cmd;
            }
            else if (data[0] == '0')
            {
                while (twist_vel_cmd > 0)
                {
                    sign = (prev_data[0] == '+') ? 1 : -1;
                    twist_vel_cmd = std::max(0.0, twist_vel_cmd - twist_accel_);

                    if (data[2] == 'x') twist_msg.twist.linear.x = twist_vel_cmd * sign;
                    if (data[2] == 'y') twist_msg.twist.linear.y = twist_vel_cmd * sign;
                    if (data[2] == 'z') twist_msg.twist.linear.z = twist_vel_cmd * sign;
                    if (data[2] == 'r') twist_msg.twist.angular.x = twist_vel_cmd * sign;
                    if (data[2] == 'p') twist_msg.twist.angular.y = twist_vel_cmd * sign;
                    if (data[2] == 'w') twist_msg.twist.angular.z = twist_vel_cmd * sign;

                    publish_twist();
                }
            }

            publish_twist();
            prev_data = data;
        }
    }

    // ================= TF LOGIC =================
    void publish_twist()
    {
        twist_msg.header.stamp = now();

        if (frame_to_publish_ == "end")
        {
            twist_msg.header.frame_id = "end";
            twist_pub_->publish(twist_msg);
            return;
        }

        try
        {
            auto tf = tf_buffer_->lookupTransform(
                "end",
                frame_to_publish_,
                tf2::TimePointZero);

            tf2::Quaternion q(
                tf.transform.rotation.x,
                tf.transform.rotation.y,
                tf.transform.rotation.z,
                tf.transform.rotation.w);

            tf2::Matrix3x3 R(q);

            geometry_msgs::msg::TwistStamped out;
            out.header.stamp = now();
            out.header.frame_id = "end";

            tf2::Vector3 lin(
                twist_msg.twist.linear.x,
                twist_msg.twist.linear.y,
                twist_msg.twist.linear.z);
            lin = R * lin;
            out.twist.linear.x = lin.x();
            out.twist.linear.y = lin.y();
            out.twist.linear.z = lin.z();

            tf2::Vector3 ang(
                twist_msg.twist.angular.x,
                twist_msg.twist.angular.y,
                twist_msg.twist.angular.z);
            ang = R * ang;
            out.twist.angular.x = ang.x();
            out.twist.angular.y = ang.y();
            out.twist.angular.z = ang.z();

            twist_pub_->publish(out);
        }
        catch (tf2::TransformException &ex)
        {
            RCLCPP_WARN(this->get_logger(),
                        "TF failed (%s → end): %s",
                        frame_to_publish_.c_str(),
                        ex.what());

            twist_msg.header.frame_id = "end";
            twist_pub_->publish(twist_msg);
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }

    void publish_velocity()
    {
        velocity_pub_->publish(velocity_msg);
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }

    // ================= VARIABLES =================
    rclcpp::Publisher<geometry_msgs::msg::TwistStamped>::SharedPtr twist_pub_;
    rclcpp::Publisher<std_msgs::msg::Float64MultiArray>::SharedPtr velocity_pub_;

    rclcpp::Subscription<std_msgs::msg::String>::SharedPtr ui_cmnd_subscriber_;
    rclcpp::Subscription<std_msgs::msg::String>::SharedPtr frame_mode_subscriber_;

    rclcpp::node_interfaces::OnSetParametersCallbackHandle::SharedPtr param_callback_handle_;

    // TF
    std::shared_ptr<tf2_ros::Buffer> tf_buffer_;
    std::shared_ptr<tf2_ros::TransformListener> tf_listener_;

    geometry_msgs::msg::TwistStamped twist_msg;
    std_msgs::msg::Float64MultiArray velocity_msg;

    std::string frame_to_publish_;
    std::string data, prev_data;

    double joint_vel_cmd, max_joint_vel_cmd_, twist_vel_cmd, max_twist_vel_cmd_, time_of_accel;
    double joint_accel_, twist_accel_;
    int sign;
};

int main(int argc, char **argv)
{
    rclcpp::init(argc, argv);
    rclcpp::spin(std::make_shared<UiServo>());
    rclcpp::shutdown();
    return 0;
}
