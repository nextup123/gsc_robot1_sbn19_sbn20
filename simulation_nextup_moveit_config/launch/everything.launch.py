from launch import LaunchDescription
from launch_ros.actions import Node, ComposableNodeContainer
from launch.actions import TimerAction, IncludeLaunchDescription
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch_ros.descriptions import ComposableNode
from ament_index_python.packages import get_package_share_directory
from moveit_configs_utils import MoveItConfigsBuilder

import os
import yaml


def load_yaml(package_name, file_path):
    package_path = get_package_share_directory(package_name)
    absolute_file_path = os.path.join(package_path, file_path)
    try:
        with open(absolute_file_path, "r") as file:
            return yaml.safe_load(file)
    except Exception:
        return None


def generate_launch_description():

    nextup_moveit_config_dir = os.path.join(
        get_package_share_directory("simulation_nextup_moveit_config"), "launch"
    )
    utility_pkg_dir = os.path.join(
        get_package_share_directory("utility_pkg"), "launch"
    )


    demo_node = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(nextup_moveit_config_dir, "demo.launch.py")
        )
    )

    controllers_node = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(nextup_moveit_config_dir, "controllers.launch.py")
        )
    )

    moveit_config = (
        MoveItConfigsBuilder("robot_nextup", package_name="simulation_nextup_moveit_config")
        .robot_description(file_path="config/robot_nextup.urdf.xacro")
        .robot_description_semantic(file_path="config/robot_nextup.srdf")
        .to_moveit_configs()
    )

    servo_yaml = load_yaml(
        "simulation_nextup_moveit_config",
        "config/servo_params.yaml",
    )

    servo_params = {"moveit_servo": servo_yaml}

    container = ComposableNodeContainer(
        name="moveit_servo_demo_container",
        namespace="/",
        package="rclcpp_components",
        executable="component_container_mt",
        composable_node_descriptions=[
            ComposableNode(
                package="robot_state_publisher",
                plugin="robot_state_publisher::RobotStatePublisher",
                name="robot_state_publisher",
                parameters=[moveit_config.robot_description],
            ),
            ComposableNode(
                package="tf2_ros",
                plugin="tf2_ros::StaticTransformBroadcasterNode",
                name="static_tf2_broadcaster",
                parameters=[{"child_frame_id": "/base_link", "frame_id": "/world"}],
            )
        ],
        output="screen",
    )

    servo_node = Node(
        package="moveit_servo",
        executable="servo_node_main",
        parameters=[
            servo_params,
            moveit_config.robot_description,
            moveit_config.robot_description_semantic,
            moveit_config.robot_description_kinematics,
        ],
        output="screen",
    )

    ui_command_node = Node(
        name="ui_command_node",
        package="simulation_nextup_moveit_config",
        executable="ui_command_sim",
        parameters=[{"max_joint_vel_cmd": 0.3, "max_twist_vel_cmd_": 0.1}],
        output="screen",
    )

    joint_values_cartesian_values_mapping = Node(
        package="utility_pkg",
        executable="joint_values_cartesian_values_mapping",
        output="screen",
    )

    moveit_go_to_pose = Node(
        package="utility_pkg",
        executable="moveit_go_to_pose",
        output="screen",
    )

    homing_node = Node(
        package="utility_pkg",
        executable="homing_node",
        output="screen",
    )

    auto_plan_node = Node(
        package='utility_pkg',
        executable='auto_plan',
        output='screen'
    )

    controller_state_monitor = Node(
        package="utility_pkg",
        executable="controller_state_monitor",
        output="screen",
    )

    reset_mode_manager = Node(
        package="utility_pkg",
        executable="reset_mode_manager",
        output="screen",
    )

    emergency_manager = Node(
        package="utility_pkg",
        executable="emergency_manager",
        output="screen",
    )

    execute_trajectory_node = Node(
        package='utility_pkg',
        executable='execute_trajectory',
        output='screen'
    )

<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
    return LaunchDescription([
        TimerAction(period=1.0, actions=[demo_node]),
        TimerAction(period=4.0, actions=[controllers_node]),
        TimerAction(period=13.0, actions=[container]),
        TimerAction(period=15.0, actions=[servo_node]),
        TimerAction(period=17.0, actions=[auto_plan_node]),
        TimerAction(period=18.0, actions=[joint_values_cartesian_values_mapping]),
        TimerAction(period=19.0, actions=[ui_command_node]),
        TimerAction(period=20.0, actions=[moveit_go_to_pose]),
        TimerAction(period=21.0, actions=[homing_node]),
        TimerAction(period=22.0, actions=[controller_state_monitor]),
        TimerAction(period=23.0, actions=[reset_mode_manager]),
        TimerAction(period=25.0, actions=[emergency_manager]),
<<<<<<< Updated upstream
        TimerAction(period=27.0,actions=[execute_trajectory_node])
=======
        TimerAction(period=27.0,actions=[execute_trajectory_node]),
>>>>>>> Stashed changes
    ])
