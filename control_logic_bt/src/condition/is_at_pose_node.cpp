#include "control_logic_bt/condition/is_at_pose_node.hpp"
#include <cmath>

using namespace std::chrono;

// ------------------------------------------------------------------
// Constructor: intentionally does NO ROS work, NO subscriptions, NO
// file I/O, and NO threads. This runs during tree validation too, so
// doing work here (as the old version did) created duplicate nodes and
// detached threads that outlived the throwaway validation tree -> the
// segfault. All setup is deferred to the first tick().
// ------------------------------------------------------------------
IsAtPose::IsAtPose(const std::string &name, const BT::NodeConfiguration &config)
    : BT::ConditionNode(name, config)
{
    yaml_filepath_ =
        "/home/nextup/NextupRobot/src/active_project_configs/planning_data/points.yaml";
}

// ------------------------------------------------------------------
// ensureNode: shared runner node from blackboard, or private fallback.
// ------------------------------------------------------------------
bool IsAtPose::ensureNode()
{
    if (node_)
        return true;

    if (config().blackboard->get("node", node_) && node_)
    {
        self_spun_ = false;
        return true;
    }

    node_ = rclcpp::Node::make_shared("is_at_pose_bt_node");
    self_spun_ = true;

    std::thread([n = node_]()
    {
        rclcpp::executors::SingleThreadedExecutor exec;
        exec.add_node(n);
        exec.spin();
    }).detach();

    RCLCPP_WARN(node_->get_logger(),
                "[IsAtPose] No shared 'node' on blackboard; created a private "
                "node + spin thread as fallback.");
    return static_cast<bool>(node_);
}

// ------------------------------------------------------------------
// ensureSubscription: subscribe to /joint_states once.
// ------------------------------------------------------------------
void IsAtPose::ensureSubscription()
{
    if (subscribed_)
        return;

    joint_state_sub_ = node_->create_subscription<sensor_msgs::msg::JointState>(
        "/joint_states", rclcpp::SensorDataQoS(),
        std::bind(&IsAtPose::jointStateCallback, this, std::placeholders::_1));

    subscribed_ = true;
    RCLCPP_INFO(node_->get_logger(), "[IsAtPose] Subscribed to /joint_states");
}

// ------------------------------------------------------------------
// jointStateCallback: store positions keyed by joint name.
// ------------------------------------------------------------------
void IsAtPose::jointStateCallback(const sensor_msgs::msg::JointState::SharedPtr msg)
{
    std::lock_guard<std::mutex> lock(joint_mutex_);
    for (size_t i = 0; i < msg->name.size() && i < msg->position.size(); ++i)
        current_positions_[msg->name[i]] = msg->position[i];
    have_joint_state_ = true;
}

// ------------------------------------------------------------------
// loadTargetYaml: (re)load the named targets from points.yaml.
// ------------------------------------------------------------------
void IsAtPose::loadTargetYaml()
{
    std::lock_guard<std::mutex> lock(yaml_mutex_);
    try
    {
        YAML::Node yaml_data = YAML::LoadFile(yaml_filepath_);
        std::unordered_map<std::string, std::vector<double>> new_map;

        for (const auto &pt : yaml_data["points"])
        {
            const auto &joints = pt["joints_values"];
            std::vector<double> joint_vals;
            joint_vals.reserve(joint_order_.size());
            for (const auto &jn : joint_order_)
                joint_vals.push_back(joints[jn].as<double>());

            new_map[pt["name"].as<std::string>()] = std::move(joint_vals);
        }

        target_map_      = std::move(new_map);
        last_write_time_ = std::filesystem::last_write_time(yaml_filepath_);
        yaml_time_valid_ = true;
        yaml_loaded_.store(true);

        RCLCPP_INFO(node_->get_logger(),
                    "[IsAtPose] Loaded %zu targets from YAML", target_map_.size());
    }
    catch (const std::exception &e)
    {
        RCLCPP_ERROR(node_->get_logger(),
                     "[IsAtPose] Failed to load target YAML: %s", e.what());
        yaml_loaded_.store(false);
    }
}

// ------------------------------------------------------------------
// maybeReloadYaml: throttled mtime check, called from tick(). Replaces
// the old detached file-watcher thread (no thread => no use-after-free).
// ------------------------------------------------------------------
void IsAtPose::maybeReloadYaml()
{
    auto now = steady_clock::now();
    if (yaml_loaded_.load() &&
        (now - last_yaml_check_) < milliseconds(1000))
        return;                       // checked recently; skip stat()
    last_yaml_check_ = now;

    try
    {
        auto current = std::filesystem::last_write_time(yaml_filepath_);
        if (!yaml_time_valid_ || current != last_write_time_)
            loadTargetYaml();
    }
    catch (const std::exception &e)
    {
        RCLCPP_ERROR_THROTTLE(node_->get_logger(), *node_->get_clock(), 5000,
                              "[IsAtPose] Error checking YAML mtime: %s", e.what());
    }
}

// ------------------------------------------------------------------
// tick
// ------------------------------------------------------------------
BT::NodeStatus IsAtPose::tick()
{
    if (!ensureNode())
        return BT::NodeStatus::FAILURE;

    ensureSubscription();
    maybeReloadYaml();

    if (!self_spun_)
        rclcpp::spin_some(node_);

    if (!yaml_loaded_.load())
    {
        RCLCPP_ERROR_THROTTLE(node_->get_logger(), *node_->get_clock(), 2000,
                              "[IsAtPose] YAML not loaded");
        return BT::NodeStatus::FAILURE;
    }

    std::string target_name;
    if (!getInput("target_name", target_name) || target_name.empty())
    {
        RCLCPP_ERROR(node_->get_logger(), "[IsAtPose] Missing input [target_name]");
        return BT::NodeStatus::FAILURE;
    }

    double tolerance = 0.05;
    getInput("tolerance", tolerance);
    if (tolerance <= 0.0)
        tolerance = 0.05;

    // Copy the expected target under lock.
    std::vector<double> expected;
    {
        std::lock_guard<std::mutex> yaml_lock(yaml_mutex_);
        auto it = target_map_.find(target_name);
        if (it == target_map_.end())
        {
            RCLCPP_ERROR_THROTTLE(node_->get_logger(), *node_->get_clock(), 2000,
                                  "[IsAtPose] Target [%s] not found in YAML",
                                  target_name.c_str());
            return BT::NodeStatus::FAILURE;
        }
        expected = it->second;
    }

    // Compare current joint positions by NAME against expected.
    std::lock_guard<std::mutex> joint_lock(joint_mutex_);
    if (!have_joint_state_)
        return BT::NodeStatus::FAILURE;

    for (size_t i = 0; i < joint_order_.size(); ++i)
    {
        auto jt = current_positions_.find(joint_order_[i]);
        if (jt == current_positions_.end())
        {
            RCLCPP_ERROR_THROTTLE(node_->get_logger(), *node_->get_clock(), 2000,
                                  "[IsAtPose] Joint [%s] missing from /joint_states",
                                  joint_order_[i].c_str());
            return BT::NodeStatus::FAILURE;
        }
        if (std::abs(jt->second - expected[i]) > tolerance)
            return BT::NodeStatus::FAILURE;
    }

    return BT::NodeStatus::SUCCESS;
}