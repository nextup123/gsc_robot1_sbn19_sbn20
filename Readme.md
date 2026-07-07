## motion_plan_bt

### Overview
`motion_plan_bt` contains the Behavior Tree–based motion planning logic.  
These nodes are **not included in any launch files** and are expected to run
**independently**.

### Nodes

- **motion_plan_bt_runner**
  - Responsible for executing the complete motion planning Behavior Tree logic
  - Controls the overall planning flow
  - Runs independently (not launched via launch files)

- **motion_planning_start_bt**
  - Acts as a manager node for `motion_plan_bt_runner`
  - Handles initialization and lifecycle control

- **auto_plan.cpp**
  - This node is **not located in this package**
  - Present in: `utility_pkg/src/auto_plan.cpp`
  - Functionality:
    - Reads point names from the points file
    - Generates a complete sequential BehaviorTree XML in one shot
    - Uses Cartesian planning for all generated motion plans

---

## control_logic_bt

### Overview
`control_logic_bt` contains the main execution and control Behavior Tree logic.
These nodes are also **not included in launch files** and run independently.

### Nodes

- **control_logic_bt_runner**
  - Executes the main control logic Behavior Tree
  - Responsible for high-level robot execution logic
  - Runs independently

- **control_logic_start_bt**
  - Manager node for `control_logic_bt_runner`
  - Handles startup and control of the BT runner

- **execute_trajectory.cpp**
  - This node is **not located in this package**
  - Present in: `utility_pkg/src/execute_trajectory.cpp`
  - Functionality:
    - Sends trajectory paths directly to the robot controllers
    - Receives `path_name` and velocity from the BT component `<RunPath>`
    - Uses an action server mechanism to execute robot motion

---

## utility_pkg

### file_management_nodes

- **create_new_file_management**
  - C++ node responsible for creating a completely new points file
  - Triggered when new data is received from the UI or web interface

- **edit_point_file_management**
  - C++ node responsible for updating an existing points file
  - Creates a new file name when point data or point names are edited
  - Triggered by UI updates

- **load_save_delete_file_management**
  - C++ node responsible for:
    - Loading an existing file (UI request)
    - Saving the current file under a new name
    - Deleting an existing file
  - All actions are driven by UI commands

---

### compulsory_nodes

- **execute_trajectory**
  - Same node referenced in `control_logic_bt`
  - Responsible for executing robot motion on actual hardware
  - Sends commands to `/robot_manipulator_controller`
  - Receives input from:
    - UI
    - BT component `<RunPath>`
  - Based on action server architecture

- **homing_node**
  - MoveIt-based homing node
  - Homing sequence:
    - First homes joint2 to joint6
    - Then homes joint1

- **joint_values_cartesian_values_mapping**
  - Reads `nextup_joint_states`
  - Republishes to `joint_states`
  - Converts joint positions into:
    - `joint_values`
    - `cartesian_values`

- **moveit_go_to_pose**
  - Reads target points from the points file
  - Moves the robot to the selected point
  - Supports both:
    - Cartesian motion
    - Joint-space motion
  - Can start from any robot configuration

- **reset_mode_manager**
  - Handles fault reset and controller mode switching
  - Switches between position and velocity modes
  - Core mechanism is based on publishing `.nan` values

- **ui_command_node**
  - Receives commands from the UI
  - Moves the robot in velocity mode
  - Supports:
    - Joint control
    - Cartesian control (x, y, z, r, p, w)

---

### servo_node_management

#### config
- **robot_simulated_config**
  - Contains parameter configuration files for the MoveIt Servo node

---

### safety_nodes_management

- **emergency_manager**

    - Responsible for triggering the `nextup_emergency_controller`
    - Dynamically subscribes to multiple topics defined in a YAML file
    - Triggers emergency based on:
    - Topic data
    - Message type
    - YAML configuration rules

---

### src

- **auto_plan**
  - Same node referenced in `motion_plan_bt`
  - Activated via UI commands
  - Reads all point names from the points file
  - Generates a complete Cartesian planning XML automatically


- **controller_state_monitor**
  - Monitors active controllers and their states
  - Publishes controller status (active / inactive)
  - Used for diagnostics and controller validation
  - Does NOT perform planning or trajectory generation


- **over_velocity_manager**
  - Monitors joint velocities in real time
  - Compares live velocities against configured limits
  - Triggers safety action on velocity violation
  - Used for runtime velocity protection

