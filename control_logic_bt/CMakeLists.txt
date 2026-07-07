cmake_minimum_required(VERSION 3.8)
project(control_logic_bt)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# find dependencies
find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(std_msgs REQUIRED)
find_package(behaviortree_cpp_v3 REQUIRED)
find_package(nextup_joint_interfaces REQUIRED)
find_package(yaml-cpp REQUIRED)
find_package(std_srvs REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(trajectory_msgs REQUIRED)
find_package(rclcpp_action REQUIRED)
find_package(control_msgs REQUIRED)
find_package(ament_index_cpp REQUIRED)
find_package(moveit_core REQUIRED)
find_package(moveit_ros_planning REQUIRED)
find_package(moveit_ros_planning_interface REQUIRED)
find_package(moveit_msgs REQUIRED)

# TF and Eigen dependencies
find_package(tf2_ros REQUIRED)
find_package(tf2_geometry_msgs REQUIRED)
find_package(tf2_eigen REQUIRED)
find_package(Eigen3 REQUIRED)

# Other dependencies
find_package(srdfdom REQUIRED)
find_package(geometric_shapes REQUIRED)

include_directories(
  include
  ${behaviortree_cpp_INCLUDE_DIRS}
  ${YAML_CPP_INCLUDE_DIRS}
)
add_executable(control_logic_bt_runner
  src/main.cpp

  #control nodes
  src/control/pause_control_node.cpp
  src/control/start_control_node.cpp

  #decorators
  src/decorator/general_one_shot.cpp
  src/decorator/wait_until_true.cpp
  src/decorator/delay_ticks.cpp
  src/decorator/run_once_node.cpp

  #condition nodes
  src/condition/is_at_pose_node.cpp
  src/condition/check_bool_topic.cpp




  src/motion/plan_and_execute_node.cpp
  src/motion/pilz_points_planner.cpp
  src/motion/pilz_circ_planner.cpp
  src/motion/pilz_motion_planner_bt.cpp
  src/motion/cartesian_mover_bt.cpp
  src/motion/blend_motion_bt.cpp
  src/motion/run_path_node.cpp
  src/motion/blend_executor.cpp
  src/motion/plan_and_execute_arc_hybrid.cpp

  #action nodes
  src/action/msg_logger_node.cpp
  src/action/popup_msg_node.cpp
  src/action/publish_data_bt_node.cpp
  src/action/bt_do_control.cpp
  src/action/bt_di_control.cpp

  #blackboards
  src/blackboard/print_message_node.cpp
  src/blackboard/arithmetic_node.cpp
  src/blackboard/compare_node.cpp
  src/blackboard/make_pilz_motion_node.cpp
  src/blackboard/add_pilz_point_node.cpp
  src/blackboard/set_var_node.cpp
  src/blackboard/modulo_node.cpp
  src/blackboard/math_expression_node.cpp
  src/blackboard/timer_start_node.cpp
  src/blackboard/timer_stop_node.cpp
  src/blackboard/timer_reset_node.cpp
  src/blackboard/wait_for_blackboard_change_node.cpp
  src/blackboard/subscribe_to_blackboard_node.cpp
  src/blackboard/publish_blackboard_node.cpp

)


ament_target_dependencies(control_logic_bt_runner
  rclcpp
  std_msgs
  std_srvs
  behaviortree_cpp_v3
  ament_index_cpp
  moveit_ros_planning_interface
  moveit_msgs
  yaml-cpp
  srdfdom
  nextup_joint_interfaces
  sensor_msgs
  tf2_ros
  tf2_geometry_msgs
  tf2_eigen
)
target_link_libraries(control_logic_bt_runner yaml-cpp)


add_executable(control_logic_start_bt src_ros_node/control_logic_start_bt.cpp)
ament_target_dependencies(control_logic_start_bt
  rclcpp
  std_msgs
)


install(TARGETS
  control_logic_bt_runner
  control_logic_start_bt
  DESTINATION lib/${PROJECT_NAME}
)

install(DIRECTORY include/control_logic_bt/
  DESTINATION include/${PROJECT_NAME}
)


install(DIRECTORY trees/
  DESTINATION share/${PROJECT_NAME}/trees
)



ament_package()
