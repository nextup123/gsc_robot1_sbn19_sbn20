// backend/ros/rosService.js
import { LightweightROSBridge } from './LightweightROSBridge.js';

let rosNodeInstance = null;

// Export the same interface as before for backward compatibility
export function getROSNode() {
  return rosNodeInstance;
}

export default async function createROSNode(wsServer) {
  if (rosNodeInstance) return rosNodeInstance;
  
  const instance = new LightweightROSBridge(wsServer);
  await instance.init();
  rosNodeInstance = instance;
  return instance;
}

// Re-export for backward compatibility
export { LightweightROSBridge };