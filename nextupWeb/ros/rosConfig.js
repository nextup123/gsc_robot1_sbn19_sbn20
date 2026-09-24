// backend/config/rosConfig.js
// Frozen for performance (V8 optimizes property access)
export const ROS_TOPICS = Object.freeze({
  // Motion (high frequency - use raw, no overhead)
  SERVO_TWIST: '/servo_node/delta_twist_cmds',
  SERVO_JOINT: '/robot_manipulator_velocity_controller/commands',
  CMD_VEL: '/cmd_vel',
  
  // Status (throttled)
  JOINT_STATES: '/joint_states',
  DRIVER_STATUS: '/nextup_driver_status',
  DIGITAL_INPUTS: '/nextup_digital_inputs',
  
  // Control (low frequency)
  CHANGE_MODE: '/change_mode',
  EMERGENCY: '/nextup_emergency_trigger_controller/commands',
});

// Pre-allocated QoS (reused, not recreated)
export const RELIABLE_QOS = Object.freeze({
  reliability: 1,  // RMW_QOS_POLICY_RELIABILITY_RELIABLE
  history: 1,      // RMW_QOS_POLICY_HISTORY_KEEP_LAST
  depth: 10,
});

// Throttling intervals (ms)
export const THROTTLE = Object.freeze({
  DI_BROADCAST: 100,      // Digital inputs: 10Hz max
  JOINT_STATES: 50,       // Joint states: 20Hz max
  STATUS_UPDATE: 200,     // General status: 5Hz max
});

// Joint order as frozen array for fast lookup
export const JOINT_ORDER = Object.freeze(['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6']);