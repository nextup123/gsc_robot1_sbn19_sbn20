cmake_minimum_required(VERSION 3.8)
project(utility_pkg)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(behaviortree_cpp_v3 REQUIRED)
find_package(nextup_joint_interfaces REQUIRED)
find_package(std_msgs REQUIRED)
find_package(trajectory_msgs REQUIRED)
find_package(yaml-cpp REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(rclcpp_action REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(control_msgs REQUIRED)
find_package(ament_index_cpp REQUIRED)
find_package(moveit REQUIRED)
find_package(moveit_core REQUIRED)
find_package(moveit_ros_planning REQUIRED)
find_package(moveit_ros_planning_interface REQUIRED)
find_package(tf2_eigen REQUIRED)
find_package(moveit_msgs REQUIRED)
find_package(srdfdom REQUIRED)
find_package(geometric_shapes REQUIRED)
find_package(Eigen3 REQUIRED)
find_package(pluginlib REQUIRED)
find_package(controller_manager_msgs REQUIRED)
find_package(diagnostic_msgs REQUIRED)
find_package(lifecycle_msgs REQUIRED)
find_package(std_srvs REQUIRED)
find_package(controller_manager_msgs REQUIRED)

add_executable(auto_plan src/auto_plan.cpp)
ament_target_dependencies(auto_plan rclcpp std_msgs moveit_core)
target_link_libraries(auto_plan yaml-cpp)

add_executable(execute_trajectory compulsory_nodes/execute_trajectory.cpp)
ament_target_dependencies(execute_trajectory rclcpp rclcpp_action std_msgs sensor_msgs trajectory_msgs control_msgs nextup_joint_interfaces)
target_link_libraries(execute_trajectory yaml-cpp)

add_executable(homing_node compulsory_nodes/homing_node.cpp)
ament_target_dependencies(homing_node rclcpp std_msgs trajectory_msgs sensor_msgs std_srvs nextup_joint_interfaces moveit_core moveit_ros_planning moveit_ros_planning_interface)
target_link_libraries(homing_node Eigen3::Eigen yaml-cpp)

add_executable(moveit_go_to_pose compulsory_nodes/moveit_go_to_pose.cpp)
ament_target_dependencies(moveit_go_to_pose rclcpp geometry_msgs std_msgs moveit_core moveit_ros_planning moveit_ros_planning_interface)
target_link_libraries(moveit_go_to_pose Eigen3::Eigen yaml-cpp)

add_executable(tf_loader_node compulsory_nodes/tf_loader_node.cpp)
ament_target_dependencies(tf_loader_node rclcpp geometry_msgs std_msgs moveit_core moveit_ros_planning moveit_ros_planning_interface)
target_link_libraries(tf_loader_node Eigen3::Eigen yaml-cpp)



add_executable(ui_command compulsory_nodes/ui_command_node.cpp)
ament_target_dependencies(ui_command
  rclcpp
  std_msgs
  geometry_msgs
  tf2
  tf2_ros
  tf2_geometry_msgs
  control_msgs
)

add_executable(joint_values_cartesian_values_mapping compulsory_nodes/joint_values_cartesian_values_mapping.cpp)
ament_target_dependencies(joint_values_cartesian_values_mapping rclcpp geometry_msgs std_msgs tf2_ros sensor_msgs nextup_joint_interfaces)
target_link_libraries(joint_values_cartesian_values_mapping Eigen3::Eigen yaml-cpp)

add_executable(controller_state_monitor src/controller_state_monitor.cpp)
ament_target_dependencies(controller_state_monitor rclcpp controller_manager_msgs lifecycle_msgs diagnostic_msgs std_srvs)
target_link_libraries(controller_state_monitor yaml-cpp)


add_executable(reset_mode_manager compulsory_nodes/reset_mode_manager.cpp)
ament_target_dependencies(reset_mode_manager rclcpp std_msgs trajectory_msgs control_msgs nextup_joint_interfaces std_srvs)

add_executable(emergency_nan src/emergency_nan.cpp)
ament_target_dependencies(emergency_nan rclcpp std_msgs trajectory_msgs control_msgs nextup_joint_interfaces)

add_executable(emergency_manager safety_nodes_management/emergency_manager.cpp)
ament_target_dependencies(emergency_manager rclcpp std_msgs trajectory_msgs control_msgs nextup_joint_interfaces)
target_link_libraries(emergency_manager yaml-cpp)

add_executable(safety_informer safety_nodes_management/safety_informer.cpp)
ament_target_dependencies(safety_informer rclcpp std_msgs trajectory_msgs control_msgs nextup_joint_interfaces)
target_link_libraries(safety_informer yaml-cpp)

add_executable(joint_error_logger src/joint_error_logger.cpp)
ament_target_dependencies(joint_error_logger rclcpp nextup_joint_interfaces)
target_link_libraries(joint_error_logger yaml-cpp)

add_executable(led_indicators src/led_indicators.cpp)
ament_target_dependencies(led_indicators rclcpp nextup_joint_interfaces)

add_executable(startup_node_controller_monitor src/startup_node_controller_monitor.cpp)
ament_target_dependencies(startup_node_controller_monitor rclcpp controller_manager_msgs std_msgs std_srvs)
target_link_libraries(startup_node_controller_monitor yaml-cpp)


add_executable(four_point_calibration_node src/four_point_calibration_node.cpp)
ament_target_dependencies(four_point_calibration_node
  rclcpp std_msgs sensor_msgs tf2_ros tf2 tf2_geometry_msgs
  moveit_ros_planning_interface)
target_link_libraries(four_point_calibration_node yaml-cpp)

add_executable(process_manager_rosbridge src/process_manager_rosbridge.cpp)
ament_target_dependencies(process_manager_rosbridge rclcpp std_msgs)

install(TARGETS four_point_calibration_node DESTINATION lib/${PROJECT_NAME})



install(TARGETS
  auto_plan
  execute_trajectory
  homing_node
  ui_command
  moveit_go_to_pose
  joint_values_cartesian_values_mapping
  controller_state_monitor
  reset_mode_manager
  emergency_manager
  safety_informer
  joint_error_logger
  emergency_nan
  startup_node_controller_monitor
  led_indicators
  tf_loader_node
  four_point_calibration_node
  process_manager_rosbridge
  DESTINATION lib/${PROJECT_NAME}
)

install(DIRECTORY launch DESTINATION share/${PROJECT_NAME})

install(DIRECTORY
  servo_node_management/config
  launch
  DESTINATION share/${PROJECT_NAME}
)

ament_package()
