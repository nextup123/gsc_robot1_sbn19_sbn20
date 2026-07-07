#include <rclcpp/rclcpp.hpp>
#include <std_srvs/srv/trigger.hpp>
#include <std_srvs/srv/set_bool.hpp>
#include <behaviortree_cpp_v3/bt_factory.h>
#include <csignal>
#include <atomic>
#include <memory>
#include <thread>

#include <behaviortree_cpp_v3/loggers/bt_zmq_publisher.h>
#include "behaviortree_cpp_v3/loggers/bt_cout_logger.h"
#include "behaviortree_cpp_v3/loggers/bt_minitrace_logger.h"
#include "behaviortree_cpp_v3/loggers/bt_file_logger.h"

#include "sleep_node.hpp"
#include "start_control_node.hpp"
#include "msg_logger_node.hpp"
#include "shutdown_bt.hpp"
#include "pause_control_node.hpp"
#include "popup_msg_node.hpp"
#include "publish_data_bt_node.hpp"
#include "reset_tree_trigger.hpp"
#include "bt_plan_path.hpp"
#include "bt_clean_file.hpp"
#include "bt_copy_field.hpp"
#include "bt_copy_file.hpp"
#include "bt_point_path_verification.hpp"
#include "auto_run_path_xml.hpp"







std::atomic<bool> running(true);

enum class TreeType
{
    PRODUCTION,
    TESTING
};

void signalHandler(int signum)
{
    RCLCPP_INFO(rclcpp::get_logger("motion_plan_bt_runner"), "Received signal %d. Shutting down...", signum);
    running = false;
}

void register_all_nodes(BT::BehaviorTreeFactory &factory, const rclcpp::Node::SharedPtr &node)
{
    // Clear any previously registered nodes
    factory = BT::BehaviorTreeFactory();

    // Register all node types
    factory.registerBuilder<StartControlNode>(
        "Start",
        [=](const std::string &name, const BT::NodeConfiguration &config)
        {
            return std::make_unique<StartControlNode>(name, config, node);
        });

    factory.registerBuilder<bt_plan::PlanPath>(
    "PlanPath",
    [node](const std::string &name, const BT::NodeConfiguration &config) {
        return std::make_unique<bt_plan::PlanPath>(name, config, node);
    });
    
    factory.registerBuilder<bt_clean::CleanFile>(
    "CleanFile",
    [node](const std::string &name, const BT::NodeConfiguration &config) {
        return std::make_unique<bt_clean::CleanFile>(name, config, node);
    });

    factory.registerBuilder<bt_copy_fields::CopyFields>(
    "CopyFields",
    [node](const std::string &name, const BT::NodeConfiguration &config) {
        return std::make_unique<bt_copy_fields::CopyFields>(name, config, node);
    });

    factory.registerBuilder<bt_copy::CopyFile>(
    "CopyFile",
    [node](const std::string &name, const BT::NodeConfiguration &config) {
        return std::make_unique<bt_copy::CopyFile>(name, config, node);
    });


    factory.registerBuilder<bt_point_path_verification::PathVerifier>(
    "PathVerifier",
    [node](const std::string &name, const BT::NodeConfiguration &config) {
        return std::make_unique<bt_point_path_verification::PathVerifier>(name, config, node);
    });

    factory.registerBuilder<auto_run_path_xml::AutoRunPathXml>(
    "AutoRunPathXml",
    [node](const std::string &name, const BT::NodeConfiguration &config) {
        return std::make_unique<auto_run_path_xml::AutoRunPathXml>(name, config, node);
    });

    factory.registerNodeType<SleepNode>("Sleep");
    factory.registerNodeType<MsgLoggerNode>("MsgLoggerNode");
    factory.registerNodeType<ShutdownNode>("ShutdownNode");
    factory.registerNodeType<PauseControlNode>("PauseControl");
    factory.registerNodeType<PopupMsgNode>("PopupMsg");
    factory.registerNodeType<PublishDataOnTopic>("PublishDataOnTopic");
    factory.registerNodeType<ResetTreeTrigger>("ResetTreeTrigger");






}

bool reload_tree(
    BT::BehaviorTreeFactory &factory,
    BT::Tree &tree,
    std::unique_ptr<BT::PublisherZMQ> &publisher_zmq,
    const std::string &xml_path,
    rclcpp::Logger logger,
    const rclcpp::Node::SharedPtr &node)
{
    RCLCPP_INFO(logger, "Reloading behavior tree from %s", xml_path.c_str());

    // Step 1: Halt and destroy the old tree
    tree.haltTree();
    publisher_zmq.reset();

    // Small delay to ensure all resources are released
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    // Step 2: Clear and re-register all nodes
    register_all_nodes(factory, node);

    // Step 3: Load new tree
    try
    {
        tree = factory.createTreeFromFile(xml_path);
        // publisher_zmq = std::make_unique<BT::PublisherZMQ>(tree);
        publisher_zmq = std::make_unique<BT::PublisherZMQ>(tree, 2676, 2677);

        RCLCPP_INFO(logger, "Behavior tree reloaded successfully.");
        return true;
    }
    catch (const std::exception &e)
    {
        RCLCPP_ERROR(logger, "Failed to reload tree: %s", e.what());
        return false;
    }
}

void reload_service_callback(
    const std::shared_ptr<std_srvs::srv::Trigger::Request> request,
    std::shared_ptr<std_srvs::srv::Trigger::Response> response,
    BT::BehaviorTreeFactory &factory,
    BT::Tree &tree,
    std::unique_ptr<BT::PublisherZMQ> &publisher_zmq,
    TreeType current_tree_type,
    const std::string &prod_xml_path,
    const std::string &test_xml_path,
    const rclcpp::Node::SharedPtr &node)
{
    (void)request;
    const std::string &xml_path = (current_tree_type == TreeType::PRODUCTION) ? prod_xml_path : test_xml_path;
    response->success = reload_tree(factory, tree, publisher_zmq, xml_path, rclcpp::get_logger("motion_plan_bt_runner"), node);
    response->message = response->success ? "Behavior tree reloaded successfully." : "Failed to reload tree.";
}

void switch_service_callback(
    const std::shared_ptr<std_srvs::srv::SetBool::Request> request,
    std::shared_ptr<std_srvs::srv::SetBool::Response> response,
    BT::BehaviorTreeFactory &factory,
    BT::Tree &tree,
    std::unique_ptr<BT::PublisherZMQ> &publisher_zmq,
    TreeType &current_tree_type,
    const std::string &prod_xml_path,
    const std::string &test_xml_path,
    const rclcpp::Node::SharedPtr &node)
{
    current_tree_type = request->data ? TreeType::PRODUCTION : TreeType::TESTING;
    const std::string &xml_path = request->data ? prod_xml_path : test_xml_path;
    response->success = reload_tree(factory, tree, publisher_zmq, xml_path, rclcpp::get_logger("motion_plan_bt_runner"), node);
    response->message = response->success ? (request->data ? "Switched to production tree." : "Switched to testing tree.") : "Failed to switch tree.";
}
bool g_shutdown_requested = false;

int main(int argc, char **argv)
{
    signal(SIGINT, signalHandler);
    signal(SIGTERM, signalHandler);

    rclcpp::init(argc, argv);
    auto node = rclcpp::Node::make_shared("motion_plan_bt_runner");
    PauseControlUtil::set_node(node);

    BT::BehaviorTreeFactory factory;
    register_all_nodes(factory, node);

    // const std::string prod_xml_path = "/home/nextup/GscRobot/src/gsc_bt_pkg/behavior_tree.xml";
    const std::string prod_xml_path = "/home/nextup/NextupRobot/src/active_project_configs/planning_data/plan_path.xml";

    // const std::string prod_xml_path = "/home/nextup/micron_x_ws/src/new_micron_bt/bt_micron_one.xml";
    const std::string test_xml_path = "/home/nextup/NextupRobot/src/active_project_configs/planning_data/plan_path.xml";
    TreeType current_tree_type = TreeType::PRODUCTION; // Start with production tree

    BT::Tree tree = factory.createTreeFromFile(prod_xml_path);
    // auto publisher_zmq = std::make_unique<BT::PublisherZMQ>(tree);
    auto publisher_zmq = std::make_unique<BT::PublisherZMQ>(tree, 2676, 2677);


    auto reload_srv = node->create_service<std_srvs::srv::Trigger>(
        "/reload_bt",
        std::bind(reload_service_callback, std::placeholders::_1, std::placeholders::_2,
                  std::ref(factory), std::ref(tree), std::ref(publisher_zmq),
                  current_tree_type, prod_xml_path, test_xml_path, node));

    auto switch_srv = node->create_service<std_srvs::srv::SetBool>(
        "/switch_bt",
        std::bind(switch_service_callback, std::placeholders::_1, std::placeholders::_2,
                  std::ref(factory), std::ref(tree), std::ref(publisher_zmq),
                  std::ref(current_tree_type), prod_xml_path, test_xml_path, node));

    rclcpp::Rate loop_rate(100.0);
    while (rclcpp::ok() && running && !g_shutdown_requested)
    {
        try
        {
            tree.tickRoot();
        }
        catch (const BT::RuntimeError &e)
        {
            if (std::string(e.what()) == "RESET_TREE_REQUEST")
            {
                RCLCPP_INFO(node->get_logger(), "[Main] Reset requested. Halting and restarting tree...");
                tree.haltTree();
            }
            else if (std::string(e.what()) == "ABORT_PROCESS_REQUESTED")
            {
                RCLCPP_INFO(node->get_logger(), "[Main] Abort requested. Halting tree and returning to start...");
                tree.haltTree();
            }
            else
            {
                throw;
            }
        }

        rclcpp::spin_some(node);
        loop_rate.sleep();
    }

    RCLCPP_INFO(node->get_logger(), "Shutting down behavior tree...");
    tree.haltTree();
    publisher_zmq.reset();
    
    rclcpp::shutdown();
    RCLCPP_INFO(node->get_logger(), "Shutdown complete.");
    return 0;
}