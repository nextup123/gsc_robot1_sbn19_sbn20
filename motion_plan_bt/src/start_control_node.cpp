#include "start_control_node.hpp"

StartControlNode::StartControlNode(const std::string &name, const BT::NodeConfiguration &config, rclcpp::Node::SharedPtr node)
    : BT::ControlNode(name, config), node_(node), start_triggered_(false), reset_requested_(false)
{
    RCLCPP_INFO(node_->get_logger(), "[StartControlNode] Initializing...");

    start_subscription_ = node_->create_subscription<std_msgs::msg::Bool>(
        "/motion_start_bt", 10,
        std::bind(&StartControlNode::startCallback, this, std::placeholders::_1));

    reset_subscription_ = node_->create_subscription<std_msgs::msg::Bool>(
        "/motion_reset_bt", 10,
        std::bind(&StartControlNode::resetCallback, this, std::placeholders::_1));

    start_active_publisher_ = node_->create_publisher<std_msgs::msg::Bool>("/motion_start_bt_active", 10);
}

BT::PortsList StartControlNode::providedPorts()
{
    return {};
}

void StartControlNode::startCallback(const std_msgs::msg::Bool::SharedPtr msg)
{
    if (msg->data && !start_triggered_)
    {
        start_triggered_ = true;
        auto active_msg = std_msgs::msg::Bool();
        active_msg.data = false;
        start_active_publisher_->publish(active_msg);
        RCLCPP_INFO(node_->get_logger(), "[StartControlNode] Received /start_bt: true");
    }
}

void StartControlNode::resetCallback(const std_msgs::msg::Bool::SharedPtr msg)
{
    if (msg->data)
    {
        reset_requested_ = true;

        RCLCPP_WARN(node_->get_logger(), "[StartControlNode] Received /reset_bt: true");
    }
}

BT::NodeStatus StartControlNode::tick()
{
    if (reset_requested_)
    {
        RCLCPP_WARN(node_->get_logger(), "[StartControlNode] Resetting internal state...");
        haltChildren(); 
        start_triggered_ = false;
        reset_requested_ = false;
        return BT::NodeStatus::RUNNING;
    }

    if (!start_triggered_)
    {   
        auto active_msg = std_msgs::msg::Bool();
        active_msg.data = true;
        start_active_publisher_->publish(active_msg);
        RCLCPP_INFO_THROTTLE(node_->get_logger(), *node_->get_clock(), 1000,
                             "[StartControlNode] Waiting for /start_bt == true...");
        return BT::NodeStatus::RUNNING;
    }

    size_t children_count = children_nodes_.size();
    for (size_t idx = 0; idx < children_count; idx++)
    {
        BT::TreeNode *child = children_nodes_[idx];
        const BT::NodeStatus child_status = child->executeTick();

        if (child_status == BT::NodeStatus::RUNNING)
        {
            return BT::NodeStatus::RUNNING;
        }

        if (child_status == BT::NodeStatus::FAILURE)
        {
            RCLCPP_ERROR(node_->get_logger(), "[StartControlNode] Child %zu returned FAILURE", idx);
            haltChildren();
            return BT::NodeStatus::FAILURE;
        }
    }

    RCLCPP_INFO(node_->get_logger(), "[StartControlNode] All children succeeded.");
    return BT::NodeStatus::SUCCESS;
}

void StartControlNode::halt()
{
    RCLCPP_INFO(node_->get_logger(), "[StartControlNode] Halting node...");
    haltChildren();
    start_triggered_ = false; 
    reset_requested_ = false;
}