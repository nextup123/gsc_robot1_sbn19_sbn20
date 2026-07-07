## execute_trajectory_node

### Purpose
- Node for executing precomputed joint trajectories from a YAML file
- Uses FollowJointTrajectory action to command the robot controller

### Trajectory Source
- Reads trajectory data from:
  /home/nextup/NextupRobot/src/active_project_configs/planning_data/paths.yaml
  
- Path configurable via parameter

### Subscriptions
- /path_with_velocity_scale (std_msgs/String)
  - Format: <path_name>,<speed_scale>
  - Example: p1_p2,1.0
- /reload_yaml_execute_trajectory (std_msgs/Bool)
  - Reloads YAML on demand
- /joint_states (sensor_msgs/JointState)
  - Live joint feedback

### Publications
- /running_path_status (std_msgs/String)
  - Format: status,path_name
- /read_paths_from_yaml_file (std_msgs/String)
  - Publishes available path names
- /bt_toast_popup (std_msgs/String)
  - UI feedback

### Behavior
- Supports automatic YAML hot-reload using file watcher (1 Hz polling)
- Loads and stores multiple named paths with:
  - Joint positions
  - Velocities
  - Accelerations
- Verifies start position before execution (safety check)
- Applies runtime velocity scaling (clamped)
- Executes one trajectory at a time (concurrent commands rejected)
- Verifies end position after execution using joint state feedback

### Execution Result
- Reports: running, completed, failed, or aborted

---

## homing_node

### Purpose
- Performs a safe homing sequence using MoveIt only
- No direct controller commands

### Subscriptions
- /joint_states (sensor_msgs/JointState)
- /ui_commands (std_msgs/String)
  - Expected command: home

### Publications
- /bt_toast_popup (std_msgs/String)
- /logs_topic (std_msgs/String)

### Initialization
- Initializes MoveIt group robot_manipulator on startup
- Uses lazy initialization via timer

### Execution Guard
- Ensures only one homing execution at a time

### Homing Logic
- If all joints already at zero → success immediately
- Step A:
  - Move joints 2–6 to zero
  - Joint1 held fixed
- Step B:
  - Move joint1 to zero

### Each Step Includes
- Motion planning
- Execution
- Waiting for fresh joint state updates
- Tolerance-based verification (0.001)

### Result Feedback
- Success: homing done,success,10
- Failure: homing failed,failure,0
- Rejects new homing requests while running

---

## joint_values_cartesian_values_mapping

### Purpose
- Bridges joint-space data to UI-friendly joint and Cartesian values

### Subscriptions
- nextup_joint_states (nextup_joint_interfaces/msg/NextupJointState)

### Publications
- joint_states (sensor_msgs/JointState)
  - Reordered and filtered
- /joint_values (std_msgs/Float64MultiArray)
  - Joint angles in degrees
- /cartesian_values (std_msgs/Float64MultiArray)
  - TCP pose

### Joint Handling
- Filters and republishes:
  - joint1 → joint6
- Fixed joint ordering
- Converts radians → degrees

### Cartesian Computation
- Uses TF2
- Frame: base_link → end
- Converts:
  - Translation: meters → centimeters
  - Orientation: quaternion → RPY (degrees)

### Cartesian Output Format
- [x, y, z, roll, pitch, yaw]

### Runtime
- UI update loop at 5 Hz (200 ms)
- Rounds values for stable UI display
- Continues safely if TF or joint data unavailable

---

## moveit_go_to_pose

### Purpose
- Moves robot to a stored point using MoveIt
- Supports joint and Cartesian motion

### Target Source
- Reads target joint values from:
  /home/nextup/NextupRobot/src/active_project_configs/planning_data/points.yaml

### Subscriptions
- /ui_commands (std_msgs/String)
  - Format: get_last_pose@<point_name>
- /joint_states (sensor_msgs/JointState)
- /joint_motion (std_msgs/Bool)
- /cartesian_motion (std_msgs/Bool)

### Publications
- /last_position (std_msgs/Float64MultiArray)
- /bt_toast_popup (std_msgs/String)

### Mode Selection Logic
- Requires joint or cartesian mode before execution
- If both modes set, latest mode wins
- Modes auto-reset after use

### Joint Motion
- Plans and executes joint-space motion via MoveIt

### Cartesian Motion
- Computes FK from target joints
- Plans Cartesian path from current pose
- Requires 100% path fraction
- Executes at 10% speed

### Safety
- Verifies execution using joint state feedback
- Uses tolerance-based validation
- Prevents concurrent execution using busy flag

### Feedback
- Publishes clear success or failure per request

---

## reset_mode_manager

### Purpose
- Handles fault reset and mode switching in ros2_control systems
- Uses NaN-based controller reset logic

### Subscriptions
- /reset_fault (std_msgs/Bool)
- /change_mode (std_msgs/String)
  - "8" = position
  - "9" = jog
- /trajectory_controller/controller_state (control_msgs/JointTrajectoryControllerState)

### Publications
- /trajectory_controller/joint_trajectory (JointTrajectory)
- /nextup_reset_fault_controller/commands (NextupResetFault)
- /nextup_emergency_trigger_controller/commands (NextupEmergencyTrigger)
- /modeofoperation_command_controller/commands (Float64MultiArray)
- /bt_toast_popup (std_msgs/String)

### Initialization
- Automatically locks joint names from controller state

### Reset Logic
- Publishes NaN trajectory until error positions become NaN
- Clears emergency trigger
- Pulses reset fault (true → false)
- Switches controller to Jog mode (9)

### Mode Change Logic
- Publishes NaN trajectory until controller accepts NaN
- Sends requested mode command (8 or 9)
- Uses timeouts and verification for safety

### Runtime
- All operations run in detached threads
- Uses MultiThreadedExecutor

---

## ui_command_node (UiServo)

### Purpose
- Converts UI string commands into joint velocity or Cartesian twist commands
- Designed for manual jogging / servo control

### Subscriptions
- ui_commands (std_msgs/String)

### Command Format
- Joint:
  - +j1, -j3, 0j2
- Cartesian:
  - +cx, -cr, 0cy

### Publications
- /robot_manipulator_velocity_controller/commands (Float64MultiArray)
- /servo_node/delta_twist_cmds (geometry_msgs/TwistStamped)

### Parameters
- frame_to_publish (default: end)
- max_joint_vel_cmd (default: 0.2)
- max_twist_vel_cmd_ (default: 0.2)

### Features
- Smooth acceleration and deceleration
- Velocity ramps up on repeated commands
- Safe ramp-down on stop command (0)

### Joint Control
- Controls joints 1–6
- Publishes velocity vector of size 6

### Cartesian Control
- Linear: x y z
- Angular: r p w
- Uses TwistStamped in selected frame
- Prevents sudden jumps using incremental acceleration

### Runtime
- Fully non-blocking
- Intended for:
  - Jog mode
  - Manual robot control
