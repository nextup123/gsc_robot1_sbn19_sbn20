import os
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, OpaqueFunction
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node

OVERRIDES = {
    "shape": str, "size": float, "speed": float, "laps": int, "rate": float,
    "kp": float, "kd": float, "feedforward": bool, "vmax": float,
    "freeze_error": float, "freeze_timeout": float, "watch_servo_status": bool,
    "autorun": bool, "auto_start": bool,
}


def launch_setup(context, *args, **kwargs):
    pkg = get_package_share_directory("nextup_shape_tracer")
    cfg = LaunchConfiguration("config").perform(context) or \
        os.path.join(pkg, "config", "shape_tracer.yaml")

    over = {}
    for key, typ in OVERRIDES.items():
        val = LaunchConfiguration(key).perform(context)
        if val == "":
            continue
        if typ is bool:
            over[key] = val.lower() in ("true", "1", "yes")
        else:
            over[key] = typ(val)

    return [Node(
        package="nextup_shape_tracer",
        executable="shape_tracer_node",
        name="shape_tracer_node",
        output="screen",
        parameters=[cfg, over],
    )]


def generate_launch_description():
    args = [DeclareLaunchArgument("config", default_value="",
                                 description="parameter YAML (default: package config)")]
    args += [DeclareLaunchArgument(k, default_value="",
                                   description=f"override {k}") for k in OVERRIDES]
    return LaunchDescription(args + [OpaqueFunction(function=launch_setup)])
