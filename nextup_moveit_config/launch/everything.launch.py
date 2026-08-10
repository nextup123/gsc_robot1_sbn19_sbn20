from launch import LaunchDescription
from launch_ros.actions import Node
from launch.actions import TimerAction
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.actions import IncludeLaunchDescription
from ament_index_python.packages import get_package_share_directory
import os

def generate_launch_description():
    nextup_moveit_config_dir = os.path.join(get_package_share_directory("nextup_moveit_config"), 'launch')
    utility_pkg_dir = os.path.join(get_package_share_directory("utility_pkg"), 'launch')

    startup_node_controller_monitor = Node(
        name="startup_node_controller_monitor",
        package='utility_pkg',
        executable='startup_node_controller_monitor',
        output='screen'
    )


    ethercat_manager_sdo = Node(
        name="ethercat_manager_sdo",
        package='ethercat_manager',
        executable='ethercat_sdo_srv_server',
        output='screen'
    )

    move_group_capabilities = {
        "capabilities": (
            "pilz_industrial_motion_planner/MoveGroupSequenceAction "
            "pilz_industrial_motion_planner/MoveGroupSequenceService"
        )
    }


    demo_node = IncludeLaunchDescription(
        PythonLaunchDescriptionSource([nextup_moveit_config_dir, '/demo.launch.py']),
        launch_arguments={
            "capabilities": move_group_capabilities["capabilities"]
        }.items(),
    )

    controllers_node = IncludeLaunchDescription(
        PythonLaunchDescriptionSource([nextup_moveit_config_dir, "/controllers.launch.py"]),
    )

    utility_pkg_nodes = IncludeLaunchDescription(
        PythonLaunchDescriptionSource([utility_pkg_dir, '/utility_nodes.launch.py'])
    )
    process_manager_rosbridge = Node(
                package='utility_pkg',
                executable='process_manager_rosbridge',
                output='screen'
            )
    
    return LaunchDescription([
        TimerAction(
            period=1.0,  
            actions=[demo_node]
        ),
        TimerAction(
            period=1.3,  
            actions=[startup_node_controller_monitor]
        ),
        TimerAction(
            period=10.0,  
            actions=[controllers_node]
        ),
        TimerAction(
            period=13.0,  
            actions=[ethercat_manager_sdo]
        ),
        TimerAction(
            period=15.0,  
            actions=[utility_pkg_nodes]
        ),
        TimerAction(
            period=17.0,  
            actions=[process_manager_rosbridge]
        ),
    ])