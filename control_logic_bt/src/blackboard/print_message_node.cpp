#include "control_logic_bt/blackboard/print_message_node.hpp"

rclcpp::Node::SharedPtr PrintMessage::s_node_ = nullptr;  // static init

void PrintMessage::set_node(rclcpp::Node::SharedPtr node)
{
    s_node_ = node;
}

PrintMessage::PrintMessage(const std::string &name, const BT::NodeConfiguration &config)
    : BT::SyncActionNode(name, config)
{
    // ← nothing here, no blackboard access at construction time
}

BT::PortsList PrintMessage::providedPorts()
{
    return {BT::InputPort<std::string>("msg")};
}

BT::NodeStatus PrintMessage::tick()
{
    if (!s_node_)
        throw BT::RuntimeError("PrintMessage: node not set. Call PrintMessage::set_node() before running tree.");

    if (!publisher_)
        publisher_ = s_node_->create_publisher<std_msgs::msg::String>("/logs_topic", 10);

    auto msg = getInput<std::string>("msg");
    if (!msg)
        throw BT::RuntimeError("Missing input [msg]: ", msg.error());

    std::string final_msg = msg.value();

    size_t start = final_msg.find("${");
    while (start != std::string::npos)
    {
        size_t end = final_msg.find("}", start);
        if (end == std::string::npos) break;
        std::string key = final_msg.substr(start + 2, end - start - 2);
        try {
            std::string value = config().blackboard->get<std::string>(key);
            final_msg.replace(start, end - start + 1, value);
        } catch (...) {
            final_msg.replace(start, end - start + 1, "[undefined]");
        }
        start = final_msg.find("${");
    }

    RCLCPP_INFO(s_node_->get_logger(), "%s", final_msg.c_str());
    std_msgs::msg::String ros_msg;
    ros_msg.data = final_msg;
    publisher_->publish(ros_msg);
    return BT::NodeStatus::SUCCESS;
}