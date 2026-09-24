// routes/runPathRoutes.js
const express = require('express');
const router = express.Router();
const ros2Manager = require('../utils/ros2Manager');

/**
 * POST /run-path-with-velocity-scale
 * Body: { pathName: string, velocity?: number }
 *
 * Publishes to topic /path_with_velocity_scale (std_msgs/msg/String)
 * Message data format: "pathName,velocity"  (e.g. "p1_p2,0.15")
 */
router.post('/run-path-with-velocity-scale', async (req, res) => {
  try {
    const { pathName, velocity } = req.body || {};

    if (!pathName || typeof pathName !== 'string') {
      return res.status(400).json({ error: 'pathName (string) is required in request body' });
    }

    // Default velocity 0.2 if not provided or invalid
    let vel = 0.2;
    if (velocity !== undefined && velocity !== null) {
      const parsed = parseFloat(velocity);
      if (!Number.isNaN(parsed) && parsed >= 0) {
        vel = parsed;
      } else {
        return res.status(400).json({ error: 'velocity must be a non-negative number if provided' });
      }
    }

    // Ensure ROS2 publisher exists (ros2Manager will create node if needed)
    const topic = '/path_with_velocity_scale';
    const messageType = 'std_msgs/msg/String';
    const publisher = await ros2Manager.createPublisher('run_path_publisher', topic, messageType);

    // Construct data payload and publish
    const payloadStr = `${pathName},${vel}`;
    publisher.publish({ data: payloadStr });

    return res.json({ ok: true, published: payloadStr });
  } catch (err) {
    console.error('Error in /run-path-with-velocity-scale:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

module.exports = router;
