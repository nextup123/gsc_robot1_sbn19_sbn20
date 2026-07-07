#include "control_logic_bt/motion/run_path_node.hpp"

// Static member initialization
rclcpp::Node::SharedPtr RunPath::node_ = nullptr;
rclcpp::Publisher<std_msgs::msg::String>::SharedPtr RunPath::path_pub_ = nullptr;
rclcpp::Subscription<std_msgs::msg::String>::SharedPtr RunPath::status_sub_ = nullptr;
rclcpp::Subscription<std_msgs::msg::Float64>::SharedPtr RunPath::speed_scale_sub_ = nullptr;

std::string RunPath::current_path_name_;
std::string RunPath::current_status_;
std::mutex RunPath::mutex_;

std::atomic<double> RunPath::dynamic_speed_scale_(0.0);
std::atomic<bool> RunPath::use_dynamic_scale_(false);

RunPath::RunPath(const std::string &name, const BT::NodeConfiguration &config)
    : BT::SyncActionNode(name, config)
{
    if (!node_)
    {
        node_ = rclcpp::Node::make_shared("run_path_bt_node");
        path_pub_ = node_->create_publisher<std_msgs::msg::String>("/path_with_velocity_scale", 10);

        status_sub_ = node_->create_subscription<std_msgs::msg::String>(
            "/running_path_status", 10, &RunPath::statusCallback);

        speed_scale_sub_ = node_->create_subscription<std_msgs::msg::Float64>(
            "/dynamic_speed_scale", 10, [](const std_msgs::msg::Float64::SharedPtr msg)
            {
                if (msg->data == 0.0) {
                    use_dynamic_scale_.store(false);  // Revert to input ports
                    RCLCPP_INFO(node_->get_logger(), "Reverting to original speed scales");
                } else {
                    dynamic_speed_scale_.store(msg->data);
                    use_dynamic_scale_.store(true);   // Use dynamic speed
                    RCLCPP_INFO(node_->get_logger(), "Dynamic speed scale set to: %.2f", msg->data);
                } });

        std::thread([]()
                    { rclcpp::spin(node_); })
            .detach();
    }
}

BT::NodeStatus RunPath::tick()
{
    std::string path_name;
    double original_speed_scale;

    if (!getInput("path_name", path_name) || !getInput("speed_scale", original_speed_scale))
    {
        RCLCPP_ERROR(node_->get_logger(), "Missing required input(s)");
        return BT::NodeStatus::FAILURE;
    }

    // Use dynamic speed if active, otherwise use original input port value
    const double effective_speed = use_dynamic_scale_ ? dynamic_speed_scale_.load() : original_speed_scale;

    std_msgs::msg::String msg;
    msg.data = path_name + "," + std::to_string(effective_speed);
    path_pub_->publish(msg);

    RCLCPP_INFO(node_->get_logger(),

                "Executing path '%s' with speed: %.2f (source: %s)",
                path_name.c_str(),
                effective_speed,
                use_dynamic_scale_ ? "DYNAMIC" : "ORIGINAL");

    rclcpp::Rate rate(10);
    for (int i = 0; i < 600; ++i) // Timeout ~60 sec = 600
    {
        {
            // RCLCPP_ERROR(node_->get_logger(), "path name '%s' , current_status '%s' ", path_name.c_str(),  current_status_.c_str());

            std::lock_guard<std::mutex> lock(mutex_);
            if (current_path_name_ == path_name && current_status_ == "completed")
            {

                return BT::NodeStatus::SUCCESS;
            }
            else if (current_path_name_ == path_name && current_status_ == "aborted")
            {

                return BT::NodeStatus::FAILURE;
            }
        }
        rate.sleep();
    }

    RCLCPP_WARN(node_->get_logger(), "Path %s did not complete in time", path_name.c_str());
    return BT::NodeStatus::FAILURE;
}

void RunPath::statusCallback(const std_msgs::msg::String::SharedPtr msg)
{
    std::lock_guard<std::mutex> lock(mutex_);
    std::string data = msg->data;
    auto delimiter = data.find(',');
    if (delimiter != std::string::npos)
    {
        current_status_ = data.substr(0, delimiter);
        current_path_name_ = data.substr(delimiter + 1);
    }
}
