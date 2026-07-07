cmake_minimum_required(VERSION 3.8)
project(motion_plan_bt)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# find dependencies
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



include_directories(
  include
  ${behaviortree_cpp_INCLUDE_DIRS}
  ${YAML_CPP_INCLUDE_DIRS}
)


add_executable(motion_plan_bt_runner
   src/main.cpp
   src/pause_control_node.cpp
   src/start_control_node.cpp
   src/msg_logger_node.cpp
   src/popup_msg_node.cpp
   src/publish_data_bt_node.cpp
   src/bt_plan_path.cpp
   src/bt_clean_file.cpp
   src/bt_copy_fields.cpp
   src/bt_copy_file.cpp
   src/bt_point_path_verification.cpp
   src/bt_auto_run_path_xml.cpp
)


ament_target_dependencies(motion_plan_bt_runner
  rclcpp
  behaviortree_cpp_v3
  nextup_joint_interfaces
  std_msgs
  trajectory_msgs
  yaml-cpp
  geometry_msgs
  rclcpp_action
  control_msgs
  sensor_msgs
  std_srvs
  moveit_msgs
  srdfdom
  geometric_shapes
  moveit_core
  moveit_ros_planning_interface
  moveit_ros_planning
  ament_index_cpp
  tf2_eigen
)
  
target_link_libraries(motion_plan_bt_runner yaml-cpp)


add_executable(motion_planning_start_bt src_ros_node/motion_planning_start_bt.cpp)
ament_target_dependencies(motion_planning_start_bt
  rclcpp
  std_msgs
)


install(TARGETS
  motion_plan_bt_runner
  motion_planning_start_bt
  DESTINATION lib/${PROJECT_NAME}
)

ament_package()
