## emergency_manager_node

### Purpose
`emergency_manager_node` is a centralized, YAML-driven emergency trigger manager.
It dynamically subscribes to multiple fault topics and triggers a robot emergency
stop when configured fault conditions are met.

This node is fully data-driven and does not require restart when configuration changes.

---

### Configuration
- Default YAML file:
    /home/nextup/NextupRobot/src/active_project_configs/emergency_manager.yaml

- Required root key:
    Emergency Manager

### Per-Fault Configuration Fields

Each fault entry under `Emergency Manager` must define:

- `topic_name`  
ROS topic to monitor

- `msg_type`  
Supported values: `bool`, `string`, `int32`

- `data`  
Expected value that triggers the emergency

- `connection`  
- `always` → trigger every time the condition matches  
- `only-once` → trigger once until the value changes  
- `no` → fault monitoring disabled

---

### Subscriptions

- Subscriptions are created **dynamically** based on the YAML file
- No hard-coded topics exist in the source code

#### Supported Message Types
- `std_msgs/Bool`
- `std_msgs/String`
- `std_msgs/Int32`

---

### Publications

- `/nextup_emergency_trigger_controller/commands`  
- Message type: `nextup_joint_interfaces/NextupEmergencyTrigger`
- Used to trigger robot emergency stop

- `/bt_toast_popup`  
- Human-readable fault notification for UI display

---

### Runtime Behavior

- Monitors the YAML file using filesystem timestamps
- Hot-reloads configuration at runtime (no restart required)
- Safely:
- Removes obsolete subscribers
- Adds new fault subscribers
- Recreates subscribers if message type or connection mode changes
- Ignores unmatched values automatically
- Resets `only-once` faults when the condition clears

---

### Emergency Logic

When a configured fault condition matches:
- Publishes `emergencytrigger = true`
- Sends a UI toast containing the fault name and topic
- Logs the exact YAML key and topic that caused the emergency
- Prevents duplicate triggers when configured (`only-once` mode)

---

### Design Notes

- Fully YAML-driven configuration
- No hard-coded fault logic
- Safe runtime reconfiguration
- Triggers emergency only — does **not** clear or recover emergency state
