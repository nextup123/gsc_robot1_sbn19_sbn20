import os
import yaml
from launch import LaunchDescription
from launch_ros.actions import Node
from ament_index_python.packages import get_package_share_directory
from launch_ros.actions import ComposableNodeContainer
from launch_ros.descriptions import ComposableNode
from launch.actions import TimerAction
from moveit_configs_utils import MoveItConfigsBuilder
from launch.actions import IncludeLaunchDescription



def load_file(package_name, file_path):
    package_path = get_package_share_directory(package_name)
    absolute_file_path = os.path.join(package_path, file_path)

    try:
        with open(absolute_file_path, "r") as file:
            return file.read()
    except EnvironmentError:  
        return None


def load_yaml(package_name, file_path):
    package_path = get_package_share_directory(package_name)
    absolute_file_path = os.path.join(package_path, file_path)

    try:
        with open(absolute_file_path, "r") as file:
            return yaml.safe_load(file)
    except EnvironmentError:  
        return None


def generate_launch_description():
    moveit_config = (MoveItConfigsBuilder("nextup")
        .robot_description(file_path="config/robot_nextup.urdf.xacro").to_moveit_configs())



    servo_yaml = load_yaml("utility_pkg", "config/robot_simulated_config.yaml")

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
            ),
        ],
        output="screen",
    )


    servo_node = Node(
        name="servo_node",
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
            package="utility_pkg",
            executable="ui_command",
            parameters=[{'max_joint_vel_cmd': 0.3, 'max_twist_vel_cmd_': 0.1}],
            output="screen"
    )

    joint_values_cartesian_values_mapping = Node(
        name="joint_values_cartesian_values_mapping",
        package="utility_pkg",
        executable='joint_values_cartesian_values_mapping',
        output='screen'
    )


    execute_trajectory_node = Node(
        name="execute_trajectory_node",
        package='utility_pkg',
        executable='execute_trajectory',
        output='screen'
    )

    moveit_go_to_pose = Node(
        name="moveit_go_to_pose",
        package='utility_pkg',
        executable='moveit_go_to_pose',
        output='screen'
    )

    homing_node = Node(
        name="homing_node",
        package='utility_pkg',
        executable='homing_node',
        output='screen'
    )

    controller_state_monitor = Node(
        name="controller_state_monitor",
        package='utility_pkg',
        executable='controller_state_monitor',
        output='screen'
    )

    auto_plan = Node(
        name="auto_plan",
        package='utility_pkg',
        executable='auto_plan',
        output='screen'
    )


    reset_mode_manager = Node(
        name="reset_mode_manager",
        package='utility_pkg',
        executable='reset_mode_manager',
        output='screen'
    )


    emergency_manager = Node(
        name="emergency_manager",
        package='utility_pkg',
        executable='emergency_manager',
        output='screen'
    )


    error_logger = Node(
        name="error_logger",
        package='utility_pkg',
        executable='joint_error_logger',
        output='screen'
    )

    safety_informer = Node(
        name="safety_informer",
        package='utility_pkg',
        executable='safety_informer',
        output='screen'
    )


    emergency_nan = Node(
        name="emergency_nan",
        package='utility_pkg',
        executable='emergency_nan',
        output='screen'
    )

    tf_loader_node = Node(
        name="tf_loader_node",
        package='utility_pkg',
        executable='tf_loader_node',
        output='screen'
    )

    led_indicators = Node(
        name="led_indicators",
        package='utility_pkg',
        executable='led_indicators',
        output='screen'
    )


    four_point_calibration_node = Node(
        name="four_point_calibration_node",
        package='utility_pkg',
        executable='four_point_calibration_node',
        output='screen'
    )


    return LaunchDescription([
        TimerAction(
            period=1.0,  
            actions=[container]
        ),
        TimerAction(
            period=2.0,  
            actions=[servo_node]
        ),
        TimerAction(
            period=3.0,  
            actions=[joint_values_cartesian_values_mapping]
        ),
        TimerAction(
            period=4.0,  
            actions=[ui_command_node]
        ),
        TimerAction(
            period=5.0,  
            actions=[moveit_go_to_pose]
        ),
        TimerAction(
            period=6.0, 
            actions=[homing_node]
        ),
        TimerAction(
            period=7.0, 
            actions=[controller_state_monitor]
        ),
        TimerAction(
            period=8.0, 
            actions=[reset_mode_manager]
        ),
        TimerAction(
            period=9.0, 
            actions=[emergency_manager]
        ),
        TimerAction(
            period=10.0,
            actions=[execute_trajectory_node]
        ),
        TimerAction(
            period=11.0,
            actions=[auto_plan]
        ),
        TimerAction(
            period=13.0,
            actions=[error_logger]
        ),
        TimerAction(
            period=14.0,
            actions=[safety_informer]
        ),
        TimerAction(
            period=15.0,
            actions=[emergency_nan]
        )
        ,
        TimerAction(
            period=16.0,
            actions=[tf_loader_node]
        ),
        TimerAction(
            period=17.0,
            actions=[led_indicators]
        ),
        TimerAction(
            period=19.0,
            actions=[four_point_calibration_node]
        )
    ])