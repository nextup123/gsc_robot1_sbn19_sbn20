// controller/wsCalibrationController.js
//
// REST surface for the workspace calibration popup. Persists to calibration.yaml
// through wsCalibrationService and publishes the three calibration topics through
// rosWsCalibrationService. Style mirrors pointPlanningBtController.js.

import {
  loadCalibration,
  saveCalibration,
  getCalibTimestamp,
  isValidFrameName,
  isValidSlot,
  validatePointPayload,
  buildPointRecord,
  isFrameComplete,
  POINT_SLOTS,
} from "../service/wsCalibrationService.js";
import {
  publishStartCalibration,
  publishGoToFrameOrigin,
  publishFinishWsCalibration,
  publishGoToTfPoint,
} from "../ros/rosWsCalibrationService.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("controller", "wsCalibrationController.js");

// GET /ws-calibration/getCalibration
// Returns the whole calibration map. Frontend derives frame list + which slots
// are set from this single payload.
export const getCalibrationController = async (req, res) => {
  try {
    const data = await loadCalibration();
    res.json(data);
  } catch (err) {
    log.error({ err }, "Error in /getCalibration");
    res.status(500).json({ message: err.message });
  }
};

// POST /ws-calibration/addFrame   body: { frame }
export const addFrameController = async (req, res) => {
  try {
    const { frame } = req.body;
    if (!isValidFrameName(frame)) {
      return res.status(400).json({
        message: "Frame name must contain only letters, numbers, dashes, and underscores",
      });
    }

    const data = await loadCalibration();
    if (Object.prototype.hasOwnProperty.call(data, frame)) {
      return res.status(400).json({ message: `Frame ${frame} already exists` });
    }

    // New frame starts empty (no point slots set yet).
    data[frame] = {};
    await saveCalibration(data);
    res.json({ message: `Added frame ${frame}`, frame });
  } catch (err) {
    log.error({ err }, "Error in /addFrame");
    res.status(500).json({ message: err.message });
  }
};

// POST /ws-calibration/deleteFrame   body: { frame }
export const deleteFrameController = async (req, res) => {
  try {
    const { frame } = req.body;
    if (!frame) return res.status(400).json({ message: "Frame name is required" });

    const data = await loadCalibration();
    if (!Object.prototype.hasOwnProperty.call(data, frame)) {
      return res.status(404).json({ message: `Frame ${frame} not found` });
    }

    delete data[frame];
    await saveCalibration(data);
    res.json({ message: `Deleted frame ${frame}` });
  } catch (err) {
    log.error({ err }, "Error in /deleteFrame");
    res.status(500).json({ message: err.message });
  }
};

// POST /ws-calibration/setPoint
//   body: { frame, slot, x,y,z,roll,pitch,yaw, joints:{joint1..6} }
//
// Used both for the first "Set Point N" and for re-setting/editing an existing
// point. created is preserved across re-sets; updated always bumps.
export const setPointController = async (req, res) => {
  try {
    const { frame, slot, ...payload } = req.body;

    if (!isValidFrameName(frame)) {
      return res.status(400).json({ message: "Invalid frame name" });
    }
    if (!isValidSlot(slot)) {
      return res
        .status(400)
        .json({ message: `slot must be one of ${POINT_SLOTS.join(", ")}` });
    }

    const validationError = validatePointPayload(payload);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const data = await loadCalibration();
    if (!Object.prototype.hasOwnProperty.call(data, frame)) {
      return res.status(404).json({ message: `Frame ${frame} not found` });
    }

    const now = getCalibTimestamp();
    const existing = data[frame][slot];
    const created = existing && existing.created ? existing.created : now;

    data[frame][slot] = buildPointRecord(payload, { created, updated: now });
    await saveCalibration(data);

    res.json({
      message: `${existing ? "Updated" : "Set"} ${slot} of ${frame}`,
      frame,
      slot,
      point: data[frame][slot],
      complete: isFrameComplete(data[frame]),
    });
  } catch (err) {
    log.error({ err }, "Error in /setPoint");
    res.status(500).json({ message: err.message });
  }
};

// ── Gating publishes ──────────────────────────────────────────────────────────

// POST /ws-calibration/startCalibration   body: { frame }
// Guards: frame must exist and have all four points set.
export const startCalibrationController = async (req, res) => {
  try {
    const { frame } = req.body;
    if (!frame) return res.status(400).json({ message: "Frame name is required" });

    const data = await loadCalibration();
    const frameObj = data[frame];
    if (!frameObj) {
      return res.status(404).json({ message: `Frame ${frame} not found` });
    }
    if (!isFrameComplete(frameObj)) {
      return res
        .status(400)
        .json({ message: "All four points must be set before starting calibration" });
    }

    const ok = publishStartCalibration(frame);
    if (!ok) return res.status(500).json({ message: "ROS not initialized" });

    res.json({ success: true, message: `Calibration started for ${frame}`, frame });
  } catch (err) {
    log.error({ err }, "Error in /startCalibration");
    res.status(500).json({ message: err.message });
  }
};

// POST /ws-calibration/goToFrameOrigin   body: { frame }
export const goToFrameOriginController = async (req, res) => {
  try {
    const { frame } = req.body;
    if (!frame) return res.status(400).json({ message: "Frame name is required" });

    const ok = publishGoToFrameOrigin(frame);
    if (!ok) return res.status(500).json({ message: "ROS not initialized" });

    res.json({ success: true, message: `Going to origin of ${frame}`, frame });
  } catch (err) {
    log.error({ err }, "Error in /goToFrameOrigin");
    res.status(500).json({ message: err.message });
  }
};

// POST /ws-calibration/finishCalibration
export const finishCalibrationController = async (req, res) => {
  try {
    const ok = publishFinishWsCalibration();
    if (!ok) return res.status(500).json({ message: "ROS not initialized" });

    res.json({ success: true, message: "Finish calibration published" });
  } catch (err) {
    log.error({ err }, "Error in /finishCalibration");
    res.status(500).json({ message: err.message });
  }
};

// POST /ws-calibration/goToPoint   body: { frame, slot }
// Publishes "{frame}_{slot}" on /go_to_tf_point. Guards that the point exists.
export const goToPointController = async (req, res) => {
  try {
    const { frame, slot } = req.body;
    if (!isValidFrameName(frame)) {
      return res.status(400).json({ message: "Invalid frame name" });
    }
    if (!isValidSlot(slot)) {
      return res
        .status(400)
        .json({ message: `slot must be one of ${POINT_SLOTS.join(", ")}` });
    }

    const data = await loadCalibration();
    const frameObj = data[frame];
    if (!frameObj) {
      return res.status(404).json({ message: `Frame ${frame} not found` });
    }
    if (!frameObj[slot]) {
      return res.status(404).json({ message: `${slot} of ${frame} is not set` });
    }

    const target = `${frame}_${slot}`;
    const ok = publishGoToTfPoint(target);
    if (!ok) return res.status(500).json({ message: "ROS not initialized" });

    res.json({ success: true, message: `Moving to ${target}`, target });
  } catch (err) {
    log.error({ err }, "Error in /goToPoint");
    res.status(500).json({ message: err.message });
  }
};