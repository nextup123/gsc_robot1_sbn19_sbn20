## MoveIt Servo Configuration (UI Control)

### Purpose
This configuration sets up **MoveIt Servo** for **UI-based Cartesian and joint velocity control**
using on-screen controls (no joystick input). It is designed to work with the `UiServo` node
using incremental `+ / −` commands.

---

### Input Commands

- **Cartesian velocity commands**
  - Topic: `~/delta_twist_cmds`
  - Units: m/s (linear), rad/s (angular)

- **Joint velocity commands**
  - Topic: `~/delta_joint_cmds`
  - Units: rad/s

---

### Output Commands

- Message type: `std_msgs/Float64MultiArray`
- Topic: `/robot_manipulator_velocity_controller/commands`
- Output content:
  - Joint velocity commands only
  - No Cartesian commands are published downstream

---

### Control Mode

- Intended for UI-based interaction
- Works with increment/decrement (`+ / −`) buttons
- Driven by the `UiServo` node
- Not designed for joystick or continuous analog input

---

### Publish Rate

- `publish_period`: **0.04 s**
- Effective rate: **~25 Hz**
- `low_latency_mode`: **false**
  - Prioritizes stability over ultra-low latency

---

### Frames & Kinematics

- Planning frame: `base_link`
- End effector frame: `end`
- Command frame: `base_link`
- All velocity commands are expressed in the planning frame

---

### Robot Group

- MoveIt planning group: `robot_manipulator`

---

### Safety & Stability

- Collision checking: **enabled**
- Singularity protection:
  - Velocity slowdown near singularities
  - Hard stop at singularity threshold
- Command timeout:
  - Automatic halt if no command is received for **0.1 s**

---

### Smoothing & Filtering

- Butterworth low-pass filter: **enabled**
- Provides smooth, stable motion
- Reduces command noise from UI inputs
