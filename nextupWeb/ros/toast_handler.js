// backend/ros/toast-handler.js
// ROS2 subscription handler for toast notifications
// Call this from your ROS initialization code

/**
 * Set up the toast notification subscription
 * Should be called during ROS node initialization
 * 
 * @param {Object} node - ROS2 Node instance
 * @param {Object} wsServer - WebSocket server instance (has broadcastToAllClients or sendToAll method)
 * @param {Object} options - Optional configuration
 */
export function setupToastSubscription(node, wsServer, options = {}) {
  const {
    topicName = '/bt_toast_popup',
    logToConsole = true,
    validateMessage = true
  } = options;

  if (!node || !wsServer) {
    console.error('setupToastSubscription: node and wsServer are required');
    return;
  }

  try {
    node.createSubscription("std_msgs/msg/String", topicName, (msg) => {
      try {
        const rawMessage = msg.data;

        if (logToConsole) {
          console.log(`[TOAST] Received from ${topicName}:`, rawMessage);
        }

        // Parse the message: "Original Message,category,duration"
        const parsed = parseToastMessage(rawMessage);

        if (!parsed) {
          console.warn('[TOAST] Failed to parse message:', rawMessage);
          return;
        }

        const { message, category, duration } = parsed;

        // Validate duration if enabled
        if (validateMessage && duration < 0) {
          console.warn('[TOAST] Invalid duration, treating as 0 (indefinite):', duration);
          parsed.duration = 0;
        }

        // Broadcast to all connected WebSocket clients
        broadcastToastToClients(wsServer, parsed);

        // Also log to backend logs
        const logMessage = `TOAST | ${category.toUpperCase()} | ${message} | Duration: ${parsed.duration}ms`;
        if (node.publishLogMessage) {
          node.publishLogMessage(logMessage);
        }

      } catch (err) {
        console.error('[TOAST] Error processing toast message:', err);
      }
    });

    console.log(`✓ Toast subscription initialized on ${topicName}`);

  } catch (err) {
    console.error(`✗ Failed to create toast subscription: ${err.message}`);
  }
}

/**
 * Parse toast message format: "Message,category,duration"
 * 
 * @param {string} str - Raw message string
 * @returns {Object|null} - { message, category, duration } or null if invalid
 */
function parseToastMessage(str) {
  try {
    // Split by comma (max 3 parts to handle messages with commas)
    const lastCommaIdx = str.lastIndexOf(',');
    if (lastCommaIdx === -1) {
      console.warn('[TOAST] Message missing commas:', str);
      return null;
    }

    const secondLastCommaIdx = str.lastIndexOf(',', lastCommaIdx - 1);
    if (secondLastCommaIdx === -1) {
      console.warn('[TOAST] Message missing second comma:', str);
      return null;
    }

    const message = str.substring(0, secondLastCommaIdx).trim();
    const category = str.substring(secondLastCommaIdx + 1, lastCommaIdx).trim().toLowerCase();
    const durationStr = str.substring(lastCommaIdx + 1).trim();

    const duration = parseInt(durationStr, 10);

    if (!message || !category) {
      console.warn('[TOAST] Invalid message or category:', { message, category });
      return null;
    }

    if (isNaN(duration)) {
      console.warn('[TOAST] Invalid duration (not a number):', durationStr);
      return null;
    }

    // Normalize category names
    const validCategories = ['error', 'failure', 'warning', 'success', 'info'];
    const normalizedCategory = validCategories.includes(category) ? category : 'info';

    if (normalizedCategory !== category) {
      console.warn(`[TOAST] Unknown category "${category}", using "info" instead`);
    }

    return {
      message,
      category: normalizedCategory,
      duration: Math.max(0, duration) // Ensure duration is non-negative
    };

  } catch (err) {
    console.error('[TOAST] Error parsing message:', err);
    return null;
  }
}

/**
 * Broadcast toast notification to all connected WebSocket clients
 * 
 * @param {Object} wsServer - WebSocket server instance
 * @param {Object} toast - { message, category, duration }
 */
function broadcastToastToClients(wsServer, toast) {
  const toastMessage = {
    type: 'TOAST_NOTIFICATION',
    payload: {
      message: toast.message,
      category: toast.category,
      duration: toast.duration,
      timestamp: Date.now()
    }
  };

  // Try multiple broadcast method names to be compatible with different ws server setups
  if (wsServer.broadcastToAllClients) {
    wsServer.broadcastToAllClients(toastMessage);
  } else if (wsServer.broadcast) {
    wsServer.broadcast(toastMessage);
  } else if (wsServer.clients) {
    // Direct client iteration if broadcast methods don't exist
    wsServer.clients.forEach(client => {
      if (client.readyState === 1) { // OPEN state
        try {
          client.send(JSON.stringify(toastMessage));
        } catch (err) {
          console.error('[TOAST] Error sending to client:', err);
        }
      }
    });
  } else {
    console.warn('[TOAST] Unable to broadcast: wsServer has no suitable broadcast method');
  }
}

export { parseToastMessage };