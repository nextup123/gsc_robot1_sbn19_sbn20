#include <rclcpp/rclcpp.hpp>
#include <geometry_msgs/msg/twist_stamped.hpp>
#include <control_msgs/msg/joint_jog.hpp>
#include <std_msgs/msg/string.hpp>
#include <thread>

class UiServo : public rclcpp::Node{
public: 
    UiServo() : Node("ui_command_node_sim"){   

        RCLCPP_INFO(this->get_logger(), "UiServo node STARTING...");

        subscriber_ = this->create_subscription<std_msgs::msg::String>(
            "ui_commands", 10,
            std::bind(&UiServo::topic_callback, this, std::placeholders::_1));

        this->declare_parameter("frame_to_publish", "end");
        this->get_parameter("frame_to_publish", frame_to_publish_);
        RCLCPP_INFO(this->get_logger(), "Frame to publish: %s", frame_to_publish_.c_str());

        this->declare_parameter("max_joint_vel_cmd", 0.3);
        this->get_parameter("max_joint_vel_cmd", max_joint_vel_cmd_);
        RCLCPP_INFO(this->get_logger(), "Max joint velocity: %.3f", max_joint_vel_cmd_);

        this->declare_parameter("max_twist_vel_cmd", 0.2);
        this->get_parameter("max_twist_vel_cmd", max_twist_vel_cmd_);
        RCLCPP_INFO(this->get_logger(), "Max twist velocity: %.3f", max_twist_vel_cmd_);

        twist_pub_ = this->create_publisher<geometry_msgs::msg::TwistStamped>(
            "/servo_node/delta_twist_cmds", 10);
        joint_pub_ = this->create_publisher<control_msgs::msg::JointJog>(
            "/servo_node/delta_joint_cmds", 10);

        joint_vel_cmd = 0.0;
        twist_vel_cmd = 0.0;

        time_of_accel = 1;
        joint_accel_ = max_joint_vel_cmd_ / 100 / time_of_accel;
        twist_accel_ = max_twist_vel_cmd_ / 100 / time_of_accel;

        sign = 1;

        RCLCPP_INFO(this->get_logger(),
            "Acceleration set → joint: %.5f | twist: %.5f",
            joint_accel_, twist_accel_);

        RCLCPP_INFO(this->get_logger(), "UiServo node READY.");
    }

private:

    void topic_callback(std_msgs::msg::String msg){
        data = msg.data;

        RCLCPP_DEBUG(this->get_logger(),
            "Received UI command: [%s]", data.c_str());

        twist_msg = geometry_msgs::msg::TwistStamped();
        joint_msg = control_msgs::msg::JointJog();

        if (prev_data == data){
            joint_vel_cmd = std::min(max_joint_vel_cmd_, joint_vel_cmd + joint_accel_);
            twist_vel_cmd = std::min(max_twist_vel_cmd_, twist_vel_cmd + twist_accel_);

            RCLCPP_DEBUG(this->get_logger(),
                "Velocity ramping → joint: %.4f | twist: %.4f",
                joint_vel_cmd, twist_vel_cmd);
        }

        /* ===================== JOINT MODE ===================== */
        if (data[1] == 'j'){
            RCLCPP_INFO(this->get_logger(), "Joint command detected");

            if      (data[0] == '+') joint_msg.velocities = { joint_vel_cmd };
            else if (data[0] == '-') joint_msg.velocities = { -joint_vel_cmd };
            else if (data[0] == '0'){
                RCLCPP_INFO(this->get_logger(), "Joint STOP command");
                joint_msg.velocities = { joint_vel_cmd / 2.0 };
                pub_joint();
                joint_msg.velocities = { 0.0 };
                joint_vel_cmd = 0.0;
            }

            if      (data[2] == '1') joint_msg.joint_names = { "joint1" };
            else if (data[2] == '2') joint_msg.joint_names = { "joint2" };
            else if (data[2] == '3') joint_msg.joint_names = { "joint3" };
            else if (data[2] == '4') joint_msg.joint_names = { "joint4" };
            else if (data[2] == '5') joint_msg.joint_names = { "joint5" };
            else if (data[2] == '6') joint_msg.joint_names = { "joint6" };

            RCLCPP_INFO(this->get_logger(),
                "Publishing Joint → %s | velocity: %.4f",
                joint_msg.joint_names.front().c_str(),
                joint_msg.velocities.front());

            pub_joint();
            prev_data = data;
        }

        /* ===================== CARTESIAN MODE ===================== */
        else if (data[1] == 'c'){
            RCLCPP_INFO(this->get_logger(), "Cartesian command detected");

            if (data[0] == '+'){
                RCLCPP_DEBUG(this->get_logger(), "Cartesian POSITIVE direction");
                if      (data[2] == 'x') twist_msg.twist.linear.x  =  twist_vel_cmd;
                else if (data[2] == 'y') twist_msg.twist.linear.y  =  twist_vel_cmd;
                else if (data[2] == 'z') twist_msg.twist.linear.z  =  twist_vel_cmd;
                else if (data[2] == 'r') twist_msg.twist.angular.x =  twist_vel_cmd;
                else if (data[2] == 'p') twist_msg.twist.angular.y =  twist_vel_cmd;
                else if (data[2] == 'w') twist_msg.twist.angular.z =  twist_vel_cmd;
            }

            else if (data[0] == '-'){
                RCLCPP_DEBUG(this->get_logger(), "Cartesian NEGATIVE direction");
                if      (data[2] == 'x') twist_msg.twist.linear.x  = -twist_vel_cmd;
                else if (data[2] == 'y') twist_msg.twist.linear.y  = -twist_vel_cmd;
                else if (data[2] == 'z') twist_msg.twist.linear.z  = -twist_vel_cmd;
                else if (data[2] == 'r') twist_msg.twist.angular.x = -twist_vel_cmd;
                else if (data[2] == 'p') twist_msg.twist.angular.y = -twist_vel_cmd;
                else if (data[2] == 'w') twist_msg.twist.angular.z = -twist_vel_cmd;
            }

            else if (data[0] == '0'){
                RCLCPP_INFO(this->get_logger(), "Cartesian STOP with deceleration");

                while (twist_vel_cmd > 0.0){
                    sign = (prev_data[0] == '+') ? 1 : -1;
                    twist_vel_cmd = std::max(0.0, twist_vel_cmd - twist_accel_);

                    RCLCPP_DEBUG(this->get_logger(),
                        "Decelerating → twist velocity: %.4f", twist_vel_cmd);

                    if      (data[2] == 'x') twist_msg.twist.linear.x  = twist_vel_cmd * sign;
                    else if (data[2] == 'y') twist_msg.twist.linear.y  = twist_vel_cmd * sign;
                    else if (data[2] == 'z') twist_msg.twist.linear.z  = twist_vel_cmd * sign;
                    else if (data[2] == 'r') twist_msg.twist.angular.x = twist_vel_cmd * sign;
                    else if (data[2] == 'p') twist_msg.twist.angular.y = twist_vel_cmd * sign;
                    else if (data[2] == 'w') twist_msg.twist.angular.z = twist_vel_cmd * sign;

                    pub_twist();
                }
            }

            pub_twist();
            prev_data = data;
        }
    }

    void pub_twist(){
        RCLCPP_DEBUG(this->get_logger(), "Publishing Twist command");
        twist_msg.header.stamp = this->now();
        twist_msg.header.frame_id = frame_to_publish_;
        twist_pub_->publish(std::move(twist_msg));
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }

    void pub_joint(){
        RCLCPP_DEBUG(this->get_logger(), "Publishing Joint command");
        joint_msg.header.stamp = this->now();
        joint_msg.header.frame_id = frame_to_publish_;
        joint_pub_->publish(std::move(joint_msg));
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }

    rclcpp::Publisher<geometry_msgs::msg::TwistStamped>::SharedPtr twist_pub_;
    rclcpp::Publisher<control_msgs::msg::JointJog>::SharedPtr joint_pub_;
    rclcpp::Subscription<std_msgs::msg::String>::SharedPtr subscriber_;

    geometry_msgs::msg::TwistStamped twist_msg;
    control_msgs::msg::JointJog joint_msg;

    std::string frame_to_publish_;
    double joint_vel_cmd, max_joint_vel_cmd_, twist_vel_cmd, max_twist_vel_cmd_, time_of_accel;
    double joint_accel_, twist_accel_;
    int sign;

    std::string data, prev_data;
};

int main(int argc, char** argv){
    rclcpp::init(argc, argv);
    rclcpp::spin(std::make_shared<UiServo>());
    rclcpp::shutdown();
    return 0;
}
