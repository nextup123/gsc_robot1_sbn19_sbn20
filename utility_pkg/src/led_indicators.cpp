#include <rclcpp/rclcpp.hpp>

#include <thread>
#include <chrono>
#include <vector>

#include <nextup_joint_interfaces/msg/nextup_driver_status.hpp>
#include <nextup_joint_interfaces/msg/nextup_digital_outputs.hpp>

class JointStatusToDO5 : public rclcpp::Node
{
public:
    JointStatusToDO5()
        : Node("joint_status_to_do5"),
          intial_(true)
    {
        RCLCPP_INFO(get_logger(),
            "✅ DriverStatus → DO5 LED logic started");

        driver_status_sub_ =
            create_subscription<
                nextup_joint_interfaces::msg::NextupDriverStatus>(
                "/nextup_driver_status",
                10,
                std::bind(&JointStatusToDO5::statusCb,
                          this,
                          std::placeholders::_1));

        do_pub_ =
            create_publisher<
                nextup_joint_interfaces::msg::NextupDigitalOutputs>(
                "/nextup_digital_output_controller_6/commands",
                10);
    }

private:
    void statusCb(
        const nextup_joint_interfaces::msg::NextupDriverStatus::SharedPtr msg)
    {
        if (msg->op_status.empty() || msg->fault.empty())
        {
            RCLCPP_WARN(get_logger(), "⚠ Empty driver status arrays");
            return;
        }

        if (intial_)
        {
            nextup_joint_interfaces::msg::NextupDigitalOutputs out;

            for (int i = 0; i < 7; ++i)
            {
                out.do2 = std::vector<bool>{true};
                do_pub_->publish(out);
                std::this_thread::sleep_for(std::chrono::milliseconds(800));

                out.do2 = std::vector<bool>{false};
                do_pub_->publish(out);
                std::this_thread::sleep_for(std::chrono::milliseconds(800));
            }

            intial_ = false;
        }

        // =============================
        // OP_STATUS → DO1 (ALL TRUE)
        // =============================

        bool all_op_enabled = true;
        for (bool st : msg->op_status)
        {
            if (!st)
            {
                all_op_enabled = false;
                break;
            }
        }

        if (all_op_enabled != last_do1_)
        {
            nextup_joint_interfaces::msg::NextupDigitalOutputs out;
            out.do2 = std::vector<bool>{all_op_enabled};
            do_pub_->publish(out);
            RCLCPP_INFO(get_logger(),
                "DO1 (OP_STATUS) → %s",
                all_op_enabled ? "TRUE" : "FALSE");

            last_do1_ = all_op_enabled;
        }

        // =============================
        // FAULT → DO3 (ANY TRUE)
        // =============================

        bool any_fault = false;
        for (bool f : msg->fault)
        {
            if (f)
            {
                any_fault = true;
                break;
            }
        }

        if (any_fault != last_do3_)
        {
            nextup_joint_interfaces::msg::NextupDigitalOutputs out;
            out.do3 = std::vector<bool>{any_fault};
            do_pub_->publish(out);
            out.do2 = std::vector<bool>{false};
            do_pub_->publish(out);

            RCLCPP_WARN(get_logger(),
                "DO3 (FAULT) → %s",
                any_fault ? "TRUE" : "FALSE");

            last_do3_ = any_fault;
        }
    }

    // =============================
    // MEMBERS
    // =============================

    rclcpp::Subscription<
        nextup_joint_interfaces::msg::NextupDriverStatus>::SharedPtr
        driver_status_sub_;

    rclcpp::Publisher<
        nextup_joint_interfaces::msg::NextupDigitalOutputs>::SharedPtr
        do_pub_;

    bool last_do1_ = false; // OP_STATUS LED
    bool last_do3_ = false; // FAULT LED
    bool intial_ = true;
};

// =============================
int main(int argc, char *argv[])
{
    rclcpp::init(argc, argv);
    rclcpp::spin(std::make_shared<JointStatusToDO5>());
    rclcpp::shutdown();
    return 0;
}