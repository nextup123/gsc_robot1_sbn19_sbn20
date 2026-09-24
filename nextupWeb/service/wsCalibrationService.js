// service/wsCalibrationService.js
//
// Read/write helpers for the workspace-calibration file (calibration.yaml).
// Mirrors the style of pointPlanningBtService.js: js-yaml load/dump, atomic
// writes (tmp -> fsync -> rename), and small pure validators.
//
// File layout (matches the on-disk format the calibration node already writes):
//
//   f1:
//     point1: { x, y, z, roll, pitch, yaw, joints:{joint1..6}, created, updated }
//     point2: ...
//     point3: ...
//     point4: ...
//   f2:
//     ...
//
// Each frame holds exactly the four point slots point1..point4. A "set" point
// is simply one that exists in the map; an unset slot is absent. This lets a
// half-calibrated frame resume correctly on reload.

import fs from "fs/promises";
import yaml from "js-yaml";
import { wsCalibrationFilePath } from "../config/path.js";

const YAML_FILE = wsCalibrationFilePath.CALIBRATION_YAML_FILE;

// The fixed, ordered slot names for a frame.
export const POINT_SLOTS = ["point1", "point2", "point3", "point4"];

// Frame name rule: letters, numbers, dash, underscore (same spirit as point names).
const FRAME_NAME_RE = /^[a-zA-Z0-9-_]+$/;

// ── timestamp: DD-MM-YYYY HH:MM:SS (matches existing calibration.yaml) ─────────
export function getCalibTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const dd = pad(now.getDate());
  const mm = pad(now.getMonth() + 1);
  const yyyy = now.getFullYear();
  const HH = pad(now.getHours());
  const MM = pad(now.getMinutes());
  const SS = pad(now.getSeconds());
  return `${dd}-${mm}-${yyyy} ${HH}:${MM}:${SS}`;
}

// ── file existence ────────────────────────────────────────────────────────────
export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ── load: tolerate a missing/empty file by treating it as "no frames" ─────────
export async function loadCalibration() {
  try {
    if (!(await fileExists(YAML_FILE))) {
      return {}; // no calibration data yet
    }
    const raw = await fs.readFile(YAML_FILE, "utf8");
    const data = yaml.load(raw);
    // js-yaml returns undefined/null for an empty file
    if (!data || typeof data !== "object") return {};
    return data;
  } catch (err) {
    console.error("Error loading calibration YAML:", err);
    throw new Error(`Failed to load calibration YAML: ${err.message}`);
  }
}

// ── save: atomic write (tmp -> fsync -> rename) ───────────────────────────────
export async function saveCalibration(data) {
  try {
    const yamlStr = yaml.dump(data ?? {}, { noRefs: true, noCompatMode: true });
    const tmp = `${YAML_FILE}.tmp`;
    const fh = await fs.open(tmp, "w");
    try {
      await fh.writeFile(yamlStr, "utf8");
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fs.rename(tmp, YAML_FILE);
  } catch (err) {
    console.error("Error saving calibration YAML:", err);
    throw new Error(`Failed to save calibration YAML: ${err.message}`);
  }
}

// ── validators ────────────────────────────────────────────────────────────────
export function isValidFrameName(name) {
  return typeof name === "string" && FRAME_NAME_RE.test(name);
}

export function isValidSlot(slot) {
  return POINT_SLOTS.includes(slot);
}

const COORD_KEYS = ["x", "y", "z", "roll", "pitch", "yaw"];
const JOINT_KEYS = ["joint1", "joint2", "joint3", "joint4", "joint5", "joint6"];

// Validate the body for a set/update point operation.
// Returns an error string, or null when valid.
export function validatePointPayload(payload) {
  if (!payload || typeof payload !== "object") return "Missing point payload";
  const errors = [];

  COORD_KEYS.forEach((k) => {
    if (typeof payload[k] !== "number" || Number.isNaN(payload[k])) {
      errors.push(`Coordinate ${k} must be a number`);
    }
  });

  const joints = payload.joints;
  if (!joints || typeof joints !== "object") {
    errors.push("Missing joints object");
  } else {
    JOINT_KEYS.forEach((j) => {
      if (typeof joints[j] !== "number" || Number.isNaN(joints[j])) {
        errors.push(`joints.${j} must be a number`);
      }
    });
  }

  return errors.length ? errors.join(", ") : null;
}

// Build the normalized point object that gets written to disk. Pulls only the
// known keys so stray fields from the request body never leak into the YAML.
export function buildPointRecord(payload, { created, updated }) {
  return {
    x: Number(payload.x),
    y: Number(payload.y),
    z: Number(payload.z),
    roll: Number(payload.roll),
    pitch: Number(payload.pitch),
    yaw: Number(payload.yaw),
    joints: {
      joint1: Number(payload.joints.joint1),
      joint2: Number(payload.joints.joint2),
      joint3: Number(payload.joints.joint3),
      joint4: Number(payload.joints.joint4),
      joint5: Number(payload.joints.joint5),
      joint6: Number(payload.joints.joint6),
    },
    created,
    updated,
  };
}

// True when all four slots exist on a frame object.
export function isFrameComplete(frameObj) {
  if (!frameObj || typeof frameObj !== "object") return false;
  return POINT_SLOTS.every((s) => frameObj[s] && typeof frameObj[s] === "object");
}