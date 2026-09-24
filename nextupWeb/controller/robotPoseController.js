
import ros2Manager from "../utils/ros2Manager.js";
import throttleHz from "../utils/rosThrottle.js";

async function initRobotPoseNode() {
  try {
    // Create subscription for joint states
    await ros2Manager.createSubscription(
      'robot_pose_node',
      '/joint_states',
      'sensor_msgs/msg/JointState',
      throttleHz(2, (msg) => {
        try {
          const six = robotUtils.extractFirstSixPositions(msg);
          latestJointState = {
            position: six,
            stamp: msg.header ? (msg.header.stamp || null) : null,
            received_at: new Date()
          };
        } catch (err) {
          console.error('Error processing joint_states:', err && err.message);
        }
      })
    );


    console.log('Robot pose node initialized');
  } catch (err) {
    console.error('Failed to initialize robot pose node:', err.message);
    // Don't throw - endpoints will handle missing data
  }
}

async function shutdownAndExit(code = 0) {
  try {
    console.log('Shutting down rclnodejs...');
    if (rclNode) {
      try { rclNode.destroy(); } catch (e) { /* ignore */ }
    }
    try { await rclnodejs.shutdown(); } catch (e) { /* ignore */ }
  } catch (e) {
    console.error('Shutdown error:', e && e.message);
  } finally {
    process.exit(code);
  }
}
process.on('SIGINT', () => { console.log('SIGINT received'); shutdownAndExit(0); });
process.on('SIGTERM', () => { console.log('SIGTERM received'); shutdownAndExit(0); });