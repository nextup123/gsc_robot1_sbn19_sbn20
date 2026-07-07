# utility_nodes.launch.py

## Purpose

This launch file brings up the complete utility and motion execution stack for the Nextup robot,
built on ROS 2 and MoveIt 2. It initializes robot description, TF, servo control, motion execution,
UI command handling, and safety-critical monitoring nodes in a deterministic and safe startup order.

---

## What This Launch File Does

- Builds the MoveIt 2 configuration for the `nextup` robot using `MoveItConfigsBuilder`
- Loads MoveIt Servo parameters from `robot_simulated_config.yaml`
- Starts core MoveIt components inside a multi-threaded composable container
- Launches utility, execution, and safety nodes in a strict timed sequence
- Prevents race conditions during system startup

---

## Core Infrastructure (Composable Container)

### Robot State Publisher
- Publishes robot URDF, joint states, and TF tree
- Required for MoveIt, Servo, and visualization

### Static TF Broadcaster
- Publishes static transform: `/world → /base_link`
- Provides a fixed global reference frame

---

## Motion & Servo Control

### MoveIt Servo Node
- Enables real-time joint and Cartesian servoing
- Used for jog, teleoperation, and UI-driven motion

### UI Command Node
- Receives velocity commands from the UI
- Publishes joint and twist commands to Servo
- Enforces velocity limits for safe operation

### Joint ↔ Cartesian Mapping Node
- Converts joint-space values to Cartesian targets
- Bridges UI inputs with motion planning logic

---

## Motion Execution Nodes

### Execute Trajectory Node
- Executes pre-planned joint trajectories
- Used by planners, BTs, and automation logic

### MoveIt Go-To-Pose Node
- Executes single pose goals using MoveIt planning
- Used for point-to-point motion

### Homing Node
- Moves the robot to a known home position
- Used during startup and recovery

---

## Safety & System Monitoring

### Controller State Monitor
- Monitors all ros2_control controllers
- Publishes controller health and state

### Over Velocity Manager
- Detects joint velocity limit violations
- Triggers protective actions

### Reset Mode Manager
- Resets fault states and controller modes
- Used after errors or emergency stops

### Emergency Manager
- Handles emergency stop conditions
- Final authority for stopping robot motion

---

## Startup Sequence

- Nodes are launched sequentially using `TimerAction`
- Ensures correct dependency order:
  1. TF and robot description
  2. MoveIt Servo
  3. UI and mapping nodes
  4. Motion execution nodes
  5. Safety and monitoring nodes
- Guarantees stable and predictable system bringup

---

## Key Characteristics

- Modular and extensible launch design
- Deterministic startup behavior
- MoveIt Servo–centric control
- Safety-first execution pipeline
