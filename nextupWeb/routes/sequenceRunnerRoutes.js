// routes/sequenceRoutes.js - FIXED VERSION (Circular Reference Issue)
import express from 'express';
import robotUtils from '../utils/robotUtils.js';
import ros2Manager from '../utils/ros2Manager.js';
import throttleHz from '../utils/rosThrottle.js';

const router = express.Router();

// Configuration
const DEFAULT_VELOCITY = 0.2;
const FEEDBACK_TIMEOUT = 2000;
const FEEDBACK_POLL_INTERVAL = 100;

// State management
let executionState = {
  active: false,
  currentSequence: null,
  currentStepIndex: -1,
  stepsCompleted: 0,
  stepsTotal: 0,
  error: null,
  startTime: null,
  currentStep: null,
  currentStepStartTime: null,
  currentStepEndTime: null,
  currentPose: null,
  completed: false,
  stepHistory: [],
  waitingForCompletion: false,
  // New: Feedback tracking (BUT NOT the timeout object)
  lastFeedback: null,
  lastFeedbackTime: null,
  feedbackTimeout: null, // This will hold the Timeout object (circular)
  currentPathName: null,
  expectingRunningFeedback: false
};

// ---------- ROS2 Publishers and Subscribers ----------
let pathCommandPublisher = null;
let lastStatusData = null;
let isInitializing = false;

// Helper to clean objects for JSON serialization
function cleanForJSON(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(cleanForJSON);
  }

  if (typeof obj === 'object') {
    // Check for circular references by looking for known problematic properties
    if (obj.constructor && obj.constructor.name === 'Timeout') {
      // Return a simple representation instead of the Timeout object
      return { _type: 'Timeout', exists: true };
    }

    // Create a new object without circular references
    const cleaned = {};
    for (const key in obj) {
      if (key === 'feedbackTimeout' || key === '_idlePrev' || key === '_idleNext' ||
        key === '_idleStart' || key === '_onTimeout' || key === '_timerArgs') {
        // Skip timeout-related properties
        continue;
      }

      try {
        cleaned[key] = cleanForJSON(obj[key]);
      } catch (err) {
        // If we can't serialize it, skip it
        cleaned[key] = `[Unable to serialize: ${err.message}]`;
      }
    }
    return cleaned;
  }

  // Return primitives as-is
  return obj;
}

async function initSequenceNode() {
  if (isInitializing) {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (!isInitializing && pathCommandPublisher) {
          clearInterval(checkInterval);
          resolve(true);
        }
      }, 100);
    });
  }

  isInitializing = true;

  try {
    console.log('Initializing sequence node...');

    pathCommandPublisher = await ros2Manager.createPublisher(
      'sequence_execution_node',
      '/path_with_velocity_scale',
      'std_msgs/msg/String'
    );

    await ros2Manager.createSubscription(
      'sequence_execution_node',
      '/running_path_status',
      'std_msgs/msg/String',
      throttleHz(5, (msg) => {
        try {
          lastStatusData = msg.data;
          handlePathStatusUpdate(msg.data);
          handlePathAnimation(msg.data);
        } catch (err) {
          console.error('Error processing path status:', err.message);
        }
      })
    );


    await ros2Manager.createSubscription(
      'sequence_execution_node',
      '/joint_states',
      'sensor_msgs/msg/JointState',
      throttleHz(2, (msg) => {
        try {
          const six = robotUtils.extractFirstSixPositions(msg);
          if (six) {
            executionState.currentPose = six;
          }
        } catch (err) {
          console.error('Error processing joint_states:', err.message);
        }
      })
    );


    // console.log('Sequence execution node initialized successfully');
    isInitializing = false;
    return true;
  } catch (err) {
    console.error('Failed to initialize sequence node:', err.message);
    isInitializing = false;
    console.warn('ROS2 initialization failed, but server will continue in degraded mode');
    return false;
  }
}


let currentAnimatedPath = null;
let animationTimeout = null;

/**
 * Handle path animation based on ROS2 status messages
 * @param {string} statusData - Format: "{action},{path_name}" (e.g., "start,home_point2" or "stop,home_point2")
 */
async function handlePathAnimation(statusData) {
  try {
    const [status, pathName] = statusData.split(',');

    // console.log(`Path animation status: status="${status}", pathName="${pathName}"`);

    if (!status || !pathName) {
      console.error(`Invalid status data format: ${statusData}`);
      return;
    }

    const normalizedStatus = status.trim().toLowerCase();
    const normalizedPathName = pathName.trim();

    switch (normalizedStatus) {
      case 'running':
        // When we get "running" status, start animating the path
        // Only if it's not already being animated
        if (!currentAnimatedPath || currentAnimatedPath !== normalizedPathName) {
          console.log(`Path ${normalizedPathName} is now running, starting animation`);
          await startPathAnimation(normalizedPathName);
        } else {
          // Path is already being animated, just log
          console.log(`Path ${normalizedPathName} is still running`);
        }
        break;

      case 'completed':
        // When we get "completed" status, stop animating the path
        // Only if this is the path that's currently being animated
        if (currentAnimatedPath === normalizedPathName) {
          console.log(`Path ${normalizedPathName} completed, stopping animation`);
          await stopPathAnimation(normalizedPathName);
        } else if (currentAnimatedPath) {
          // Some other path is completed, but we're animating a different one
          console.log(`Path ${normalizedPathName} completed, but we're animating ${currentAnimatedPath}`);
        } else {
          // Path completed but we weren't animating it
          // console.log(`Path ${normalizedPathName} completed (no animation was running)`);
        }
        break;

      default:
        console.error(`Unknown status: ${normalizedStatus}`);
    }
  } catch (err) {
    console.error(`Error handling path animation: ${err.message}`);
  }
}
/**
 * Start animating a path
 * @param {string} pathName - Name of the path to animate
 */
async function startPathAnimation(pathName) {
  try {
    // If there's already a path running, stop it first
    if (currentAnimatedPath) {
      console.log(`Stopping current path (${currentAnimatedPath}) before starting new one (${pathName})`);
      await stopCurrentAnimation();
    }

    // Call the start_path endpoint
    const response = await fetch(`http://localhost:3003/pose/start_path/${pathName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to start path: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    if (result.success) {
      currentAnimatedPath = pathName;
      console.log(`Started animating path: ${pathName}`);

      // Optional: Set up periodic status checking
      if (animationTimeout) {
        clearTimeout(animationTimeout);
      }

      // Check status every 5 seconds while animating
      animationTimeout = setTimeout(() => {
        checkAnimationStatus(pathName);
      }, 5000);

    } else {
      throw new Error(`Start path failed: ${result.message || 'Unknown error'}`);
    }
  } catch (err) {
    console.error(`Error starting path animation for ${pathName}: ${err.message}`);
    currentAnimatedPath = null;
  }
}

/**
 * Stop animating a path
 * @param {string} pathName - Name of the path to stop (optional, will stop current if not specified)
 */
async function stopPathAnimation(pathName = null) {
  try {
    // If a specific path is provided but it's not the current one, log warning
    if (pathName && currentAnimatedPath && pathName !== currentAnimatedPath) {
      console.warn(`Requested to stop path "${pathName}" but current animated path is "${currentAnimatedPath}"`);
    }

    // If no path is currently animated, nothing to do
    if (!currentAnimatedPath) {
      console.log('No path is currently animated to stop');
      return;
    }

    // Call the stop_path endpoint
    const response = await fetch('http://localhost:3003/pose/stop_path', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to stop path: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    if (result.success) {
      console.log(`Stopped animating path: ${currentAnimatedPath}`);
      currentAnimatedPath = null;

      // Clear the status check timeout
      if (animationTimeout) {
        clearTimeout(animationTimeout);
        animationTimeout = null;
      }
    } else {
      throw new Error(`Stop path failed: ${result.message || 'Unknown error'}`);
    }
  } catch (err) {
    console.error(`Error stopping path animation: ${err.message}`);
  }
}

/**
 * Stop whatever path is currently being animated
 */
async function stopCurrentAnimation() {
  if (currentAnimatedPath) {
    await stopPathAnimation(currentAnimatedPath);
  }
}

/**
 * Check the status of the currently animated path
 * @param {string} pathName - Name of the path to check
 */
async function checkAnimationStatus(pathName) {
  if (!currentAnimatedPath || currentAnimatedPath !== pathName) {
    // Path is no longer being animated
    return;
  }

  try {
    const response = await fetch(`http://localhost:3003/pose/path_progress/${pathName}`);

    if (response.ok) {
      const status = await response.json();

      if (status.running) {
        // Path is still running, check again in 5 seconds
        console.log(`Path ${pathName} is still running (pulse: ${status.pulse_position.toFixed(2)})`);
        animationTimeout = setTimeout(() => {
          checkAnimationStatus(pathName);
        }, 5000);
      } else {
        // Path has stopped
        console.log(`Path ${pathName} is no longer running`);
        currentAnimatedPath = null;
      }
    }
  } catch (err) {
    console.error(`Error checking animation status for ${pathName}: ${err.message}`);

    // Try again in 10 seconds if there's an error
    if (currentAnimatedPath === pathName) {
      animationTimeout = setTimeout(() => {
        checkAnimationStatus(pathName);
      }, 10000);
    }
  }
}

/**
 * Get current animation status
 * @returns {Object} Current animation status
 */
function getAnimationStatus() {
  return {
    active: !!currentAnimatedPath,
    currentPath: currentAnimatedPath,
    timestamp: new Date()
  };
}

// Update the handlePathStatusUpdate function to use the animation handler
function handlePathStatusUpdate(statusData) {
  try {
    // Parse the status data
    const [action, pathName] = statusData.split(',');

    if (!action || !pathName) {
      console.error(`Invalid status format: ${statusData}`);
      return;
    }

    // Update execution state
    executionState.lastFeedback = statusData;
    executionState.lastFeedbackTime = new Date();

    const normalizedAction = action.trim().toLowerCase();

    // Handle animation if it's a start/stop command
    if (normalizedAction === 'start' || normalizedAction === 'stop') {
      handlePathAnimation(statusData);
    }

    // Continue with existing logic for sequence execution
    if (executionState.waitingForCompletion && normalizedAction === 'completed') {
      // Existing completion logic...
    }

  } catch (err) {
    console.error('Error in handlePathStatusUpdate:', err.message);
  }
}

// Add cleanup function for graceful shutdown
function cleanupAnimationHandler() {
  if (animationTimeout) {
    clearTimeout(animationTimeout);
    animationTimeout = null;
  }

  if (currentAnimatedPath) {
    console.log(`Cleaning up animation handler, stopping path: ${currentAnimatedPath}`);
    // Note: We don't await here because it's cleanup
    stopCurrentAnimation().catch(err => {
      console.error('Error during cleanup:', err.message);
    });
  }
}




/// ---------- Status Handling ----------
function handlePathStatusUpdate(statusData) {
  executionState.lastFeedback = statusData;
  executionState.lastFeedbackTime = new Date();

  // console.log(`Path status update: ${statusData}`);s

  const [status, pathName] = statusData.split(',');

  if (executionState.expectingRunningFeedback && status === 'running' &&
    executionState.currentPathName === pathName) {
    console.log(`✓ Confirmed path ${pathName} is running`);
    if (executionState.feedbackTimeout) {
      clearTimeout(executionState.feedbackTimeout);
      executionState.feedbackTimeout = null; // Clear the reference
    }
    executionState.expectingRunningFeedback = false;
  }

  if (!executionState.active) {
    return;
  }

  if (status === 'completed') {
    if (executionState.currentSequence &&
      executionState.currentStepIndex >= 0) {

      const currentStep = executionState.currentSequence.steps[executionState.currentStepIndex];

      if (currentStep.path === pathName && executionState.waitingForCompletion) {
        console.log(`✓ Step ${currentStep.path} completed successfully`);

        executionState.currentStepEndTime = new Date();
        const stepDuration = executionState.currentStepStartTime ?
          (executionState.currentStepEndTime - executionState.currentStepStartTime) / 1000 : 0;

        executionState.stepHistory.push({
          stepIndex: executionState.currentStepIndex,
          step: currentStep,
          startTime: executionState.currentStepStartTime,
          endTime: executionState.currentStepEndTime,
          duration: stepDuration,
          status: 'completed'
        });

        executionState.stepsCompleted++;
        executionState.waitingForCompletion = false;
        executionState.currentPathName = null;

        executionState.currentStep = null;
        executionState.currentStepStartTime = null;
        executionState.currentStepEndTime = null;

        setTimeout(() => {
          executeNextStep();
        }, 1000);
      }
    }
  } else if (status === 'error') {
    console.error(`✗ Path execution error for ${pathName}`);
    executionState.error = `Path execution failed for ${pathName}`;
    executionState.active = false;
    executionState.waitingForCompletion = false;
    executionState.expectingRunningFeedback = false;
    executionState.currentPathName = null;
    if (executionState.feedbackTimeout) {
      clearTimeout(executionState.feedbackTimeout);
      executionState.feedbackTimeout = null;
    }

    if (executionState.currentStepIndex >= 0) {
      const currentStep = executionState.currentSequence.steps[executionState.currentStepIndex];
      executionState.stepHistory.push({
        stepIndex: executionState.currentStepIndex,
        step: currentStep,
        startTime: executionState.currentStepStartTime,
        endTime: new Date(),
        duration: executionState.currentStepStartTime ?
          (new Date() - executionState.currentStepStartTime) / 1000 : 0,
        status: 'error',
        error: `Path execution failed`
      });
    }
  }
}

function checkFeedbackReceived() {
  if (!executionState.expectingRunningFeedback) {
    return true;
  }

  if (executionState.lastFeedback) {
    const [status, pathName] = executionState.lastFeedback.split(',');
    if (status === 'running' && pathName === executionState.currentPathName) {
      return true;
    }
  }

  return false;
}

function waitForFeedback(pathName, timeout = FEEDBACK_TIMEOUT) {
  return new Promise((resolve, reject) => {
    console.log(`Waiting for running feedback for ${pathName}...`);

    executionState.expectingRunningFeedback = true;
    executionState.currentPathName = pathName;

    const checkInterval = setInterval(() => {
      if (checkFeedbackReceived()) {
        clearInterval(checkInterval);
        if (timeoutId) {
          clearTimeout(timeoutId);
          executionState.feedbackTimeout = null;
        }
        executionState.expectingRunningFeedback = false;
        resolve(true);
      }
    }, FEEDBACK_POLL_INTERVAL);

    const timeoutId = setTimeout(() => {
      clearInterval(checkInterval);
      executionState.expectingRunningFeedback = false;
      console.error(`✗ Timeout waiting for running feedback for ${pathName}`);
      reject(new Error(`No running feedback received for ${pathName} within ${timeout}ms`));
    }, timeout);

    executionState.feedbackTimeout = timeoutId;
  });
}

// ---------- Sequence Execution ----------
async function executeNextStep() {
  if (!executionState.active || executionState.waitingForCompletion) {
    return;
  }

  if (executionState.stepsCompleted >= executionState.stepsTotal) {
    console.log('✓ All steps completed, finishing sequence');
    executionState.active = false;
    executionState.completed = true;
    executionState.endTime = new Date();

    if (executionState.startTime) {
      executionState.totalDuration = (executionState.endTime - executionState.startTime) / 1000;
    }

    console.log(`Sequence ${executionState.currentSequence?.id} completed successfully in ${executionState.totalDuration || 0}s`);
    return;
  }

  const stepIndex = executionState.stepsCompleted;

  if (stepIndex >= executionState.currentSequence.steps.length) {
    executionState.active = false;
    executionState.completed = true;
    executionState.endTime = new Date();

    if (executionState.startTime) {
      executionState.totalDuration = (executionState.endTime - executionState.startTime) / 1000;
    }

    return;
  }

  const step = executionState.currentSequence.steps[stepIndex];
  executionState.currentStepIndex = stepIndex;

  console.log(`\n=== Processing Step ${stepIndex + 1}/${executionState.stepsTotal} ===`);
  console.log(`Path: ${step.path}`);
  console.log(`From: ${step.from} → To: ${step.to}`);

  const velocity = step.velocity || DEFAULT_VELOCITY;
  const command = `${step.path},${velocity}`;

  console.log(`Executing: ${command}`);

  if (!pathCommandPublisher) {
    console.error('✗ Path command publisher not initialized');
    executionState.error = 'ROS2 publisher not available.';
    executionState.active = false;

    executionState.stepHistory.push({
      stepIndex: stepIndex,
      step: step,
      startTime: new Date(),
      endTime: new Date(),
      duration: 0,
      status: 'error',
      error: 'ROS2 publisher not initialized'
    });

    return;
  }

  const msg = { data: command };

  try {
    executionState.lastFeedback = null;
    executionState.lastFeedbackTime = null;

    pathCommandPublisher.publish(msg);
    console.log(`✓ Published command to /path_with_velocity_scale: ${command}`);

    try {
      await waitForFeedback(step.path);
      console.log(`✓ Path ${step.path} confirmed running`);

      executionState.currentStep = step;
      executionState.currentStepStartTime = new Date();
      executionState.waitingForCompletion = true;

      executionState.stepHistory.push({
        stepIndex: stepIndex,
        step: step,
        startTime: executionState.currentStepStartTime,
        status: 'started',
        command: command,
        confirmed: true
      });

    } catch (feedbackError) {
      console.error(`✗ No running feedback received: ${feedbackError.message}`);
      executionState.error = `Failed to start path ${step.path}: ${feedbackError.message}`;
      executionState.active = false;

      executionState.stepHistory.push({
        stepIndex: stepIndex,
        step: step,
        startTime: new Date(),
        endTime: new Date(),
        duration: 0,
        status: 'error',
        error: `No running feedback received: ${feedbackError.message}`
      });
    }

  } catch (err) {
    console.error('✗ Failed to publish command:', err.message);
    executionState.error = `Failed to publish command: ${err.message}`;
    executionState.active = false;
    executionState.expectingRunningFeedback = false;
    if (executionState.feedbackTimeout) {
      clearTimeout(executionState.feedbackTimeout);
      executionState.feedbackTimeout = null;
    }

    executionState.stepHistory.push({
      stepIndex: stepIndex,
      step: step,
      startTime: new Date(),
      endTime: new Date(),
      duration: 0,
      status: 'error',
      error: `Publish failed: ${err.message}`
    });
  }
}

// ---------- Sequence Validation ----------
function validateSequence(sequence) {
  const errors = [];

  if (!sequence.id) errors.push('Sequence ID is required');
  if (!sequence.steps || !Array.isArray(sequence.steps)) {
    errors.push('Steps array is required');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// ---------- Safe State Access ----------
function getExecutionState() {
  try {
    // Create a clean copy of the state WITHOUT circular references
    const cleanState = {
      active: executionState.active,
      currentSequence: executionState.currentSequence,
      currentStepIndex: executionState.currentStepIndex,
      stepsCompleted: executionState.stepsCompleted,
      stepsTotal: executionState.stepsTotal,
      error: executionState.error,
      startTime: executionState.startTime,
      endTime: executionState.endTime,
      currentStep: executionState.currentStep,
      currentStepStartTime: executionState.currentStepStartTime,
      currentStepEndTime: executionState.currentStepEndTime,
      currentPose: executionState.currentPose,
      completed: executionState.completed,
      stepHistory: executionState.stepHistory,
      waitingForCompletion: executionState.waitingForCompletion,
      lastFeedback: executionState.lastFeedback,
      lastFeedbackTime: executionState.lastFeedbackTime,
      currentPathName: executionState.currentPathName,
      expectingRunningFeedback: executionState.expectingRunningFeedback,
      totalDuration: executionState.totalDuration
    };

    // Calculate progress
    if (cleanState.stepsTotal > 0) {
      cleanState.progress = {
        percentage: Math.round((cleanState.stepsCompleted / cleanState.stepsTotal) * 100),
        steps_completed: cleanState.stepsCompleted,
        steps_total: cleanState.stepsTotal
      };
    }

    // Add formatted elapsed time
    if (cleanState.startTime) {
      const elapsed = new Date() - cleanState.startTime;
      cleanState.elapsedTime = formatTime(elapsed);
      cleanState.elapsedSeconds = elapsed / 1000;
    }

    // Calculate total duration if completed
    if (cleanState.completed && cleanState.startTime && cleanState.endTime) {
      cleanState.totalDuration = (cleanState.endTime - cleanState.startTime) / 1000;
      cleanState.totalDurationFormatted = formatTime(cleanState.totalDuration * 1000);
    }

    // Get current step info
    if (cleanState.currentStep) {
      cleanState.currentStepInfo = {
        ...cleanState.currentStep,
        step_number: cleanState.currentStepIndex + 1,
        has_started: !!cleanState.currentStepStartTime,
        start_time: cleanState.currentStepStartTime,
        running_time: cleanState.currentStepStartTime ?
          (new Date() - cleanState.currentStepStartTime) / 1000 : 0
      };
    }

    // Add feedback info (without timeout object)
    cleanState.feedback_info = {
      last_feedback: cleanState.lastFeedback,
      last_feedback_time: cleanState.lastFeedbackTime,
      expecting_running_feedback: cleanState.expectingRunningFeedback,
      current_path_name: cleanState.currentPathName,
      feedback_timeout_ms: FEEDBACK_TIMEOUT,
      ros2_initialized: !!pathCommandPublisher,
      has_feedback_timeout: !!executionState.feedbackTimeout // Boolean instead of object
    };

    return cleanState;
  } catch (error) {
    console.error('Error in getExecutionState:', error.message);
    return {
      error: 'Failed to get execution state: ' + error.message,
      active: false,
      stepsCompleted: 0,
      stepsTotal: 0,
      completed: false,
      ros2_initialized: !!pathCommandPublisher,
      server_time: new Date().toISOString()
    };
  }
}

// ---------- API Endpoints ----------
router.use(async (req, res, next) => {
  try {
    if (!pathCommandPublisher && !isInitializing) {
      console.log('Initializing sequence node for request...');
      initSequenceNode().catch(err => {
        console.warn('Background ROS2 initialization failed:', err.message);
      });
    }
    next();
  } catch (err) {
    console.error('Error in sequence middleware:', err.message);
    next();
  }
});

// POST /api/sequences/execute
router.post('/execute', async (req, res) => {
  try {
    console.log('Received execute request');
    const sequence = req.body.sequence;

    if (!sequence) {
      return res.status(400).json({ error: 'Sequence data is required' });
    }

    const validation = validateSequence(sequence);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid sequence',
        details: validation.errors
      });
    }

    if (executionState.active) {
      return res.status(409).json({
        error: 'Another sequence is already running',
        current_sequence: executionState.currentSequence?.id
      });
    }

    if (!pathCommandPublisher) {
      return res.status(503).json({
        error: 'ROS2 not initialized. Please wait for system to initialize.',
        ros2_initialized: false
      });
    }

    // Clear any existing timeout
    if (executionState.feedbackTimeout) {
      clearTimeout(executionState.feedbackTimeout);
    }

    executionState = {
      active: true,
      currentSequence: sequence,
      currentStepIndex: -1,
      stepsCompleted: 0,
      stepsTotal: sequence.steps.length,
      error: null,
      startTime: new Date(),
      currentStep: null,
      currentStepStartTime: null,
      currentStepEndTime: null,
      currentPose: executionState.currentPose,
      completed: false,
      stepHistory: [],
      totalDuration: null,
      waitingForCompletion: false,
      lastFeedback: null,
      lastFeedbackTime: null,
      feedbackTimeout: null, // Start with null
      currentPathName: null,
      expectingRunningFeedback: false
    };

    console.log(`\n=== Starting Sequence ${sequence.id} ===`);
    console.log(`Total steps: ${sequence.steps.length}`);
    sequence.steps.forEach((step, i) => {
      console.log(`  ${i + 1}. ${step.path} (${step.from} → ${step.to})`);
    });

    setTimeout(() => {
      executeNextStep();
    }, 500);

    res.json({
      message: 'Sequence execution started',
      sequence_id: sequence.id,
      total_steps: sequence.steps.length,
      execution_state: getExecutionState(),
      ros2_initialized: !!pathCommandPublisher
    });

  } catch (error) {
    console.error('Error starting sequence execution:', error.message);
    res.status(500).json({
      error: 'Failed to start sequence execution: ' + error.message,
      ros2_initialized: !!pathCommandPublisher
    });
  }
});

// GET /api/sequences/status
router.get('/status', (req, res) => {
  try {
    const state = getExecutionState();

    res.json({
      ...state,
      server_time: new Date().toISOString(),
      ros2_initialized: !!pathCommandPublisher,
      server_status: 'ok'
    });

  } catch (error) {
    console.error('Error in status endpoint:', error.message);
    res.status(500).json({
      error: 'Failed to get status: ' + error.message,
      active: false,
      server_time: new Date().toISOString(),
      server_status: 'error',
      ros2_initialized: !!pathCommandPublisher
    });
  }
});

// POST /api/sequences/stop
router.post('/stop', (req, res) => {
  try {
    if (!executionState.active) {
      return res.status(400).json({
        error: 'No active sequence to stop',
        execution_state: getExecutionState()
      });
    }

    const stoppedSequence = executionState.currentSequence;

    console.log(`Stopping sequence ${stoppedSequence?.id}`);

    // Clear timeout
    if (executionState.feedbackTimeout) {
      clearTimeout(executionState.feedbackTimeout);
    }

    executionState = {
      active: false,
      currentSequence: null,
      currentStepIndex: -1,
      stepsCompleted: 0,
      stepsTotal: 0,
      error: null,
      currentPose: executionState.currentPose,
      completed: false,
      stepHistory: executionState.stepHistory,
      totalDuration: executionState.startTime ?
        (new Date() - executionState.startTime) / 1000 : 0,
      waitingForCompletion: false,
      lastFeedback: null,
      lastFeedbackTime: null,
      feedbackTimeout: null, // Clear the timeout reference
      currentPathName: null,
      expectingRunningFeedback: false
    };

    res.json({
      message: 'Sequence stopped',
      sequence_id: stoppedSequence?.id,
      execution_state: getExecutionState(),
      ros2_initialized: !!pathCommandPublisher
    });

  } catch (error) {
    console.error('Error in stop endpoint:', error.message);
    res.status(500).json({
      error: 'Failed to stop sequence: ' + error.message,
      execution_state: getExecutionState(),
      ros2_initialized: !!pathCommandPublisher
    });
  }
});

// POST /api/sequences/refresh
router.post('/refresh', (req, res) => {
  try {
    console.log('Refreshing sequence execution state');

    if (executionState.feedbackTimeout) {
      clearTimeout(executionState.feedbackTimeout);
    }

    executionState = {
      active: false,
      currentSequence: null,
      currentStepIndex: -1,
      stepsCompleted: 0,
      stepsTotal: 0,
      error: null,
      startTime: null,
      currentStep: null,
      currentStepStartTime: null,
      currentStepEndTime: null,
      currentPose: null,
      completed: false,
      stepHistory: [],
      totalDuration: null,
      waitingForCompletion: false,
      lastFeedback: null,
      lastFeedbackTime: null,
      feedbackTimeout: null, // Clear the timeout reference
      currentPathName: null,
      expectingRunningFeedback: false
    };

    res.json({
      message: 'Sequence state refreshed',
      execution_state: getExecutionState(),
      ros2_initialized: !!pathCommandPublisher
    });

  } catch (error) {
    console.error('Error in refresh endpoint:', error.message);
    res.status(500).json({
      error: 'Failed to refresh state: ' + error.message,
      execution_state: getExecutionState(),
      ros2_initialized: !!pathCommandPublisher
    });
  }
});

// Helper function
function formatTime(milliseconds) {
  try {
    const seconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  } catch (error) {
    return '0s';
  }
}

module.exports = router;