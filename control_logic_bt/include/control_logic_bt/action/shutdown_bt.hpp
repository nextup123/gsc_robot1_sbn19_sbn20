#include <behaviortree_cpp_v3/action_node.h>
#include <rclcpp/rclcpp.hpp>

extern bool g_shutdown_requested;  // global flag

class ShutdownNode : public BT::SyncActionNode
{
public:
    ShutdownNode(const std::string& name, const BT::NodeConfiguration& config)
        : BT::SyncActionNode(name, config)
    {}

    static BT::PortsList providedPorts()
    {
        return {};
    }

    BT::NodeStatus tick() override
    {
        RCLCPP_WARN(rclcpp::get_logger("ShutdownNode"), "Shutdown requested. Stopping BT runner...");
        g_shutdown_requested = true;
        return BT::NodeStatus::SUCCESS;
    }
};
