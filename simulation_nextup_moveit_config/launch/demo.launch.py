"""
Full simulation demo for robot_nextup.

Brings up the complete stack:
  - ros2_control (mock hardware) + controller manager
  - joint_state_broadcaster + robot_manipulator_controller (spawned)
  - robot_state_publisher
  - move_group (via move_group.launch.py — both pipelines + sequence caps)
  - RViz with the MoveIt motion-planning plugin

Run:  ros2 launch simulation_nextup_moveit_config demo.launch.py
"""

import os
from launch import LaunchDescription
from launch.actions import IncludeLaunchDescription, RegisterEventHandler
from launch.event_handlers import OnProcessExit
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch_ros.actions import Node
from ament_index_python.packages import get_package_share_directory
from moveit_configs_utils import MoveItConfigsBuilder


def generate_launch_description():
    pkg_share = get_package_share_directory("simulation_nextup_moveit_config")

    moveit_config = (
        MoveItConfigsBuilder("robot_nextup", package_name="simulation_nextup_moveit_config")
        .robot_description(file_path="config/robot_nextup.urdf.xacro")
        .robot_description_semantic(file_path="config/robot_nextup.srdf")
        .robot_description_kinematics(file_path="config/kinematics.yaml")
        .joint_limits(file_path="config/joint_limits.yaml")
        .trajectory_execution(file_path="config/moveit_controllers.yaml")
        .planning_pipelines(
            pipelines=["ompl", "pilz_industrial_motion_planner"],
            default_planning_pipeline="ompl",
        )
        .to_moveit_configs()
    )


    ros2_controllers_path = os.path.join(pkg_share, "config", "ros2_controllers.yaml")
    ros2_control_node = Node(
        package="controller_manager",
        executable="ros2_control_node",
        parameters=[moveit_config.robot_description, ros2_controllers_path],
        output="screen",
    )

    robot_state_publisher = Node(
        package="robot_state_publisher",
        executable="robot_state_publisher",
        output="screen",
        parameters=[moveit_config.robot_description],
    )


    jsb_spawner = Node(
        package="controller_manager",
        executable="spawner",
        arguments=["joint_state_broadcaster", "-c", "/controller_manager"],
    )
    arm_spawner = Node(
        package="controller_manager",
        executable="spawner",
        arguments=["robot_manipulator_controller", "-c", "/controller_manager"],
    )

   
    move_group_include = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(pkg_share, "launch", "move_group.launch.py")
        )
    )

    rviz_config = os.path.join(pkg_share, "config", "moveit.rviz")
    rviz_node = Node(
        package="rviz2",
        executable="rviz2",
        arguments=["-d", rviz_config],
        output="screen",
        parameters=[
            moveit_config.robot_description,
            moveit_config.robot_description_semantic,
            moveit_config.robot_description_kinematics,
            moveit_config.planning_pipelines,
            moveit_config.joint_limits,
        ],
    )

    
    delay_jsb = RegisterEventHandler(
        OnProcessExit(target_action=ros2_control_node, on_exit=[jsb_spawner])
    )
    delay_arm = RegisterEventHandler(
        OnProcessExit(target_action=jsb_spawner, on_exit=[arm_spawner])
    )

    return LaunchDescription(
        [
            ros2_control_node,
            robot_state_publisher,
            delay_jsb,
            delay_arm,
            move_group_include,
            rviz_node,
        ]
    )
