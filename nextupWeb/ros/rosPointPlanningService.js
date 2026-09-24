// backend/ros/rosPointPlanningService.js
//
// This file is a thin adapter that satisfies controller import contracts.
// All ROS I/O (subscriptions, publishers) lives in LightweightROSBridge.
// Nothing here touches rclnodejs directly.

import { getROSNode } from './rosService.js';

// ---------------------------------------------------------------------------
// initPointPlanningROS
// Previously created subscriptions on the node directly. Those subscriptions
// (/joint_values, /cartesian_values) are now owned by LightweightROSBridge
// inside setupSubscribers(). This function is kept as a no-op so that the
// call site in rosService.js init() doesn't need to change.
// ---------------------------------------------------------------------------
export function initPointPlanningROS(rosNode, wsServer) {
    // Intentional no-op.
    // Subscriptions are registered in LightweightROSBridge.setupSubscribers().
}

// ---------------------------------------------------------------------------
// publishToUICommand
// Used by: pointPlanningBtController → editedPointNotificationController (indirectly)
// Delegates to the bridge's publishUiCommand method.
// ---------------------------------------------------------------------------
export function publishToUICommand(command) {
    const ros = getROSNode();

    if (!ros) {
        console.error('[rosPointPlanningService] ROS bridge not available');
        return false;
    }

    ros.publishUiCommand(command);
    return true;
}

// ---------------------------------------------------------------------------
// publishEditedPoint
// Used by: pointPlanningBtController → editedPointNotificationController
// Publishes the edited point name to /edited_point_name via the bridge's
// generic string publisher.
// ---------------------------------------------------------------------------
export function publishEditedPoint(pointName) {
    const ros = getROSNode();

    if (!ros) {
        console.error('[rosPointPlanningService] ROS bridge not available');
        return false;
    }

    ros.publishStringTopic('/edited_point_name', pointName);
    return true;
}

// ---------------------------------------------------------------------------
// getLatestRobotStatus
// Used by: pointPlanningBtController → getRobotStatusController (REST endpoint)
// Reads cached values from the bridge instance so the REST caller gets the
// most recent data without an extra subscription here.
// ---------------------------------------------------------------------------
export function getLatestRobotStatus() {
    const ros = getROSNode();

    return {
        jointValues:      ros?.latestJointValues      ?? [0, 0, 0, 0, 0, 0],
        cartesianValues:  ros?.latestCartesianValues   ?? [0, 0, 0, 0, 0, 0],
        timestamp:        Date.now(),
    };
}

// ---------------------------------------------------------------------------
// setMotionType / getCurrentMotionType
// The actual motion type publish goes through ros.publishMotionType() in the
// bridge, called directly from wsHandler. The local state here was never read
// by anything meaningful, so these are kept only for import compatibility.
// ---------------------------------------------------------------------------
let _currentMotionType = 'cartesian';

export function setMotionType(type) {
    _currentMotionType = type;
}

export function getCurrentMotionType() {
    return _currentMotionType;
}