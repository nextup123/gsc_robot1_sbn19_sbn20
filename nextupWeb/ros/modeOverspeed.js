// backend/ros/modeOverspeed.js
//
// Orchestrates the 3-mode switch (SafeAuto / Jog / Auto) with per-joint
// overspeed-threshold SDO writes to the Inovance SV660 drives.
//
// Mode → drive-mode (/change_mode) + overspeed profile:
//   auto      -> mode 8, overspeed 6000
//   safeauto  -> mode 8, overspeed 500
//   jog       -> mode 9, overspeed 350
//
// Ordering rules (critical for hardware safety):
//   * to mode 9 (jog):        overspeed services FIRST, then change_mode
//   * to mode 8 (auto/safe):  change_mode FIRST, then overspeed services
//   * mode 8 <-> mode 8:      no change_mode, just the 6 overspeed services
//
// Progress weighting (frontend mirrors this):
//   * with a mode change: change_mode = 40%, each of 6 services = 10%  -> 100%
//   * without mode change: each of 6 services = 100/6 %                -> 100%
//
// The orchestrator emits progress via an onProgress(evt) callback so the WS
// layer can stream it to the client. Any failure short-circuits and reports
// { failed: true }.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Adjust if your deploy path differs; falls back to repo-relative config/.
const OVERSPEED_YAML_CANDIDATES = [
  '/home/nextup/NextupRobot/src/nextupWeb/config/overspeed_threshold_limits.yaml',
  path.resolve(__dirname, '../config/overspeed_threshold_limits.yaml'),
];

const JOINTS = ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6'];

// Per-call timeouts (ms)
const SDO_TIMEOUT_MS = 300;    // each overspeed SetSdo call
const MODE_TIMEOUT_MS = 3000;  // ceiling for the /change_mode step to settle

// UI mode -> { changeMode: '8'|'9', profile: yaml-key }
const MODE_MAP = Object.freeze({
  auto:     { changeMode: '8', profile: 'auto' },
  safeauto: { changeMode: '8', profile: 'safeauto' },
  jog:      { changeMode: '9', profile: 'jog' },
});

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out (${ms}ms)`)), ms)
    ),
  ]);
}

function loadOverspeedConfig() {
  for (const p of OVERSPEED_YAML_CANDIDATES) {
    try {
      if (fs.existsSync(p)) {
        return yaml.load(fs.readFileSync(p, 'utf-8')).imotor_overspeed_threshold_limits;
      }
    } catch (err) {
      console.error(`[modeOverspeed] failed reading ${p}:`, err.message);
    }
  }
  throw new Error('overspeed_threshold_limits.yaml not found in any known path');
}

// ── Discrete logging to /logs_topic (NOT console) ────────────────────
// Format matches the existing string-log convention: "LEVEL | source | message".
function logToTopic(ros, level, message) {
  try {
    const line = `${level.toUpperCase()} | mode_switch | ${message}`;
    ros?.publishLogMessage?.(line);
  } catch (_) { /* never let logging break the sequence */ }
}

// Classify a drive-reported threshold value into a UI mode using the yaml
// profiles. Returns 'auto' | 'safeauto' | 'jog' | null.
function classifyByThreshold(cfg, value) {
  const j1 = 'joint1';
  const candidates = [
    ['jog', cfg.jog[j1]],
    ['safeauto', cfg.safeauto[j1]],
    ['auto', cfg.auto[j1]],
  ];
  // exact match first
  for (const [name, v] of candidates) if (v === value) return name;
  // nearest within a small tolerance (drives may report ±a few counts)
  let best = null, bestDiff = Infinity;
  for (const [name, v] of candidates) {
    const d = Math.abs(v - value);
    if (d < bestDiff) { bestDiff = d; best = name; }
  }
  return bestDiff <= 25 ? best : null;
}

/**
 * Determine the ACTUAL current mode on load by reading joint1's overspeed
 * threshold via GetSdo and combining it with the drive-reported 8/9 mode.
 *   - threshold 350  -> jog
 *   - threshold 6000 -> auto
 *   - threshold 500  -> safeauto
 * @param {object} ros
 * @param {number|undefined} driveMode  8 or 9 from /nextup_joint_states, if known
 * @returns {Promise<{mode:string|null, threshold:number|null, source:string}>}
 */
export async function detectCurrentMode({ ros, driveMode }) {
  let cfg;
  try {
    cfg = loadOverspeedConfig();
  } catch (err) {
    logToTopic(ros, 'error', `detect: config load failed: ${err.message}`);
    return { mode: null, threshold: null, source: 'config-error' };
  }

  const res = await ros.getSdo({
    masterId: 0,
    slavePosition: 0,             // joint1
    sdoIndex: cfg.index,
    sdoSubindex: cfg.subindex,
    sdoDataType: cfg.type,
    timeoutMs: SDO_TIMEOUT_MS,
  });

  if (!res?.success || Number.isNaN(res.value)) {
    // Fall back to coarse drive-mode only.
    const fallback = driveMode === 9 ? 'jog' : (driveMode === 8 ? 'safeauto' : null);
    logToTopic(ros, 'warn', `detect: GetSdo failed (${res?.message || 'no msg'}); falling back to driveMode=${driveMode} -> ${fallback}`);
    return { mode: fallback, threshold: null, source: 'drive-mode-fallback' };
  }

  const value = Math.round(res.value);
  let mode = classifyByThreshold(cfg, value);

  // Cross-check against drive mode: if drive says 9 it's jog regardless.
  if (driveMode === 9) mode = 'jog';
  else if (driveMode === 8 && mode === 'jog') mode = 'safeauto'; // inconsistent; prefer safe

  logToTopic(ros, 'info', `detect: joint1 threshold=${value}, driveMode=${driveMode} -> mode=${mode}`);
  return { mode, threshold: value, source: 'threshold' };
}

async function runSequence({ ros, mode, target, index, subindex, type, profile, emit, withModeChange }) {
  const doModeChange = withModeChange;

  // Weight model
  const serviceWeight = doModeChange ? 10 : (100 / 6);
  const modeWeight = doModeChange ? 40 : 0;

  let progress = 0;
  let failMessage = null;   // captures the reason for an aborted sequence
  emit({ phase: 'start', mode, progress, withModeChange: doModeChange });
  logToTopic(ros, 'info',
    `START -> ${mode} (drive ${target.changeMode}, modeChange=${doModeChange}); ` +
    `order=${doModeChange && target.changeMode === '9' ? 'services,then change_mode'
             : doModeChange ? 'change_mode,then services' : 'services-only'}`);

  // Helper to run all 6 SDO writes sequentially.
  const runServices = async () => {
    for (let i = 0; i < JOINTS.length; i++) {
      const joint = JOINTS[i];
      const slavePosition = i;                 // joint1->slave 0 ... joint6->slave 5
      const value = profile[joint];

      emit({ phase: 'service_start', mode, joint, slavePosition, value, progress });

      const res = await ros.setSdo({
        masterId: 0,
        slavePosition,
        sdoIndex: index,
        sdoSubindex: subindex,
        sdoDataType: type,
        sdoValue: String(value),
        timeoutMs: SDO_TIMEOUT_MS,
      });

      if (!res?.success) {
        failMessage = res?.message || `SDO write failed on ${joint} (slave ${slavePosition})`;
        logToTopic(ros, 'error',
          `SDO write FAILED ${joint} (slave ${slavePosition}) value=${value}: ${res?.message || 'no message'}`);
        emit({
          phase: 'error', failed: true, mode, joint, slavePosition,
          progress,
          message: failMessage,
        });
        return false;
      }

      logToTopic(ros, 'info', `SDO write OK ${joint} (slave ${slavePosition}) value=${value}`);
      progress += serviceWeight;
      emit({ phase: 'service_done', mode, joint, slavePosition, progress });
    }
    return true;
  };

  const runModeChange = async () => {
    emit({ phase: 'mode_start', mode, target: target.changeMode, progress });
    try {
      // /change_mode is a fire-and-forget String publish. We publish and
      // treat it as done; MODE_TIMEOUT_MS is the defensive ceiling so this
      // step can never hang the sequence (e.g. if a publisher stalls).
      await withTimeout(
        Promise.resolve().then(() => ros.publishChangeMode(target.changeMode)),
        MODE_TIMEOUT_MS,
        'change_mode publish'
      );
    } catch (err) {
      failMessage = `change_mode failed: ${err.message}`;
      logToTopic(ros, 'error', `change_mode=${target.changeMode} FAILED: ${err.message}`);
      emit({ phase: 'error', failed: true, mode, progress, message: failMessage });
      return false;
    }
    logToTopic(ros, 'info', `change_mode=${target.changeMode} published`);
    progress += modeWeight;
    emit({ phase: 'mode_done', mode, target: target.changeMode, progress });
    return true;
  };

  let ok;
  if (doModeChange && target.changeMode === '9') {
    // → JOG : overspeed FIRST, then mode change
    ok = await runServices();
    if (ok) ok = await runModeChange();
  } else if (doModeChange && target.changeMode === '8') {
    // JOG → AUTO/SAFEAUTO : mode change FIRST, then overspeed
    ok = await runModeChange();
    if (ok) ok = await runServices();
  } else {
    // AUTO <-> SAFEAUTO : no mode change, services only
    ok = await runServices();
  }

  if (ok) {
    logToTopic(ros, 'info', `COMPLETE -> ${mode} (100%)`);
    emit({ phase: 'complete', mode, progress: 100 });
    return { ok: true, mode };
  }
  logToTopic(ros, 'error', `ABORTED -> ${mode} at ${Math.round(progress)}%`);
  return { ok: false, mode, message: failMessage || `Mode switch aborted at ${Math.round(progress)}%` };
}

// Public wrapper the WS layer calls. It resolves whether a mode change is
// required from the caller-provided `fromMode` (the previously-selected UI mode).
export async function switchMode({ ros, mode, fromMode, onProgress }) {
  const target = MODE_MAP[mode];
  const source = MODE_MAP[fromMode];
  const withModeChange = !source || source.changeMode !== target?.changeMode;

  const emit = (evt) => { try { onProgress?.(evt); } catch (_) {} };

  if (!target) {
    emit({ phase: 'error', failed: true, message: `Unknown mode '${mode}'` });
    return { ok: false, mode, message: `Unknown mode '${mode}'` };
  }

  let cfg;
  try {
    cfg = loadOverspeedConfig();
  } catch (err) {
    emit({ phase: 'error', failed: true, message: err.message });
    return { ok: false, mode, message: err.message };
  }

  return runSequence({
    ros,
    mode,
    target,
    index: cfg.index,
    subindex: cfg.subindex,
    type: cfg.type,
    profile: cfg[target.profile],
    emit,
    withModeChange,
  });
}

/**
 * Run ONLY the six overspeed SDO writes for a mode's profile — no change_mode.
 * Unlike switchMode, this does NOT short-circuit on the first failure: it
 * attempts all six joints and reports which (if any) failed, so callers that
 * want "continue anyway" semantics (e.g. HOME) can proceed.
 *
 * @param {object}   opts.ros
 * @param {string}   opts.mode        'auto' | 'safeauto' | 'jog' (profile source)
 * @param {function} [opts.onProgress]
 * @returns {Promise<{ok:boolean, failed:string[], message:string}>}
 */
export async function applyOverspeedOnly({ ros, mode, onProgress }) {
  const emit = (evt) => { try { onProgress?.(evt); } catch (_) {} };
  const target = MODE_MAP[mode];
  if (!target) {
    return { ok: false, failed: JOINTS.slice(), message: `Unknown mode '${mode}'` };
  }

  let cfg;
  try {
    cfg = loadOverspeedConfig();
  } catch (err) {
    logToTopic(ros, 'error', `overspeed-only: config load failed: ${err.message}`);
    return { ok: false, failed: JOINTS.slice(), message: err.message };
  }

  const { index, subindex, type } = cfg;
  const profile = cfg[target.profile];
  const perStep = 100 / JOINTS.length;

  logToTopic(ros, 'info', `OVERSPEED-ONLY -> ${mode} (${target.profile}) writing 6 joints`);

  const failed = [];
  let progress = 0;

  for (let i = 0; i < JOINTS.length; i++) {
    const joint = JOINTS[i];
    const slavePosition = i;
    const value = profile[joint];

    emit({ phase: 'service_start', mode, joint, slavePosition, value, progress });

    const res = await ros.setSdo({
      masterId: 0,
      slavePosition,
      sdoIndex: index,
      sdoSubindex: subindex,
      sdoDataType: type,
      sdoValue: String(value),
      timeoutMs: SDO_TIMEOUT_MS,
    });

    if (!res?.success) {
      failed.push(joint);
      logToTopic(ros, 'error',
        `overspeed-only: FAILED ${joint} (slave ${slavePosition}) value=${value}: ${res?.message || 'no message'}`);
      // continue anyway — do NOT return early
    } else {
      logToTopic(ros, 'info', `overspeed-only: OK ${joint} (slave ${slavePosition}) value=${value}`);
    }

    progress += perStep;
    emit({ phase: 'service_done', mode, joint, slavePosition, progress, failed: !res?.success });
  }

  const ok = failed.length === 0;
  logToTopic(ros, ok ? 'info' : 'warn',
    `overspeed-only -> ${mode} ${ok ? 'ALL OK' : `FAILED on ${failed.join(',')}`}`);

  return {
    ok,
    failed,
    message: ok ? 'all overspeed writes ok' : `overspeed failed on ${failed.join(', ')}`,
  };
}