#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/string.hpp>

#include <nextup_joint_interfaces/msg/nextup_driver_status.hpp>
#include <nextup_joint_interfaces/msg/nextup_emergency_trigger.hpp>

#include <unordered_map>
#include <string>

class SafetyInformer : public rclcpp::Node
{
public:
    SafetyInformer()
        : Node("safety_informer")
    {
        RCLCPP_INFO(get_logger(), "SafetyInformer node started");

        status_sub_ = this->create_subscription<
            nextup_joint_interfaces::msg::NextupDriverStatus>(
            "/nextup_driver_status",
            rclcpp::SystemDefaultsQoS(),
            std::bind(&SafetyInformer::statusCallback, this, std::placeholders::_1));

        toast_pub_ = this->create_publisher<std_msgs::msg::String>(
            "/bt_toast_popup",
            rclcpp::SystemDefaultsQoS());

        emergency_pub_ =
            this->create_publisher<
                nextup_joint_interfaces::msg::NextupEmergencyTrigger>(
                "/nextup_emergency_trigger_controller/commands",
                rclcpp::SystemDefaultsQoS());
    }

private:
    void statusCallback(
        const nextup_joint_interfaces::msg::NextupDriverStatus::SharedPtr msg)
    {
        const auto &names = msg->name;
        const auto &faults = msg->fault;
        const auto &op_status = msg->op_status;

        // -------- INITIALIZE ON FIRST MESSAGE --------
        if (!initialized_)
        {
            for (size_t i = 0; i < names.size(); ++i)
            {
                last_fault_state_[names[i]] = faults[i];
                last_op_state_[names[i]] = op_status[i];
            }

            last_any_fault_ = anyFault(faults);
            initialized_ = true;

            RCLCPP_INFO(get_logger(),
                        "SafetyInformer initialized (edge-trigger active)");
            return;
        }

        bool any_fault_now = false;
        int first_fault_index = -1;

        // -------- FAULT EDGE DETECTION --------
        for (size_t i = 0; i < names.size(); ++i)
        {
            bool prev_fault = last_fault_state_[names[i]];
            bool curr_fault = faults[i];

            if (!prev_fault && curr_fault)
            {
                publishToast(names[i] + " fault,failure,10");

                if (first_fault_index == -1)
                {
                    first_fault_index = static_cast<int>(i);
                }
            }

            last_fault_state_[names[i]] = curr_fault;

            if (curr_fault)
            {
                any_fault_now = true;
            }
        }

        // -------- EMERGENCY EDGE (GLOBAL) --------
        if (!last_any_fault_ && any_fault_now)
        {
            nextup_joint_interfaces::msg::NextupEmergencyTrigger emsg;
            emsg.emergencytrigger = true;
            emergency_pub_->publish(emsg);

            if (first_fault_index >= 0)
            {
                RCLCPP_ERROR(
                    get_logger(),
                    "Emergency triggered due to fault in joint: %s",
                    names[first_fault_index].c_str());
            }
            else
            {
                RCLCPP_ERROR(
                    get_logger(),
                    "Emergency triggered due to fault (unknown joint)");
            }
        }

        last_any_fault_ = any_fault_now;

        // -------- OPERATIONAL FALSE (ONLY IF NO FAULTS) --------
        if (!any_fault_now)
        {
            for (size_t i = 0; i < names.size(); ++i)
            {
                bool prev_op = last_op_state_[names[i]];
                bool curr_op = op_status[i];

                if (prev_op && !curr_op)
                {
                    publishToast(
                        names[i] + " operational false,failure,10");
                }

                last_op_state_[names[i]] = curr_op;
            }
        }
    }

    bool anyFault(const std::vector<bool> &faults)
    {
        for (bool f : faults)
        {
            if (f)
                return true;
        }
        return false;
    }

    void publishToast(const std::string &text)
    {
        std_msgs::msg::String msg;
        msg.data = text;
        toast_pub_->publish(msg);

        RCLCPP_WARN(get_logger(), "Toast: %s", text.c_str());
    }

    // ROS interfaces
    rclcpp::Subscription<
        nextup_joint_interfaces::msg::NextupDriverStatus>::SharedPtr status_sub_;

    rclcpp::Publisher<std_msgs::msg::String>::SharedPtr toast_pub_;
    rclcpp::Publisher<
        nextup_joint_interfaces::msg::NextupEmergencyTrigger>::SharedPtr emergency_pub_;

    // State tracking
    std::unordered_map<std::string, bool> last_fault_state_;
    std::unordered_map<std::string, bool> last_op_state_;

    bool initialized_{false};
    bool last_any_fault_{false};
};

int main(int argc, char **argv)
{
    rclcpp::init(argc, argv);
    rclcpp::spin(std::make_shared<SafetyInformer>());
    rclcpp::shutdown();
    return 0;
}
