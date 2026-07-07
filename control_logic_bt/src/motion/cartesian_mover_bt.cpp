#include "control_logic_bt/motion/cartesian_mover_bt.hpp"

namespace control_logic_bt
{

    // ============================================================================
    // STATIC PLANNER INITIALIZATION
    // ============================================================================

    static std::map<std::string, PlannerConfig> createPlannerMap()
    {
        std::map<std::string, PlannerConfig> planners;

        // RRT Family
        planners["rrt"] = {"ompl", "RRTkConfigDefault", "Basic RRT - Fast but not optimal", 0.1, 15.0};
        planners["rrtconnect"] = {"ompl", "RRTConnectkConfigDefault", "Bidirectional RRT - Very fast, most reliable", 0.12, 12.0};
        planners["rrtstar"] = {"ompl", "RRTstarkConfigDefault", "RRT* - Asymptotically optimal", 0.08, 20.0};
        planners["rrtxstatic"] = {"ompl", "RRTXstatickConfigDefault", "RRTX - Dynamic replanning", 0.09, 18.0};
        planners["lbrrt"] = {"ompl", "LBTRRTkConfigDefault", "Lattice-based RRT - Good for narrow passages", 0.08, 15.0};
        planners["trrt"] = {"ompl", "TRRTkConfigDefault", "Transition-based RRT", 0.1, 15.0};
        planners["strrt"] = {"ompl", "STRRTkConfigDefault", "Sparse RRT - Memory efficient", 0.09, 18.0};
        planners["rrtsharp"] = {"ompl", "RRTsharpkConfigDefault", "RRT# - RRT* with heuristics", 0.08, 20.0};

        // PRM Family
        planners["prm"] = {"ompl", "PRMkConfigDefault", "Basic PRM - Multi-query", 0.1, 15.0};
        planners["prmstar"] = {"ompl", "PRMstarkConfigDefault", "PRM* - Asymptotically optimal multi-query", 0.08, 20.0};
        planners["lazyprm"] = {"ompl", "LazyPRMkConfigDefault", "Lazy PRM - Very fast construction", 0.12, 12.0};
        planners["lazyprmstar"] = {"ompl", "LazyPRMstarkConfigDefault", "Lazy PRM* - Optimal lazy planning", 0.1, 15.0};
        planners["spars"] = {"ompl", "SPARSkConfigDefault", "SPARS - Sparse roadmap", 0.09, 18.0};
        planners["spars2"] = {"ompl", "SPARS2kConfigDefault", "SPARS2 - Improved sparse roadmap", 0.09, 18.0};

        // EST Family
        planners["est"] = {"ompl", "ESTkConfigDefault", "EST - Good for narrow passages", 0.08, 15.0};
        planners["projest"] = {"ompl", "ProjESTkConfigDefault", "Projected EST - With projection", 0.08, 15.0};

        // KPIECE Family
        planners["kpiece"] = {"ompl", "KPIECEkConfigDefault", "KPIECE - For high-dimensional spaces", 0.09, 15.0};
        planners["bkpiece"] = {"ompl", "BKPIECEkConfigDefault", "BKPIECE - Best for wide open spaces", 0.12, 12.0};
        planners["lbkpiece"] = {"ompl", "LBKPIECEkConfigDefault", "LBKPIECE - Lattice-based KPIECE", 0.1, 14.0};

        // SBL Family
        planners["sbl"] = {"ompl", "SBLkConfigDefault", "SBL - Single-query bidirectional", 0.1, 15.0};
        planners["pdsbl"] = {"ompl", "PDSTkConfigDefault", "PDST - Path-directed subdivision tree", 0.09, 16.0};

        // Informed Planners
        planners["bitstar"] = {"ompl", "BITstarkConfigDefault", "BIT* - Batch Informed Trees (Optimal)", 0.07, 25.0};
        planners["aitstar"] = {"ompl", "AITstarkConfigDefault", "AIT* - Adaptive Informed Trees", 0.07, 25.0};
        planners["abitstar"] = {"ompl", "ABITstarkConfigDefault", "ABIT* - Anytime BIT*", 0.07, 25.0};

        // FMT Family
        planners["fmt"] = {"ompl", "FMTkConfigDefault", "FMT* - Fast Marching Trees", 0.08, 18.0};
        planners["bfmt"] = {"ompl", "BFMTkConfigDefault", "BFMT* - Bidirectional FMT*", 0.09, 16.0};

        // Specialized
        planners["clrrt"] = {"ompl", "CLRRTkConfigDefault", "Closed-loop RRT", 0.09, 18.0};
        planners["lrrt"] = {"ompl", "LRRTkConfigDefault", "Lazy RRT", 0.11, 13.0};
        planners["stride"] = {"ompl", "STRIDEkConfigDefault", "STRIDE - Single-query informed planning", 0.08, 20.0};
        planners["tfd"] = {"ompl", "TFDkConfigDefault", "TFD - Task-specific planning", 0.09, 17.0};
        planners["trivial"] = {"ompl", "TrivialkConfigDefault", "Trivial - Direct connection", 0.15, 5.0};

        return planners;
    }

    // Static YAML path
    const std::string POINTS_YAML_PATH = "/home/nextup/NextupRobot/src/active_project_configs/planning_data/points.yaml";
    const std::string ROOT_FRAME = "base_link";
    const std::string EEF_LINK = "end";
    const std::string ARM_GROUP = "robot_manipulator";
    const std::vector<std::string> JOINT_NAMES = {"joint2", "joint3", "joint1", "joint4", "joint5", "joint6"};
    const std::vector<double> DEFAULT_RPY = {M_PI, 0.0, 0.0};

    // ============================================================================
    // CartesianMoverBT Implementation
    // ============================================================================

    CartesianMoverBT::CartesianMoverBT(const std::string &name, const BT::NodeConfiguration &config)
        : BT::SyncActionNode(name, config),
          current_joints_(6, 0.0),
          joints_received_(false)
    {
        planners_ = createPlannerMap();
        initialize();
    }

    CartesianMoverBT::~CartesianMoverBT()
    {
        if (executor_)
        {
            executor_->cancel();
        }

        if (spin_thread_.joinable())
        {
            spin_thread_.join();
        }
    }

    void CartesianMoverBT::initialize()
    {
        // Initialize ROS2
        if (!rclcpp::ok())
        {
            rclcpp::init(0, nullptr);
        }

        static int counter = 0;

        node_ = std::make_shared<rclcpp::Node>(
            "cartesian_mover_bt_" + std::to_string(counter++));

        // Create action client
        client_ = rclcpp_action::create_client<MoveGroupAction>(node_, "/move_action");

        if (!client_->wait_for_action_server(std::chrono::seconds(10)))
        {
            RCLCPP_ERROR(node_->get_logger(), "❌ MoveGroup action server not available!");
            return;
        }
        RCLCPP_INFO(node_->get_logger(), "✅ MoveGroup connected");

        // Subscribe to joint states
        joint_sub_ = node_->create_subscription<sensor_msgs::msg::JointState>(
            "/joint_states", 10,
            std::bind(&CartesianMoverBT::jointCallback, this, std::placeholders::_1));

        // Start spin thread
        executor_ = std::make_shared<rclcpp::executors::SingleThreadedExecutor>();
        executor_->add_node(node_);
        spin_thread_ = std::thread([this]()
                                   { executor_->spin(); });

        // Load points
        loadPointsFromYAML();

        // Wait for joint states
        RCLCPP_INFO(node_->get_logger(), "⏳ Waiting for joint states...");
        auto start = std::chrono::steady_clock::now();
        while (!joints_received_ &&
               std::chrono::duration_cast<std::chrono::seconds>(
                   std::chrono::steady_clock::now() - start)
                       .count() < 5)
        {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
            std::cout << "." << std::flush;
        }

        if (joints_received_)
        {
            std::cout << std::endl;
            RCLCPP_INFO(node_->get_logger(), "✅ Robot ready!");
        }
        else
        {
            std::cout << std::endl;
            RCLCPP_ERROR(node_->get_logger(), "❌ No joint states - check robot is running!");
        }
    }

    bool CartesianMoverBT::loadPointsFromYAML()
    {
        try
        {
            YAML::Node config = YAML::LoadFile(POINTS_YAML_PATH);

            if (!config["points"])
            {
                std::cerr << "❌ No 'points' key found in YAML file" << std::endl;
                return false;
            }

            points_.clear();

            for (const auto &point_node : config["points"])
            {
                PointData point;
                point.name = point_node["name"].as<std::string>();
                point.date_time = point_node["date_time"].as<std::string>();
                point.sequence = point_node["sequence"].as<int>();
                point.nature = point_node["nature"].as<std::string>();
                point.is_tf = point_node["is_tf"].as<bool>();

                if (point_node["joints_values"])
                {
                    for (const auto &joint : point_node["joints_values"])
                    {
                        point.joints_values[joint.first.as<std::string>()] = joint.second.as<double>();
                    }
                }

                if (point_node["coordinate"])
                {
                    point.coordinate.x = point_node["coordinate"]["x"].as<double>();
                    point.coordinate.y = point_node["coordinate"]["y"].as<double>();
                    point.coordinate.z = point_node["coordinate"]["z"].as<double>();
                    point.coordinate.r = point_node["coordinate"]["r"].as<double>();
                    point.coordinate.p = point_node["coordinate"]["p"].as<double>();
                    point.coordinate.w = point_node["coordinate"]["w"].as<double>();
                }

                points_.push_back(point);
            }

            std::cout << "✅ Loaded " << points_.size() << " points from YAML" << std::endl;
            listAllPoints();
            return true;
        }
        catch (const std::exception &e)
        {
            std::cerr << "❌ Failed to load YAML file: " << e.what() << std::endl;
            return false;
        }
    }

    PointData *CartesianMoverBT::findPointByName(const std::string &name)
    {
        for (auto &point : points_)
        {
            if (point.name == name)
            {
                return &point;
            }
        }
        return nullptr;
    }

    // std::vector<double> CartesianMoverBT::getJointValuesInOrder(const PointData& point)
    std::vector<double> CartesianMoverBT::getJointValuesInOrder(const PointData &point) const
    {
        std::vector<double> joints(6, 0.0);
        for (size_t i = 0; i < JOINT_NAMES.size(); ++i)
        {
            auto it = point.joints_values.find(JOINT_NAMES[i]);
            if (it != point.joints_values.end())
            {
                joints[i] = it->second;
            }
        }
        return joints;
    }

    void CartesianMoverBT::listAllPoints() const
    {
        std::cout << "\n📋 AVAILABLE POINTS:" << std::endl;
        std::cout << "============================================================" << std::endl;
        for (const auto &point : points_)
        {
            std::vector<double> joints = getJointValuesInOrder(point);
            std::cout << "  • " << std::left << std::setw(15) << point.name
                      << " | Joints: [";
            for (size_t i = 0; i < joints.size(); ++i)
            {
                std::cout << std::fixed << std::setprecision(3) << joints[i];
                if (i < joints.size() - 1)
                    std::cout << ", ";
            }
            std::cout << "]" << std::endl;
        }
        std::cout << "============================================================" << std::endl;
    }

    bool CartesianMoverBT::checkWorkspace(double x, double y, double z)
    {
        bool valid = true;
        if (x < workspace_.x.first || x > workspace_.x.second)
        {
            RCLCPP_WARN(node_->get_logger(), "X=%.3f outside workspace [%.2f, %.2f]",
                        x, workspace_.x.first, workspace_.x.second);
            valid = false;
        }
        if (y < workspace_.y.first || y > workspace_.y.second)
        {
            RCLCPP_WARN(node_->get_logger(), "Y=%.3f outside workspace [%.2f, %.2f]",
                        y, workspace_.y.first, workspace_.y.second);
            valid = false;
        }
        if (z < workspace_.z.first || z > workspace_.z.second)
        {
            RCLCPP_WARN(node_->get_logger(), "Z=%.3f outside workspace [%.2f, %.2f]",
                        z, workspace_.z.first, workspace_.z.second);
            valid = false;
        }
        return valid;
    }

    Quaternion CartesianMoverBT::rpyToQuat(double roll, double pitch, double yaw)
    {
        double cr = cos(roll / 2), sr = sin(roll / 2);
        double cp = cos(pitch / 2), sp = sin(pitch / 2);
        double cy = cos(yaw / 2), sy = sin(yaw / 2);

        Quaternion q;
        q.w = cr * cp * cy + sr * sp * sy;
        q.x = sr * cp * cy - cr * sp * sy;
        q.y = cr * sp * cy + sr * cp * sy;
        q.z = cr * cp * sy - sr * sp * cy;
        return q;
    }

    bool CartesianMoverBT::moveToPointJoints(const std::string &point_name,
                                             const std::string &planner,
                                             double velocity_scaling,
                                             double planning_timeout)
    {
        PointData *point = findPointByName(point_name);
        if (!point)
        {
            RCLCPP_ERROR(node_->get_logger(), "❌ Point '%s' not found", point_name.c_str());
            return false;
        }

        if (point->joints_values.empty())
        {
            RCLCPP_ERROR(node_->get_logger(), "❌ Point '%s' has no joint values", point_name.c_str());
            return false;
        }

        std::vector<double> target_joints = getJointValuesInOrder(*point);
        return moveToJointState(target_joints, planner, velocity_scaling, planning_timeout);
    }

    bool CartesianMoverBT::moveToJointState(const std::vector<double> &target_joints,
                                            const std::string &planner,
                                            double velocity_scaling,
                                            double planning_timeout)
    {
        if (!joints_received_)
        {
            RCLCPP_ERROR(node_->get_logger(), "No joint state available");
            return false;
        }

        auto it = planners_.find(planner);
        if (it == planners_.end())
        {
            RCLCPP_ERROR(node_->get_logger(), "Unknown planner: %s", planner.c_str());
            return false;
        }

        auto &cfg = it->second;
        double actual_velocity = (velocity_scaling > 0.0 && velocity_scaling <= 1.0) ? velocity_scaling : cfg.velocity;
        double actual_timeout = (planning_timeout > 0.0) ? planning_timeout : cfg.timeout;

        std::cout << "\n============================================================" << std::endl;
        std::cout << "🤖 Moving to joint state:" << std::endl;
        for (size_t i = 0; i < JOINT_NAMES.size(); i++)
        {
            std::cout << "    " << JOINT_NAMES[i] << ": " << std::fixed << std::setprecision(3)
                      << target_joints[i] << " rad" << std::endl;
        }
        std::cout << "📋 Planner: " << planner << " - " << cfg.description << std::endl;
        std::cout << "⚡ Velocity scaling: " << actual_velocity << std::endl;
        std::cout << "⏱️  Planning timeout: " << actual_timeout << " seconds" << std::endl;
        std::cout << "============================================================" << std::endl;

        // Build request
        moveit_msgs::msg::MotionPlanRequest req;
        req.pipeline_id = cfg.pipeline;
        req.planner_id = cfg.planner;
        req.group_name = ARM_GROUP;
        req.allowed_planning_time = actual_timeout;
        req.num_planning_attempts = 10;
        req.max_velocity_scaling_factor = actual_velocity;
        req.max_acceleration_scaling_factor = actual_velocity * 0.9;

        // Start state
        moveit_msgs::msg::RobotState start_state;
        start_state.joint_state.name = JOINT_NAMES;
        start_state.joint_state.position = current_joints_;
        req.start_state = start_state;

        // Goal constraints
        moveit_msgs::msg::Constraints goal_constraints;
        goal_constraints.name = "joint_space_goal";
        for (size_t i = 0; i < JOINT_NAMES.size(); i++)
        {
            moveit_msgs::msg::JointConstraint joint_constraint;
            joint_constraint.joint_name = JOINT_NAMES[i];
            joint_constraint.position = target_joints[i];
            joint_constraint.tolerance_above = 0.01;
            joint_constraint.tolerance_below = 0.01;
            joint_constraint.weight = 1.0;
            goal_constraints.joint_constraints.push_back(joint_constraint);
        }
        req.goal_constraints.push_back(goal_constraints);

        // Create goal
        auto goal_msg = MoveGroupAction::Goal();
        goal_msg.request = req;
        goal_msg.planning_options.plan_only = false;
        goal_msg.planning_options.replan = true;
        goal_msg.planning_options.replan_attempts = 10;

        // Send goal
        std::promise<bool> result_promise;
        auto result_future = result_promise.get_future();

        auto send_goal_options = rclcpp_action::Client<MoveGroupAction>::SendGoalOptions();
        send_goal_options.result_callback =
            [&result_promise](const GoalHandleMoveGroup::WrappedResult &wrapped_result)
        {
            if (wrapped_result.code == rclcpp_action::ResultCode::SUCCEEDED &&
                wrapped_result.result->error_code.val == moveit_msgs::msg::MoveItErrorCodes::SUCCESS)
            {
                result_promise.set_value(true);
            }
            else
            {
                result_promise.set_value(false);
            }
        };

        auto goal_handle_future = client_->async_send_goal(goal_msg, send_goal_options);

        // Wait for goal acceptance
        auto goal_handle = goal_handle_future.get();
        if (!goal_handle)
        {
            RCLCPP_ERROR(node_->get_logger(), "❌ Goal rejected");
            return false;
        }

        RCLCPP_INFO(node_->get_logger(), "✅ Goal accepted, waiting for result...");

        // Wait for result
        auto status = result_future.wait_for(std::chrono::duration<double>(actual_timeout + 15.0));
        if (status != std::future_status::ready)
        {
            RCLCPP_ERROR(node_->get_logger(), "❌ Result timeout");
            return false;
        }

        return result_future.get();
    }

    bool CartesianMoverBT::moveToPointCartesian(const std::string &point_name,
                                                const std::string &planner,
                                                double orientation_tolerance,
                                                double position_tolerance)
    {
        PointData *point = findPointByName(point_name);
        if (!point)
        {
            RCLCPP_ERROR(node_->get_logger(), "❌ Point '%s' not found", point_name.c_str());
            return false;
        }

        double x_m = point->coordinate.x / 100.0;
        double y_m = point->coordinate.y / 100.0;
        double z_m = point->coordinate.z / 100.0;

        RCLCPP_INFO(node_->get_logger(), "Cartesian movement to (%.3f, %.3f, %.3f)", x_m, y_m, z_m);

        // For now, use joint movement as fallback
        return moveToPointJoints(point_name, planner, 0.0, 0.0);
    }

    void CartesianMoverBT::jointCallback(const sensor_msgs::msg::JointState::SharedPtr msg)
    {
        std::map<std::string, double> name_to_pos;
        for (size_t i = 0; i < msg->name.size(); ++i)
        {
            name_to_pos[msg->name[i]] = msg->position[i];
        }

        for (size_t i = 0; i < JOINT_NAMES.size(); ++i)
        {
            auto it = name_to_pos.find(JOINT_NAMES[i]);
            if (it != name_to_pos.end())
            {
                current_joints_[i] = it->second;
            }
        }
        joints_received_ = true;
    }

    BT::PortsList CartesianMoverBT::providedPorts()
    {
        return {
            BT::InputPort<std::string>("point_name", "Name of the point to move to"),
            BT::InputPort<std::string>("planner", "rrtconnect", "OMPL planner to use"),
            BT::InputPort<double>("velocity", 0.0, "Velocity scaling (0.0-1.0)"),
            BT::InputPort<double>("timeout", 0.0, "Planning timeout in seconds"),
            BT::InputPort<std::string>("mode", "joints", "Movement mode: 'joints' or 'cartesian'"),
            BT::InputPort<double>("position_tolerance", 0.1, "Position tolerance in meters"),
            BT::InputPort<double>("orientation_tolerance", 0.1, "Orientation tolerance in radians"),
            BT::OutputPort<std::string>("result", "Movement result message")};
    }

    BT::NodeStatus CartesianMoverBT::tick()
    {
        // Get input ports
        std::string point_name;
        if (!getInput<std::string>("point_name", point_name))
        {
            RCLCPP_ERROR(node_->get_logger(), "Missing point_name input");
            return BT::NodeStatus::FAILURE;
        }

        std::string planner = "rrtconnect";
        getInput<std::string>("planner", planner);

        double velocity = 0.0;
        getInput<double>("velocity", velocity);

        double timeout = 0.0;
        getInput<double>("timeout", timeout);

        std::string mode = "joints";
        getInput<std::string>("mode", mode);

        if (!joints_received_)
        {
            RCLCPP_ERROR(node_->get_logger(), "Robot not ready");
            return BT::NodeStatus::FAILURE;
        }

        bool success = false;

        if (mode == "joints")
        {
            success = moveToPointJoints(point_name, planner, velocity, timeout);
        }
        else if (mode == "cartesian")
        {
            double pos_tol = 0.1, ori_tol = 0.1;
            getInput<double>("position_tolerance", pos_tol);
            getInput<double>("orientation_tolerance", ori_tol);
            success = moveToPointCartesian(point_name, planner, ori_tol, pos_tol);
        }
        else
        {
            RCLCPP_ERROR(node_->get_logger(), "Unknown mode: %s", mode.c_str());
            return BT::NodeStatus::FAILURE;
        }

        setOutput("result", success ? "Success" : "Failure");
        return success ? BT::NodeStatus::SUCCESS : BT::NodeStatus::FAILURE;
    }

} // namespace control_logic_bt

// Register the node with the BT factory
BT_REGISTER_NODES(factory)
{
    factory.registerNodeType<control_logic_bt::CartesianMoverBT>("CartesianMover");
}