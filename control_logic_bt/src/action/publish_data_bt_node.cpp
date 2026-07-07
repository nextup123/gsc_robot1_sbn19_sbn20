#include "control_logic_bt/action/publish_data_bt_node.hpp"

PublishDataOnTopic::PublishDataOnTopic(const std::string& name, const BT::NodeConfiguration& config)
    : BT::SyncActionNode(name, config)
{
  ros_node_ = rclcpp::Node::make_shared("publish_data_bt_node_" + name);
}

BT::NodeStatus PublishDataOnTopic::tick()
{
  std::string msg_on_topic;
  getInput("type_of_topic", type_);
  getInput("msg_on_topic", msg_on_topic);
  getInput("topic_name", topic_name_);

  // Initialize publisher only once
  if (!initialized_)
  {
    if (type_ == "std_msgs/msg/Bool") {
      bool_pub_ = ros_node_->create_publisher<std_msgs::msg::Bool>(topic_name_, 10);
    }
    else if (type_ == "std_msgs/msg/String") {
      string_pub_ = ros_node_->create_publisher<std_msgs::msg::String>(topic_name_, 10);
    }
    else if (type_ == "std_msgs/msg/Int32") {
      int32_pub_ = ros_node_->create_publisher<std_msgs::msg::Int32>(topic_name_, 10);
    }
    else {
      RCLCPP_ERROR(ros_node_->get_logger(), "Unsupported message type: %s", type_.c_str());
      return BT::NodeStatus::FAILURE;
    }

    initialized_ = true;
  }

  // Publish message
  if (type_ == "std_msgs/msg/Bool") {
    std_msgs::msg::Bool msg;
    msg.data = (msg_on_topic == "true");
    bool_pub_->publish(msg);
  }
  else if (type_ == "std_msgs/msg/String") {
    std_msgs::msg::String msg;
    msg.data = msg_on_topic;
    string_pub_->publish(msg);
  }
  else if (type_ == "std_msgs/msg/Int32") {
    std_msgs::msg::Int32 msg;
    msg.data = std::stoi(msg_on_topic);
    int32_pub_->publish(msg);
  }

  return BT::NodeStatus::SUCCESS;
}

BT::PortsList PublishDataOnTopic::providedPorts()
{
  return {
      BT::InputPort<std::string>("type_of_topic"),
      BT::InputPort<std::string>("msg_on_topic"),
      BT::InputPort<std::string>("topic_name")
  };
}
