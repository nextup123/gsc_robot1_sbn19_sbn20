cmake_minimum_required(VERSION 3.22)
project(simulation_nextup_moveit_config)

find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(moveit_ros_planning REQUIRED)
find_package(moveit_ros_planning_interface REQUIRED)
find_package(moveit_core REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(control_msgs REQUIRED)
find_package(std_msgs REQUIRED)
find_package(sensor_msgs REQUIRED)

install(DIRECTORY config launch
  DESTINATION share/${PROJECT_NAME}
)

add_executable(ui_command_sim src/ui_command_node_sim.cpp)
ament_target_dependencies(ui_command_sim rclcpp control_msgs geometry_msgs std_msgs)


install(TARGETS
  ui_command_sim
  DESTINATION lib/${PROJECT_NAME}
)


ament_package()
