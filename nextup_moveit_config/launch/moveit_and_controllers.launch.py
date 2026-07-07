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



    demo_node = IncludeLaunchDescription(
        PythonLaunchDescriptionSource([nextup_moveit_config_dir, '/demo.launch.py'])
    )

    controllers_node = IncludeLaunchDescription(
        PythonLaunchDescriptionSource([nextup_moveit_config_dir, "/controllers.launch.py"]),
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
        )
    ])