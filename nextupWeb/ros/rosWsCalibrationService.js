// ros/rosWsCalibrationService.js
//
// Thin adapter that satisfies the calibration controller's import contract.
// All ROS I/O lives in LightweightROSBridge; nothing here touches rclnodejs.
//
// Topics:
//   /start_calibration     std_msgs/String  -> frame name
//   /go_to_frame_origin    std_msgs/String  -> frame name
//   /finish_ws_calibration std_msgs/Bool    -> true

import { getROSNode } from "./rosService.js";

function bridgeOrNull(tag) {
  const ros = getROSNode();
  if (!ros) {
    console.error(`[rosWsCalibrationService] ROS bridge not available (${tag})`);
    return null;
  }
  return ros;
}

// Publish the frame name on /start_calibration.
export function publishStartCalibration(frameName) {
  const ros = bridgeOrNull("start_calibration");
  if (!ros) return false;
  ros.publishStringTopic("/start_calibration", frameName);
  return true;
}

// Publish the frame name on /go_to_frame_origin.
export function publishGoToFrameOrigin(frameName) {
  const ros = bridgeOrNull("go_to_frame_origin");
  if (!ros) return false;
  ros.publishStringTopic("/go_to_frame_origin", frameName);
  return true;
}

// Publish true on /finish_ws_calibration.
export function publishFinishWsCalibration() {
  const ros = bridgeOrNull("finish_ws_calibration");
  if (!ros) return false;
  ros.publishBoolTopic("/finish_ws_calibration", true);
  return true;
}

// Publish "{frame}_{slot}" (e.g. "tf1_point1") on /go_to_tf_point.
export function publishGoToTfPoint(target) {
  const ros = bridgeOrNull("go_to_tf_point");
  if (!ros) return false;
  ros.publishStringTopic("/go_to_tf_point", target);
  return true;
}