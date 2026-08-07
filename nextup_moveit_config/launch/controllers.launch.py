from launch import LaunchDescription
from launch_ros.actions import Node
from launch.actions import RegisterEventHandler
from launch.event_handlers import OnProcessExit

def generate_launch_description():
    operation_mode_controller_spawner = Node(
        package="controller_manager",
        executable="spawner",
        arguments=['modeofoperation_command_controller', "-c", "/controller_manager"],
    )

    nextup_digital_input_broadcaster = Node(
        package="controller_manager",
        executable="spawner",
        arguments=['nextup_digital_input_broadcaster', "-c", "/controller_manager"],
    )

    nextup_reset_fault_controller = Node(
        package="controller_manager",
        executable="spawner",
        arguments=['nextup_reset_fault_controller', "-c", "/controller_manager"],
    )


    nextup_driver_status_broadcaster = Node(
        package="controller_manager",
        executable="spawner",
        arguments=['nextup_driver_status_broadcaster', "-c", "/controller_manager"],
    )

    nextup_emergency_trigger_controller = Node(
        package="controller_manager",
        executable="spawner",
        arguments=["nextup_emergency_trigger_controller", "-c", "/controller_manager"],
    )


    robot_manipulator_velocity_controller_spawner = Node(
        package="controller_manager",
        executable="spawner",
        arguments=["robot_manipulator_velocity_controller", "-c", "/controller_manager"]
    )

    nextup_digital_output_controller_spawner_1 = Node(
        package="controller_manager",
        executable="spawner",
        arguments=['nextup_digital_output_controller_1', "-c", "/controller_manager"],
    )

    nextup_digital_output_controller_spawner_2 = Node(
        package="controller_manager",
        executable="spawner",
        arguments=['nextup_digital_output_controller_2', "-c", "/controller_manager"],
    )

    nextup_digital_output_controller_spawner_3 = Node(
        package="controller_manager",
        executable="spawner",
        arguments=['nextup_digital_output_controller_3', "-c", "/controller_manager"],
    )

    nextup_digital_output_controller_spawner_4 = Node(
        package="controller_manager",
        executable="spawner",
        arguments=['nextup_digital_output_controller_4', "-c", "/controller_manager"],
    )

    nextup_digital_output_controller_spawner_5 = Node(
        package="controller_manager",
        executable="spawner",
        arguments=['nextup_digital_output_controller_5', "-c", "/controller_manager"],
    )

    nextup_digital_output_controller_spawner_6 = Node(
        package="controller_manager",
        executable="spawner",
        arguments=['nextup_digital_output_controller_6', "-c", "/controller_manager"],
    )

    nextup_safety_controller = Node(
        package="controller_manager",
        executable="spawner",
        arguments=['nextup_safety_controller', "-c", "/controller_manager"],
    )
    nextup_gpio_command_controller = Node(
        package="controller_manager",
        executable="spawner",
        arguments=['nextup_gpio_command_controller', "-c", "/controller_manager"],
    )
    nextup_gpio_status_broadcaster = Node(
        package="controller_manager",
        executable="spawner",
        arguments=['nextup_gpio_status_broadcaster', "-c", "/controller_manager"],
    )
    sequential_launch = []

    sequential_launch.append(RegisterEventHandler(
        OnProcessExit(
            target_action=operation_mode_controller_spawner,
            on_exit=[nextup_digital_input_broadcaster]
        )
    ))


    sequential_launch.append(RegisterEventHandler(
        OnProcessExit(
            target_action=nextup_digital_input_broadcaster,
            on_exit=[nextup_reset_fault_controller]
        )
    ))

    sequential_launch.append(RegisterEventHandler(
        OnProcessExit(
            target_action=nextup_reset_fault_controller,
            on_exit=[nextup_driver_status_broadcaster]
        )
    ))


    sequential_launch.append(RegisterEventHandler(
        OnProcessExit(
            target_action=nextup_driver_status_broadcaster,
            on_exit=[nextup_emergency_trigger_controller]
        )
    ))


    sequential_launch.append(RegisterEventHandler(
        OnProcessExit(
            target_action=nextup_emergency_trigger_controller,
            on_exit=[robot_manipulator_velocity_controller_spawner]
        )
    ))


    sequential_launch.append(RegisterEventHandler(
        OnProcessExit(
            target_action=robot_manipulator_velocity_controller_spawner,
            on_exit=[nextup_digital_output_controller_spawner_1]
        )
    ))

    sequential_launch.append(RegisterEventHandler(
        OnProcessExit(
            target_action=nextup_digital_output_controller_spawner_1,
            on_exit=[nextup_digital_output_controller_spawner_2]
        )
    ))

    sequential_launch.append(RegisterEventHandler(
        OnProcessExit(
            target_action=nextup_digital_output_controller_spawner_2,
            on_exit=[nextup_digital_output_controller_spawner_3]
        )
    ))

    sequential_launch.append(RegisterEventHandler(
        OnProcessExit(
            target_action=nextup_digital_output_controller_spawner_3,
            on_exit=[nextup_digital_output_controller_spawner_4]
        )
    ))

    sequential_launch.append(RegisterEventHandler(
        OnProcessExit(
            target_action=nextup_digital_output_controller_spawner_4,
            on_exit=[nextup_digital_output_controller_spawner_5]
        )
    ))

    sequential_launch.append(RegisterEventHandler(
        OnProcessExit(
            target_action=nextup_digital_output_controller_spawner_5,
            on_exit=[nextup_digital_output_controller_spawner_6]
        )
    ))

    sequential_launch.append(RegisterEventHandler(
        OnProcessExit(
            target_action=nextup_digital_output_controller_spawner_6,
            on_exit=[nextup_safety_controller]
        )
    ))

    sequential_launch.append(RegisterEventHandler(
        OnProcessExit(
            target_action=nextup_safety_controller,
            on_exit=[nextup_gpio_command_controller]
        )
    ))

    sequential_launch.append(RegisterEventHandler(
        OnProcessExit(
            target_action=nextup_gpio_command_controller,
            on_exit=[nextup_gpio_status_broadcaster]
        )
    ))
    return LaunchDescription(
        [
            operation_mode_controller_spawner,
            *sequential_launch  
        ]
    )
