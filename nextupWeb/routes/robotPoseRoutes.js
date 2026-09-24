// routes/robotPoseRoutes.js
// Robust minimal 6-joint robot-pose routes with cached YAML loading and path lookup.

import express from "express";
import rclnodejs from "rclnodejs";
import robotUtils from "../utils/robotUtils.js";
import ros2Manager from "../utils/ros2Manager.js";
import throttleHz from "../utils/rosThrottle.js";

const router = express.Router();

let latestJointState = null; // { position: [6 numbers], stamp, received_at }
let rclNode = null;

// Use constants from utils
const { DEFAULT_TOLERANCE, REQUIRED_JOINT_COUNT } = robotUtils;

// // ---------- rclnodejs (lazy init) ----------
// async function ensureRclInit() {
//   if (rclNode) return;
//   try {
//     await rclnodejs.init();
//     rclNode = rclnodejs.createNode('robot_pose_routes_node_minimal_paths');
//     rclNode.createSubscription('sensor_msgs/msg/JointState', '/joint_states', (msg) => {
//       try {
//         const six = robotUtils.extractFirstSixPositions(msg);
//         latestJointState = {
//           position: six,
//           stamp: msg.header ? (msg.header.stamp || null) : null,
//           received_at: new Date()
//         };
//       } catch (err) {
//         console.error('Error processing joint_states:', err && err.message);
//       }
//     });
//     rclnodejs.spin(rclNode);
//     console.log('rclnodejs subscriber started for /joint_states');
//   } catch (err) {
//     console.error('rclnodejs init failed:', err && err.message);
//     // don't throw — the server will still run; endpoints will return a 'no joint_states' error until messages arrive
//   }
// }
// // Start init but don't block module load
// ensureRclInit();


// ---------- ROS2 Initialization ----------
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

router.use(async (req, res, next) => {
  try {
    if (!latestJointState) {
      await initRobotPoseNode();
    }
    next();
  } catch (err) {
    console.error('Error in robot pose middleware:', err.message);
    next();
  }
});

// Graceful shutdown
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

// ---------- Endpoints ----------

// GET /pose/current
router.get('/current', (req, res) => {
  if (!latestJointState) return res.status(404).json({ error: 'No joint_states received yet' });
  if (!latestJointState.position) return res.status(500).json({ error: 'JointState has fewer than 6 positions' });
  res.json({ latest: latestJointState });
});

// GET /pose/points
router.get('/points', (req, res) => {
  const points = robotUtils.loadPointsCached();
  res.json({
    points,
    total: points.length,
    loaded_at: robotUtils.getPointsLoadedAt()
  });
});

// GET /pose/paths
router.get('/paths', (req, res) => {
  const paths = robotUtils.loadPathsCached();

  res.json({
    paths,
    total: paths.length,
    loaded_at: robotUtils.getPathsLoadedAt()
  });
});

// GET /pose/whereami?tolerance=0.0001
// Returns ALL matching points and their available outgoing paths + merged aggregated list
router.get('/whereami', (req, res) => {
  const tol = (typeof req.query.tolerance !== 'undefined') ? Number(req.query.tolerance) : DEFAULT_TOLERANCE;
  if (!latestJointState) return res.status(404).json({ error: 'No joint_states received yet' });
  if (!latestJointState.position) return res.status(500).json({ error: 'JointState has fewer than 6 positions' });

  const points = robotUtils.loadPointsCached();
  if (!points.length) return res.status(500).json({ error: 'No points configured or failed to load points.yaml' });

  const matchedPoints = [];
  for (const p of points) {
    if (!Array.isArray(p.joints) || p.joints.length < REQUIRED_JOINT_COUNT) continue;
    if (robotUtils.compareSix(latestJointState.position, p.joints, tol)) matchedPoints.push(p.name);
  }

  if (matchedPoints.length === 0) {
    return res.json({
      matched: false,
      points: [],
      tolerance: tol,
      timestamp: latestJointState.received_at
    });
  }

  const available_paths_per_point = matchedPoints.map(name => {
    const outs = robotUtils.findAvailablePathsFromPoint(name);
    return {
      point: name,
      outgoing_paths: outs,
      total_outgoing: outs.length
    };
  });

  // Merge paths (dedupe by name or start->end)
  const mergedPathsMap = new Map();
  const uniqueDestinationPoints = new Set();
  for (const entry of available_paths_per_point) {
    for (const p of entry.outgoing_paths) {
      const key = p.name || `${p.start_point}->${p.end_point}`;
      if (!mergedPathsMap.has(key)) mergedPathsMap.set(key, p);
      if (p.end_point) uniqueDestinationPoints.add(p.end_point);
    }
  }
  const merged_available_paths = Array.from(mergedPathsMap.values());
  const unique_available_points = Array.from(uniqueDestinationPoints);

  return res.json({
    matched: true,
    points: matchedPoints,
    primary: matchedPoints[0],
    tolerance: tol,
    timestamp: latestJointState.received_at,
    available_paths_per_point,
    merged_available_paths,
    unique_available_points
  });
});

// GET /pose/available_from_current?tolerance=0.0001
router.get('/available_from_current', (req, res) => {
  const tol = (typeof req.query.tolerance !== 'undefined') ? Number(req.query.tolerance) : DEFAULT_TOLERANCE;
  if (!latestJointState) return res.status(404).json({ error: 'No joint_states received yet' });
  if (!latestJointState.position) return res.status(500).json({ error: 'JointState has fewer than 6 positions' });

  const points = robotUtils.loadPointsCached();
  if (!points.length) return res.status(500).json({ error: 'No points configured or failed to load points.yaml' });

  const matchedPoints = points.filter(p =>
    Array.isArray(p.joints) &&
    p.joints.length >= REQUIRED_JOINT_COUNT &&
    robotUtils.compareSix(latestJointState.position, p.joints, tol)
  ).map(p => p.name);

  if (!matchedPoints.length) {
    return res.json({
      matched: false,
      points: [],
      merged_available_paths: [],
      unique_available_points: [],
      tolerance: tol
    });
  }

  const mergedPathsMap = new Map();
  const uniqueDestinationPoints = new Set();
  for (const name of matchedPoints) {
    const outs = robotUtils.findAvailablePathsFromPoint(name);
    for (const p of outs) {
      const key = p.name || `${p.start_point}->${p.end_point}`;
      if (!mergedPathsMap.has(key)) mergedPathsMap.set(key, p);
      if (p.end_point) uniqueDestinationPoints.add(p.end_point);
    }
  }

  res.json({
    matched: true,
    points: matchedPoints,
    merged_available_paths: Array.from(mergedPathsMap.values()),
    unique_available_points: Array.from(uniqueDestinationPoints),
    tolerance: tol,
    timestamp: latestJointState.received_at
  });
});

// GET /pose/match_point/:pointName?tolerance=0.0001
router.get('/match_point/:pointName', (req, res) => {
  const pointName = req.params.pointName;
  const tol = (typeof req.query.tolerance !== 'undefined') ? Number(req.query.tolerance) : DEFAULT_TOLERANCE;
  if (!pointName) return res.status(400).json({ error: 'pointName required' });
  if (!latestJointState) return res.status(404).json({ error: 'No joint_states received yet' });
  if (!latestJointState.position) return res.status(500).json({ error: 'JointState has fewer than 6 positions' });

  const points = robotUtils.loadPointsCached();
  const target = points.find(p => p.name === pointName);
  if (!target) return res.status(404).json({ error: `Point '${pointName}' not found` });
  if (!Array.isArray(target.joints) || target.joints.length < REQUIRED_JOINT_COUNT) {
    return res.status(500).json({
      error: `Point '${pointName}' does not have ${REQUIRED_JOINT_COUNT} joint values`
    });
  }

  const matched = robotUtils.compareSix(latestJointState.position, target.joints, tol);
  const diffs = robotUtils.computeDiffs(latestJointState.position, target.joints);
  const available_paths = robotUtils.findAvailablePathsFromPoint(pointName);

  res.json({
    point: pointName,
    matched,
    diffs,
    tolerance: tol,
    timestamp: latestJointState.received_at,
    available_paths,
    total_available: available_paths.length
  });
});

// GET /pose/debug/distances?tolerance=0.0001
router.get('/debug/distances', (req, res) => {
  const tol = (typeof req.query.tolerance !== 'undefined') ? Number(req.query.tolerance) : DEFAULT_TOLERANCE;
  if (!latestJointState) return res.status(404).json({ error: 'No joint_states received yet' });
  if (!latestJointState.position) return res.status(500).json({ error: 'JointState has fewer than 6 positions' });

  const points = robotUtils.loadPointsCached();
  const report = points.map(p => {
    const valid = Array.isArray(p.joints) && p.joints.length >= REQUIRED_JOINT_COUNT;
    const diffs = valid ? robotUtils.computeDiffs(latestJointState.position, p.joints) : null;
    const max_abs = diffs ? Math.max(...diffs) : null;
    return {
      name: p.name,
      valid,
      diffs,
      max_abs,
      matched: (diffs ? (max_abs <= tol) : false)
    };
  });

  report.sort((a, b) => {
    if (a.max_abs === null) return 1;
    if (b.max_abs === null) return -1;
    return a.max_abs - b.max_abs;
  });

  res.json({
    timestamp: latestJointState.received_at,
    tolerance: tol,
    report,
    total_points: points.length
  });
});


// ---------- Running Path Tracking ----------
let currentRunningPath = null;
let pathStartTime = null;

// POST /pose/start_path/:pathName
router.post('/start_path/:pathName', (req, res) => {
  const pathName = req.params.pathName;

  // Load paths to validate
  const paths = robotUtils.loadPathsCached();
  const path = paths.find(p => p.name === pathName);

  if (!path) {
    return res.status(404).json({ error: `Path '${pathName}' not found` });
  }

  currentRunningPath = {
    name: pathName,
    start_point: path.start_point,
    end_point: path.end_point,
    plan_space: path.plan_space || 'unknown',
    start_time: new Date(),
    // Add continuous flag to indicate it should run indefinitely
    continuous: true
  };
  pathStartTime = Date.now();

  console.log(`Started continuous path: ${pathName}`);

  res.json({
    success: true,
    message: `Started continuous path: ${pathName}`,
    path: currentRunningPath,
    timestamp: new Date()
  });
});

// POST /pose/stop_path
router.post('/stop_path', (req, res) => {
  if (!currentRunningPath) {
    return res.status(400).json({ error: 'No path is currently running' });
  }

  const stoppedPath = { ...currentRunningPath };
  const duration = Date.now() - pathStartTime;

  currentRunningPath = null;
  pathStartTime = null;

  console.log(`Stopped path: ${stoppedPath.name} (ran for ${duration}ms)`);

  res.json({
    success: true,
    message: `Stopped path: ${stoppedPath.name}`,
    path: stoppedPath,
    duration_ms: duration,
    timestamp: new Date()
  });
});

// GET /pose/current_running_path
router.get('/current_running_path', (req, res) => {
  if (!currentRunningPath) {
    return res.json({ running: false, path: null });
  }

  const duration = Date.now() - pathStartTime;

  // For continuous paths, we don't calculate progress
  // Instead, we can return a pulse position based on time
  const pulsePosition = (duration / 1000) % 1; // 0-1 every second

  res.json({
    running: true,
    path: currentRunningPath,
    // Progress is not meaningful for continuous paths
    pulse_position: pulsePosition, // Position of pulse along path (0-1)
    elapsed_ms: duration,
    start_time: new Date(pathStartTime),
    continuous: true
  });
});

// GET /pose/path_progress/:pathName
router.get('/path_progress/:pathName', (req, res) => {
  const pathName = req.params.pathName;

  if (!currentRunningPath || currentRunningPath.name !== pathName) {
    return res.json({ running: false, pulse_position: 0 });
  }

  const duration = Date.now() - pathStartTime;
  const pulsePosition = (duration / 1000) % 1; // 0-1 every second

  res.json({
    running: true,
    path: currentRunningPath,
    pulse_position: pulsePosition,
    elapsed_ms: duration,
    continuous: true
  });
});

export default router;