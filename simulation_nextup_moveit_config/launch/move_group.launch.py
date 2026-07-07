"""
Explicit move_group launch for robot_nextup.

Why this exists instead of generate_demo_launch():
  generate_demo_launch() silently ignores Pilz sequence capabilities, so
  MoveGroupSequenceAction / MoveGroupSequenceService never get registered and
  blended sequence requests fail with no useful error. This file injects them
  explicitly, with the capabilities string placed LAST in the parameter dict so
  it wins the ROS2 last-write-merge.

Both pipelines (ompl, pilz_industrial_motion_planner) are loaded so you can
switch at runtime via setPlanningPipelineId().
"""

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node
from moveit_configs_utils import MoveItConfigsBuilder


def generate_launch_description():
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
        .planning_scene_monitor(
            publish_robot_description=True,
            publish_robot_description_semantic=True,
        )
        .to_moveit_configs()
    )

    # The capabilities list MUST be last so it overrides anything the builder set.
    move_group_capabilities = {
        "capabilities": (
            "pilz_industrial_motion_planner/MoveGroupSequenceAction "
            "pilz_industrial_motion_planner/MoveGroupSequenceService"
        )
    }

    use_sim_time = LaunchConfiguration("use_sim_time")

    move_group_node = Node(
        package="moveit_ros_move_group",
        executable="move_group",
        output="screen",
        parameters=[
            moveit_config.to_dict(),
            {"use_sim_time": use_sim_time},
            move_group_capabilities,  # LAST = wins the merge
        ],
    )

    return LaunchDescription(
        [
            DeclareLaunchArgument("use_sim_time", default_value="false"),
            move_group_node,
        ]
    )
