cmake_minimum_required(VERSION 3.8)
project(nextup_shape_tracer)

if(NOT CMAKE_CXX_STANDARD)
  set(CMAKE_CXX_STANDARD 17)
endif()
if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(std_msgs REQUIRED)
find_package(std_srvs REQUIRED)
find_package(tf2 REQUIRED)
find_package(tf2_ros REQUIRED)
find_package(Eigen3 REQUIRED)

# ---- the node ----
add_executable(shape_tracer_node src/shape_tracer_node.cpp)
target_include_directories(shape_tracer_node PUBLIC ${EIGEN3_INCLUDE_DIRS})
ament_target_dependencies(shape_tracer_node
  rclcpp geometry_msgs std_msgs std_srvs tf2 tf2_ros)
install(TARGETS shape_tracer_node DESTINATION lib/${PROJECT_NAME})

# ---- offline validations (no ROS; built so the claims can be reproduced) ----
add_executable(validate_control_law test/validate_control_law.cpp)
target_include_directories(validate_control_law PUBLIC ${EIGEN3_INCLUDE_DIRS})
install(TARGETS validate_control_law DESTINATION lib/${PROJECT_NAME})

add_executable(validate_reference_freeze test/validate_reference_freeze.cpp)
target_include_directories(validate_reference_freeze PUBLIC ${EIGEN3_INCLUDE_DIRS})
install(TARGETS validate_reference_freeze DESTINATION lib/${PROJECT_NAME})

# ---- python scorer ----
install(PROGRAMS scripts/shape_score.py DESTINATION lib/${PROJECT_NAME})

# ---- resources ----
install(DIRECTORY launch config web DESTINATION share/${PROJECT_NAME})

ament_package()
