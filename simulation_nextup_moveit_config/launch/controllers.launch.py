from launch import LaunchDescription
from launch_ros.actions import Node
from launch.actions import RegisterEventHandler
from launch.event_handlers import OnProcessExit

def generate_launch_description():

    joint_state_broadcaster_spawner = Node(
        package="controller_manager",
        executable="spawner",
        arguments=["joint_state_broadcaster", "-c", "/controller_manager"],
    )


    robot_manipulator_controller_spawner = Node(
        package="controller_manager",
        executable="spawner",
        arguments=["robot_manipulator_controller", "-c", "/controller_manager"],
    )


    operation_mode_controller_spawner = Node(
        package="controller_manager",
        executable="spawner",
        arguments=['modeofoperation_command_controller', "-c", "/controller_manager"],
    )

    controlword_command_controller_spawner = Node(
        package="controller_manager",
        executable="spawner",
        arguments=['controlword_command_controller', "-c", "/controller_manager"],
    )

    maxvelocity_command_controller_spawner = Node(
        package="controller_manager",
        executable="spawner",
        arguments=["maxvelocity_command_controller", "-c", "/controller_manager"],
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

    sequential_launch = []

 
    sequential_launch.append(RegisterEventHandler(
        OnProcessExit(
            target_action=joint_state_broadcaster_spawner,
            on_exit=[robot_manipulator_controller_spawner]
        )
    ))

    sequential_launch.append(RegisterEventHandler(
        OnProcessExit(
            target_action=robot_manipulator_controller_spawner,
            on_exit=[operation_mode_controller_spawner]
        )
    ))
   

    sequential_launch.append(RegisterEventHandler(
        OnProcessExit(
            target_action=operation_mode_controller_spawner,
            on_exit=[controlword_command_controller_spawner]
        )
    ))

    sequential_launch.append(RegisterEventHandler(
        OnProcessExit(
            target_action=controlword_command_controller_spawner,
            on_exit=[maxvelocity_command_controller_spawner]
        )
    ))

    sequential_launch.append(RegisterEventHandler(
        OnProcessExit(
            target_action=maxvelocity_command_controller_spawner,
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

    return LaunchDescription(
        [
            joint_state_broadcaster_spawner,
            *sequential_launch
        ]
    )