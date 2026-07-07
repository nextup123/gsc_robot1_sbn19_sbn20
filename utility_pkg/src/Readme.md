## auto_plan

### Purpose
`auto_plan_node` generates or updates a BehaviorTree XML motion-planning sequence using
point data stored in a YAML file. It is responsible only for preparing planning logic
and does not execute motion or control.

### Behavior
- Subscribes to `/auto_plan_sequence` (`std_msgs/String`)
- Updates an existing BehaviorTree XML file with motion-planning steps

### Sequence Modes
- **Default mode**
  - Automatically generates sequential motion plans between consecutive points
    defined in the YAML file

- **Custom mode**
  - Message defines a custom planning order using sequence numbers
  - Multiple parts separated by `&`, sequences separated by commas  
    **Example:** `1,2,3&4,5`

### Feedback
- Publishes status and error messages to `/bt_toast_popup` (`std_msgs/String`)
- Message format:  
  `message,status,timeout`

### Scope
- Generates BehaviorTree XML only
- Does **not** perform planning, motion execution, or control

---

## controller_state_monitor

### Purpose
`controller_state_monitor` provides live diagnostics of all `ros2_control` controllers
managed by the controller manager. It tracks controller states and writes a detailed
snapshot to a YAML file for external inspection.

### Behavior
- Periodically calls `/controller_manager/list_controllers`
- Update interval: **2 seconds**
- Detects controller state transitions (`active ↔ inactive`)
- Tracks uptime and last state-change timestamp per controller

### Output
- Writes diagnostic data to:  
  `/home/nextup/user_config_files/controller_diagnosis/controller_dashboard.yaml`

### On-Demand Refresh
- Provides service `/controller_live_feed` (`std_srvs/Trigger`)
- Forces an immediate snapshot update
- Bypasses change detection and recalculates uptime and timestamps

### YAML Contents
- Overall system status
  - Active / inactive controller counts
  - Last update time
- Lists of active and inactive controllers
- Per-controller details:
  - Current state
  - Last state change (human-readable)
  - Claimed interfaces (e.g. position, velocity)
  - Claimed hardware / joints
  - Controller uptime since last transition
- Most recently activated or deactivated controller is explicitly marked

---

## over_velocity_manager

### Purpose
`over_velocity_manager` is a safety-critical node that continuously monitors joint
velocities and triggers an emergency when any enabled joint exceeds its configured
velocity limit.

### Subscriptions
- `/joint_states` (`sensor_msgs/JointState`)
- `/max_velocities_mode` (`std_msgs/String`)
  - Supported modes: `manual`, `production`

### Emergency Trigger
- Publishes to  
  `/nextup_emergency_trigger_controller/commands`
  (`nextup_joint_interfaces/msg/NextupEmergencyTrigger`)
- On velocity violation:
  - Publishes `emergencytrigger = false` **exactly once per event**
  - Logs the joint that caused the violation

### Configuration
- Velocity limits and joint enable flags loaded from:  
  `/home/nextup/user_config_files/joints_velocities_tuner/joint_velocities_tuner.yaml`

### Safety Defaults
- If YAML is missing, incomplete, or corrupted:
  - Safe defaults are applied automatically
  - Missing joints are enabled by default
  - Missing limits:
    - `manual` mode → **0.8**
    - `production` mode → **0.5**
- The node **never operates without defined velocity limits**

### Scope
- Monitors velocity and triggers emergency only
- Does **not** perform motion control, planning, or recovery
