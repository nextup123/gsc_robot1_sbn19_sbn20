#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/string.hpp>
#include <csignal>
#include <atomic>
#include <memory>
#include <ament_index_cpp/get_package_share_directory.hpp>

#include <behaviortree_cpp_v3/loggers/bt_zmq_publisher.h>
#include "behaviortree_cpp_v3/loggers/bt_cout_logger.h"
#include "behaviortree_cpp_v3/loggers/bt_minitrace_logger.h"
#include "behaviortree_cpp_v3/loggers/bt_file_logger.h"

#include "control_logic_bt/control/start_control_node.hpp"
#include "control_logic_bt/control/pause_control_node.hpp"
#include "control_logic_bt/control/alternating_selector_node.hpp"

// #include "control_logic_bt/decorator/general_one_shot.hpp"
#include "control_logic_bt/decorator/delay_ticks.hpp"
#include "control_logic_bt/decorator/wait_until_true.hpp"
#include "control_logic_bt/decorator/run_once_node.hpp"

#include "control_logic_bt/condition/is_at_pose_node.hpp"
#include "control_logic_bt/condition/check_bool_topic.hpp"

#include "control_logic_bt/motion/cartesian_mover_bt.hpp"
#include "control_logic_bt/motion/plan_and_execute_node.hpp"
#include "control_logic_bt/motion/pilz_points_planner.hpp"
#include "control_logic_bt/motion/pilz_motion_planner_bt.hpp"
#include "control_logic_bt/motion/pilz_circ_planner.hpp"
#include "control_logic_bt/motion/blend_motion_bt.hpp"
#include "control_logic_bt/motion/run_path_node.hpp"





#include "control_logic_bt/action/sleep_node.hpp"
#include "control_logic_bt/action/msg_logger_node.hpp"
#include "control_logic_bt/action/shutdown_bt.hpp"
#include "control_logic_bt/action/popup_msg_node.hpp"
#include "control_logic_bt/action/reset_tree_trigger.hpp"
#include "control_logic_bt/action/publish_data_bt_node.hpp"
#include "control_logic_bt/action/cycle_counter_node.hpp"
#include "control_logic_bt/action/bt_do_control.hpp"
#include "control_logic_bt/action/bt_di_control.hpp"

#include "control_logic_bt/blackboard/print_message_node.hpp"
#include "control_logic_bt/blackboard/arithmetic_node.hpp"
#include "control_logic_bt/blackboard/compare_node.hpp"
#include "control_logic_bt/blackboard/make_pilz_motion_node.hpp"
#include "control_logic_bt/blackboard/add_pilz_point_node.hpp"
#include "control_logic_bt/blackboard/set_var_node.hpp"
#include "control_logic_bt/blackboard/modulo_node.hpp"
#include "control_logic_bt/blackboard/math_expression_node.hpp"
#include "control_logic_bt/blackboard/timer_start_node.hpp"
#include "control_logic_bt/blackboard/timer_stop_node.hpp"
#include "control_logic_bt/blackboard/timer_reset_node.hpp"
#include "control_logic_bt/blackboard/wait_for_blackboard_change_node.hpp"
#include "control_logic_bt/blackboard/subscribe_to_blackboard_node.hpp"
#include "control_logic_bt/blackboard/publish_blackboard_node.hpp"

#include "control_logic_bt/motion/plan_and_execute_arc_hybrid.hpp"

#include "control_logic_bt/blackboard/add_pilz_point_node.hpp"
#include "control_logic_bt/blackboard/arithmetic_node.hpp"
#include "control_logic_bt/blackboard/compare_node.hpp"
#include "control_logic_bt/blackboard/make_pilz_motion_node.hpp"
#include "control_logic_bt/blackboard/math_expression_node.hpp"
#include "control_logic_bt/blackboard/modulo_node.hpp"
#include "control_logic_bt/blackboard/publish_blackboard_node.hpp"
#include "control_logic_bt/blackboard/print_message_node.hpp"
#include "control_logic_bt/blackboard/set_var_node.hpp"
#include "control_logic_bt/blackboard/subscribe_to_blackboard_node.hpp"
#include "control_logic_bt/blackboard/timer_reset_node.hpp"
#include "control_logic_bt/blackboard/timer_start_node.hpp"
#include "control_logic_bt/blackboard/timer_stop_node.hpp"
#include "control_logic_bt/blackboard/wait_for_blackboard_change_node.hpp"

std::atomic<bool> running(true);
bool g_shutdown_requested = false;

rclcpp::Publisher<std_msgs::msg::String>::SharedPtr g_logs_pub;
rclcpp::Publisher<std_msgs::msg::String>::SharedPtr g_popup_pub;

void signalHandler(int signum)
{
    RCLCPP_INFO(rclcpp::get_logger("control_logic_bt_runner"), "Received signal %d. Shutting down...", signum);
    running = false;
}

void register_all_nodes(BT::BehaviorTreeFactory &factory, const rclcpp::Node::SharedPtr &node)
{
    factory = BT::BehaviorTreeFactory();

    factory.registerBuilder<StartControlNode>(
        "Start",
        [=](const std::string &name, const BT::NodeConfiguration &config)
        {
            return std::make_unique<StartControlNode>(name, config, node);
        });

    factory.registerBuilder<bt_control::DoControl>(
        "DoControl",
        [node](const std::string &name, const BT::NodeConfiguration &config)
        {
            return std::make_unique<bt_control::DoControl>(name, config, node);
        });

    factory.registerBuilder<bt_control::DIControl>(
        "DIControl",
        [node](const std::string &name, const BT::NodeConfiguration &config)
        {
            return std::make_unique<bt_control::DIControl>(name, config, node);
        });

    factory.registerNodeType<SleepNode>("Sleep");
    factory.registerNodeType<ShutdownNode>("ShutdownNode");
    factory.registerNodeType<PauseControlNode>("PauseControl");
    factory.registerNodeType<PublishDataOnTopic>("PublishDataOnTopic");
    factory.registerNodeType<ResetTreeTrigger>("ResetTreeTrigger");
    factory.registerNodeType<WaitUntilTrue>("WaitUntilTrue");

    factory.registerNodeType<IsAtPose>("IsAtPose");
    factory.registerNodeType<CheckBoolTopic>("CheckBoolTopic");

    factory.registerNodeType<AlternatingSelector>("AlternatingSelector");
    factory.registerNodeType<CycleCounterNode>("CycleCounter");
    factory.registerNodeType<RunOnce>("RunOnce");
    factory.registerNodeType<DelayTicks>("DelayTicks");
    factory.registerNodeType<PlanAndExecuteArcHybrid>("PlanAndExecuteArcHybrid");

    factory.registerBuilder<bt_logger::MsgLoggerNode>(
        "MsgLogger",
        [node](const std::string &name, const BT::NodeConfiguration &config)
        {
            return std::make_unique<bt_logger::MsgLoggerNode>(name, config);
        });

    factory.registerBuilder<bt_popup::PopupMsgNode>(
        "MsgPopup",
        [node](const std::string &name, const BT::NodeConfiguration &config)
        {
            return std::make_unique<bt_popup::PopupMsgNode>(name, config);
        });

    
    factory.registerNodeType<PlanAndExecutePoseHybrid>("PlanAndExecute");
    factory.registerNodeType<PilzMotionPlanner>("PilzFramePlanner");
    factory.registerNodeType<PilzPointsPlanner>("PilzPointsPlanner");
    factory.registerNodeType<BlendMotion>("PilzPointsBlend");
    factory.registerNodeType<RunPath>("RunPath");
    factory.registerNodeType<control_logic_bt::CartesianMoverBT>("CartesianMover");
    factory.registerBuilder<PilzCircPlanner>(
        "PilzCircPlanner",
        [](const std::string &name, const BT::NodeConfiguration &config)
        {
            return std::make_unique<PilzCircPlanner>(name, config);
        });

    // 👉 Blackboards
    factory.registerNodeType<PrintMessage>("PrintMessage");
    factory.registerNodeType<ArithmeticNode>("ArithmeticNode");
    // factory.registerNodeType<SleepNode>("Sleep");
    factory.registerNodeType<Compare>("Compare");
    // factory.registerNodeType<RunOnce>("RunOnce");

    factory.registerNodeType<MakePilzMotion>("MakePilzMotion");
    factory.registerNodeType<AddPilzPoint>("AddPilzPoint");
    factory.registerNodeType<SetVar>("SetVar");
    factory.registerNodeType<Modulo>("Modulo");
    factory.registerNodeType<MathExpression>("MathExpression");

    factory.registerNodeType<TimerStart>("TimerStart");
    factory.registerNodeType<TimerStop>("TimerStop");
    factory.registerNodeType<TimerReset>("TimerReset");
    factory.registerNodeType<WaitForBlackboardChange>("WaitForBlackboardChange");
    factory.registerNodeType<SubscribeToBlackboard>("SubscribeToBlackboard");
    factory.registerNodeType<PublishBlackboard>("PublishBlackboard");
}

std::string make_hint_from_error(const std::string &err)
{
    if (err.find("A Control node must have at least 1 child") != std::string::npos)
        return "A control node like <Sequence>, <Fallback>, or <ReactiveSequence> is empty. Add at least one child node inside it.";
    if (err.find("Node not recognized") != std::string::npos)
        return "A node name in XML is not registered in C++. Check for typo or missing registration.";
    if (err.find("missing required attribute") != std::string::npos)
        return "A BT node is missing a required XML attribute or port.";
    if (err.find("line") != std::string::npos)
        return "Check the mentioned XML line for wrong nesting, empty control nodes, bad tag names, or missing attributes.";
    return "Check XML structure, node names, ports, and registered BT node types.";
}

class BTFailureTracer : public BT::StatusChangeLogger
{
public:
    BTFailureTracer(BT::Tree &tree, rclcpp::Node::SharedPtr node)
        : BT::StatusChangeLogger(tree.rootNode()),
          root_(tree.rootNode()),
          node_(node)
    {
        pub_ = node_->create_publisher<std_msgs::msg::String>("/logs_topic", 10);
    }

    void callback(BT::Duration /*timestamp*/,
                  const BT::TreeNode &node,
                  BT::NodeStatus prev_status,
                  BT::NodeStatus status) override
    {
        if (status == BT::NodeStatus::FAILURE && prev_status != BT::NodeStatus::FAILURE)
        {
            bool is_leaf = (dynamic_cast<const BT::ControlNode *>(&node) == nullptr &&
                            dynamic_cast<const BT::DecoratorNode *>(&node) == nullptr);
            if (!is_leaf)
                return;

            std::time_t now = std::time(nullptr);
            char tbuf[64];
            std::strftime(tbuf, sizeof(tbuf), "%a %b %d %H:%M:%S %Y", std::localtime(&now));

            std::vector<std::string> path;
            find_path(root_, node.name(), path);
            std::reverse(path.begin(), path.end());

            std::string trace;
            for (size_t i = 0; i < path.size(); ++i)
                trace += path[i] + (i + 1 < path.size() ? " -> " : "");

            std_msgs::msg::String msg;
            msg.data = "[failure]FAILED_NODE: " + node.name() +
                       " TRACE: " + (trace.empty() ? node.name() : trace) +
                       " TIME: " + std::string(tbuf);

            pub_->publish(msg);
            RCLCPP_WARN(node_->get_logger(), "%s", msg.data.c_str());
        }
    }

    void flush() override {}

private:
    bool find_path(const BT::TreeNode *cur, const std::string &target,
                   std::vector<std::string> &path)
    {
        if (!cur)
            return false;
        path.push_back(cur->name());
        if (cur->name() == target)
            return true;

        if (auto *ctrl = dynamic_cast<const BT::ControlNode *>(cur))
            for (size_t i = 0; i < ctrl->childrenCount(); ++i)
                if (find_path(ctrl->child(i), target, path))
                    return true;

        if (auto *deco = dynamic_cast<const BT::DecoratorNode *>(cur))
            if (find_path(deco->child(), target, path))
                return true;

        path.pop_back();
        return false;
    }

    const BT::TreeNode *root_;
    rclcpp::Node::SharedPtr node_;
    rclcpp::Publisher<std_msgs::msg::String>::SharedPtr pub_;
};

void publishLog(
    rclcpp::Node::SharedPtr node,
    const std::string &type,
    const std::string &msg)
{
    if (!g_logs_pub)
    {
        return;
    }

    std_msgs::msg::String log_msg;
    log_msg.data = "[" + type + "] " + msg;

    g_logs_pub->publish(log_msg);

    rclcpp::spin_some(node);
}

void publishPopup(
    rclcpp::Node::SharedPtr node,
    const std::string &msg,
    const std::string &type,
    int timeout_secs)
{
    if (!g_popup_pub)
    {
        return;
    }

    std_msgs::msg::String popup_msg;

    popup_msg.data =
        msg + "," +
        type + "," +
        std::to_string(timeout_secs);

    g_popup_pub->publish(popup_msg);

    rclcpp::spin_some(node);
}

int main(int argc, char **argv)
{
    signal(SIGINT, signalHandler);
    signal(SIGTERM, signalHandler);

    rclcpp::init(argc, argv);
    auto node = rclcpp::Node::make_shared("control_logic_bt_runner");
    PauseControlUtil::set_node(node);
    PrintMessage::set_node(node); 

    g_logs_pub =
        node->create_publisher<std_msgs::msg::String>(
            "/logs_topic",
            rclcpp::QoS(10).reliable());

    g_popup_pub =
        node->create_publisher<std_msgs::msg::String>(
            "/bt_toast_popup",
            rclcpp::QoS(10).reliable());
    rclcpp::sleep_for(std::chrono::milliseconds(500)); // Ensure publishers are ready

    const std::string xml_path = "/home/nextup/NextupRobot/src/active_project_configs/control_data/main_tree.xml";

    // Validate XML before doing anything else
    BT::BehaviorTreeFactory factory;
    register_all_nodes(factory, node);

    RCLCPP_INFO(node->get_logger(), "===== Registered BT Nodes =====");

    for (const auto &[id, manifest] : factory.manifests())
    {
        RCLCPP_INFO(
            node->get_logger(),
            "Node: %-30s Type: %d",
            id.c_str(),
            static_cast<int>(manifest.type));
    }

    RCLCPP_INFO(node->get_logger(), "===============================");

    // Create blackboard and share the node for WaitUntilTrue and other nodes
    auto blackboard = BT::Blackboard::create();
    blackboard->set("node", node);

    try
    {
        // Use a different name for validation tree to avoid conflict
        BT::Tree validation_tree = factory.createTreeFromFile(xml_path, blackboard);
        (void)validation_tree; // Validation successful
        RCLCPP_INFO(node->get_logger(), "XML validation passed: %s", xml_path.c_str());
        publishLog(node, "success", "BT XML validation passed: " + xml_path);
    }
    catch (const std::exception &e)
    {
        std::string error_msg = e.what();
        std::string hint_msg = make_hint_from_error(error_msg);

        publishLog(node, "error", "BT XML validation failed: " + error_msg);
        publishLog(node, "info", "Hint: " + hint_msg);
        publishPopup(node, "BT XML ERROR : check logs", "failure", 0);

        RCLCPP_ERROR(node->get_logger(), "XML validation failed: %s", error_msg.c_str());
        RCLCPP_ERROR(node->get_logger(), "Hint: %s", hint_msg.c_str());

        rclcpp::shutdown();
        return 1; // Exit with error code
    }

    // XML valid - now create the actual tree and run
    BT::Tree tree = factory.createTreeFromFile(xml_path, blackboard);
    BT::FileLogger fbl_logger(tree, "my_bt_log.fbl");
    BT::FileLogger json_logger(tree, "my_bt_log.json");
    auto publisher_zmq = std::make_unique<BT::PublisherZMQ>(tree, 1667, 1666);
    auto failure_tracer = std::make_unique<BTFailureTracer>(tree, node);

    publishLog(node, "success", "Behavior Tree started successfully");
    publishPopup(node, "Behavior Tree started", "success", 3);

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