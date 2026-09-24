// backend/ws/LightweightWSHandler.js
// No object allocations per message - use direct dispatch table
export function createLightweightHandler(ros) {
  // Dispatch table for O(1) message handling
  const handlers = {
    // Motion (hot path - most frequent)
    'SERVO_JOG': (payload) => {
      if (payload.mode === 'joint') {
        ros.publishServoJoint(payload.data);
      } else if (payload.mode === 'twist') {
        ros.publishServoTwist(payload.linear, payload.angular, ros.getCurrentFrame());
      }
    },
    'MOVE_FORWARD': (payload) => ros.publishMove(payload?.linear, payload?.angular),
    
    // DO operations
    'TOGGLE_DO': (payload) => {
      if (payload.driver && payload.doId) {
        ros.publishDO(payload.driver, payload.doId, payload.state);
      }
    },
    
    // Mode changes
    'CHANGE_MODE': (payload) => {
      if (payload.mode === '8' || payload.mode === '9') {
        ros.publishChangeMode(payload.mode);
      }
    },
    
    // Safety
    'EMERGENCY_TRIGGER': () => ros.triggerEmergency(),
    
    // Simple responses (no processing)
    'PING': (_, ws, wsServer) => wsServer.sendTo(ws, { type: 'PONG', timestamp: Date.now() }),
  };
  
  return async function handleMessage(msg, ws, wsServer) {
    if (!msg?.type) return;
    
    const handler = handlers[msg.type];
    if (handler) {
      // Fast path - no try/catch in hot path
      handler(msg.payload, ws, wsServer);
    } else if (msg.type !== 'SERVO_JOG') {
      // Only log non-frequent unknown messages
      console.warn(`Unknown: ${msg.type}`);
    }
  };
}