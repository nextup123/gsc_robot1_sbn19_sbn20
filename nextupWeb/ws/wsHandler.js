// backend/ws/wsHandler.js

import { switchMode, detectCurrentMode, applyOverspeedOnly } from "../ros/modeOverspeed.js";

// Prevents overlapping mode switches: a second SWITCH_MODE that arrives
// while one is still running is rejected rather than interleaving SDO
// writes / change_mode publishes.
let modeSwitchInFlight = false;

// The reset state machine (params, driver reset, mode → jog/9) takes up to
// 2.5s after /reset_fault is published. Overspeed is written after this.
const RESET_SETTLE_MS = 2500;

function createWSHandler({ ros, wsServer }) {
  return async function handleMessage(msg, ws) {

    if (!msg || typeof msg.type !== "string") {
      console.warn("Invalid WS message:", msg);
      return;
    }

    try {
      switch (msg.type) {

        // ── Motion / Servo ─────────────────────────────────────────
        case "MOVE_FORWARD":
          ros?.publishMove?.(msg.payload);
          break;

        case "START_SERVO": {
          const result = await ros.startServo();
          wsServer.sendTo(ws, {
            type: "SERVO_RESPONSE",
            payload: result,
          });
          break;
        }

        case "GPIO_COMMAND": {
          const { group, channel, value } = msg.payload || {};
          if (!group || typeof channel !== "number" || typeof value !== "boolean") {
            console.warn("Invalid GPIO_COMMAND payload:", msg.payload);
            wsServer.sendTo(ws, {
              type: "ERROR",
              payload: "Invalid GPIO_COMMAND payload",
            });
            break;
          }

          ros?.publishGPIOCommand?.(group, channel, value);
          break;
        }

        case "REQUEST_GPIO_STATE": {
          wsServer.sendTo(ws, {
            type: "GPIO_STATE",
            payload: ros.getLastGpioState(),
          });
          break;
        }

        // ── UI COMMANDS ────────────────────────────────────────────
        case "UI_COMMANDS": {
          const { command, value } = msg.payload || {};

          if (!command) {
            console.warn("UI_COMMANDS missing command");
            break;
          }

          const handlers = {
            // HOME sequence (SafeAuto):
            //   1) write overspeed 500 to all 6 drives FIRST (continue even if
            //      some fail — homing proceeds regardless)
            //   2) publish /change_mode = 8
            //   3) wait for mode-8 feedback from /nextup_joint_states, or fall
            //      back to a 3s timer
            //   3b) settle before home: 500ms if a 9→8 transition was confirmed,
            //      ~2s if the drive was already at 8 (no feedback signal),
            //      0ms if the 3s feedback timeout already elapsed
            //   4) publish home on /ui_commands
            home: async () => {
              if (modeSwitchInFlight) {
                wsServer.sendTo(ws, {
                  type: "ACTION_RESULT",
                  payload: { action: "home", ok: false, message: "Busy: a mode switch is in progress" },
                });
                return;
              }
              modeSwitchInFlight = true;
              try {
                // 1) Overspeed writes first (SafeAuto = 500), continue-anyway.
                const ov = await applyOverspeedOnly({
                  ros, mode: "safeauto",
                  onProgress: (evt) => wsServer.sendTo(ws, { type: "MODE_SWITCH_PROGRESS", payload: evt }),
                });
                if (!ov.ok) {
                  ros?.publishLogMessage?.(`WARN | home | overspeed incomplete (${ov.message}); continuing`);
                }

                // 2) Change to drive mode 8. Capture the mode we're coming FROM
                //    so we know whether the feedback wait will cost real time.
                const priorMode = ros.lastDriveMode;   // 8, 9, or null
                ros.publishChangeMode("8");
                ros?.publishLogMessage?.(`INFO | home | change_mode=8 published (from mode ${priorMode ?? "unknown"})`);

                // 3) Confirm mode 8 via feedback, else fall back to 3s.
                //    Time the wait: if the drive was ALREADY at 8,
                //    waitForDriveMode returns instantly and consumes no
                //    settle time at all.
                const waitStart = Date.now();
                const confirmed = await ros.waitForDriveMode(8, 3000);
                const waited = Date.now() - waitStart;

                ros?.publishLogMessage?.(
                  confirmed
                    ? `INFO | home | mode 8 confirmed by feedback after ${waited}ms`
                    : `WARN | home | mode 8 not confirmed in ${waited}ms; proceeding on timer`
                );

                // 3b) Settle gap between change_mode and home.
                //     A confirmed transition proves the drive reached mode 8,
                //     so it only needs a short guard. An "already at 8" drive
                //     gives us no confirmation signal at all (waitForDriveMode
                //     fast-paths instantly), so it needs the full blind wait.
                //       was 9, confirmed  -> 500ms guard
                //       already at 8      -> 2000ms blind settle
                //       not confirmed     -> 0ms (the 3s timeout already elapsed)
                const BLIND_SETTLE_MS = 2000;   // no feedback to rely on
                const CONFIRMED_GUARD_MS = 500; // feedback says we're in mode 8

                let settleMs;
                if (!confirmed) {
                  settleMs = 0;                    // 3s timeout already elapsed
                } else if (priorMode === 9) {
                  settleMs = CONFIRMED_GUARD_MS;   // real 9→8 transition, confirmed
                } else {
                  // Already at 8: waitForDriveMode returned instantly, so no
                  // settle time has been consumed. Wait out the full budget.
                  settleMs = Math.max(0, BLIND_SETTLE_MS - waited);
                }

                if (settleMs > 0) {
                  ros?.publishLogMessage?.(`INFO | home | settling ${settleMs}ms before home`);
                  await sleep(settleMs);
                }

                // 4) Publish home — awaited above, so the gap is real and the
                //    lock below is not released early.
                ros.publishUiCommand("home");
                ros?.publishLogMessage?.("INFO | home | home command published");

                // Reflect SafeAuto in the UI (threshold-only change; edge
                // detector won't fire since drive mode stayed 8).
                ros?.broadcastModeState?.("safeauto");

                wsServer.sendTo(ws, {
                  type: "ACTION_RESULT",
                  payload: {
                    action: "home",
                    ok: true,
                    overspeedOk: ov.ok,
                    modeConfirmed: confirmed,
                    settleMs,
                    message: ov.ok
                      ? (confirmed ? "Homing started (SafeAuto)" : "Homing started (SafeAuto, mode unconfirmed)")
                      : `Homing started; overspeed incomplete: ${ov.message}`,
                  },
                });
              } finally {
                modeSwitchInFlight = false;
              }
            },

            // START-BT must run at Auto (max speed): set overspeed thresholds
            // (6000) AND drive mode 8 FIRST, THEN start the BT. The BT is
            // published regardless of whether the mode/overspeed writes all
            // succeeded — but only AFTER the sequence has run to completion.
            start_bt: async () => {
              if (modeSwitchInFlight) {
                wsServer.sendTo(ws, {
                  type: "ACTION_RESULT",
                  payload: { action: "start_bt", ok: false, message: "Busy: a mode switch is in progress" },
                });
                return;
              }
              modeSwitchInFlight = true;
              try {
                const res = await switchMode({
                  ros, mode: "auto", fromMode: undefined,
                  onProgress: (evt) => wsServer.sendTo(ws, { type: "MODE_SWITCH_PROGRESS", payload: evt }),
                });

                if (res.ok) {
                  ros?.publishLogMessage?.("INFO | start_bt | Auto set OK");
                } else {
                  // Log the failure but proceed — the BT must still start.
                  ros?.publishLogMessage?.(`WARN | start_bt | Auto switch did not fully succeed (${res.message || "unknown"}); starting BT anyway`);
                }

                // Always publish the BT start, only after the sequence above.
                setTimeout(() => {
                  ros.publishBoolTopic("/control_start_bt", true);
                  ros?.publishLogMessage?.("INFO | start_bt | control_start_bt published");

                }, 2500);

                // Reflect the intended mode in the UI (best-effort).
                ros?.broadcastModeState?.("auto");

                wsServer.sendTo(ws, {
                  type: "ACTION_RESULT",
                  payload: {
                    action: "start_bt",
                    ok: true,               // BT was started
                    modeOk: res.ok,         // whether the Auto switch fully succeeded
                    message: res.ok
                      ? "BT started (Auto)"
                      : `BT started; Auto switch incomplete: ${res.message || "unknown"}`,
                  },
                });
              } finally {
                modeSwitchInFlight = false;
              }
            },

            change_mode: () =>
              ros.publishStringTopic("/change_mode", String(value)),

            control_start_bt: () =>
              ros.publishBoolTopic("/control_start_bt", Boolean(value)),

            control_reset_bt: () =>
              ros.publishBoolTopic("/control_reset_bt", Boolean(value)),
            control_exit_bt: () =>
              ros.publishBoolTopic("/control_exit_bt", Boolean(value)),

            process_control: () =>
              ros.publishProcessControl(String(value)),

            set_speed: () =>
              ros.publishSpeedScale(parseFloat(value)),

            select_cnc: () =>
              ros.publishCNCSelection(String(value)),
          };

          if (handlers[command]) {
            await handlers[command]();
          } else {
            // fallback
            ros?.publishUiCommand?.(command);
          }

          break;
        }

        case "CHANGE_MODE": {
          const { mode } = msg.payload || {};
          if (!mode || !["8", "9"].includes(mode)) {
            console.warn("Invalid mode:", mode);
            break;
          }
          ros?.publishChangeMode(mode);   // ✅ clean call (legacy, no overspeed)
          break;
        }

        // ── 3-mode switch (SafeAuto / Jog / Auto) with overspeed SDO writes ──
        case "SWITCH_MODE": {
          const { mode, fromMode } = msg.payload || {};
          const valid = ["auto", "safeauto", "jog"];
          if (!valid.includes(mode)) {
            wsServer.sendTo(ws, {
              type: "MODE_SWITCH_PROGRESS",
              payload: { phase: "error", failed: true, message: `Invalid mode '${mode}'`, progress: 0 },
            });
            break;
          }

          if (modeSwitchInFlight) {
            wsServer.sendTo(ws, {
              type: "MODE_SWITCH_RESULT",
              payload: { ok: false, mode, message: "A mode switch is already in progress" },
            });
            break;
          }

          modeSwitchInFlight = true;

          // Stream each progress event straight to the requesting client.
          const onProgress = (evt) => {
            wsServer.sendTo(ws, { type: "MODE_SWITCH_PROGRESS", payload: evt });
          };

          try {
            const result = await switchMode({ ros, mode, fromMode, onProgress });
            if (result.ok) {
              // Keep backend mode state authoritative + sync any other pages,
              // including threshold-only 8→8 switches the edge detector misses.
              ros?.broadcastModeState?.(result.mode);
            }
            wsServer.sendTo(ws, {
              type: "MODE_SWITCH_RESULT",
              payload: {
                ok: result.ok,
                mode: result.mode,
                message: result.message || (result.ok ? "Mode applied" : "Mode switch failed"),
              },
            });
          } catch (err) {
            wsServer.sendTo(ws, {
              type: "MODE_SWITCH_RESULT",
              payload: { ok: false, mode, message: `Mode switch error: ${err.message}` },
            });
          } finally {
            modeSwitchInFlight = false;
          }
          break;
        }

        // ── Detect the ACTUAL current mode on load (reads joint1 threshold) ──
        case "DETECT_MODE": {
          const driveMode = msg.payload?.driveMode; // optional 8/9 hint from joint_states
          const result = await detectCurrentMode({ ros, driveMode });
          wsServer.sendTo(ws, {
            type: "DETECT_MODE_RESULT",
            payload: result, // { mode, threshold, source }
          });
          break;
        }

        // ── Motion pipeline ────────────────────────────────────────
        case "MOTION_COMMAND":
          ros?.publishMotionCommand?.(msg.payload?.command);
          break;

        case "START_MOTION":
          ros?.publishMotionStart?.(true);
          break;

        case "AUTO_GENERATE_XML":
          ros?.publishAutoGenerateXML?.(msg.payload?.data);
          break;

        case "AUTO_GENERATE_SEQUENCE":
          ros?.publishAutoGenerateSequence?.(msg.payload?.data);
          break;

        case "LOG_MESSAGE":
          ros?.publishLogMessage?.(msg.payload?.data);
          break;

        // ── DIGITAL OUTPUT ─────────────────────────────────────────
        case "TOGGLE_DO": {
          const { driver, doId, state } = msg.payload || {};

          if (
            typeof driver !== "number" ||
            typeof doId !== "number" ||
            typeof state !== "boolean"
          ) {
            console.warn("Invalid DO payload:", msg.payload);
            wsServer.sendTo(ws, {
              type: "ERROR",
              payload: "Invalid DO payload",
            });
            break;
          }

          ros?.publishDO?.(driver, doId, state);
          break;
        }

        // ── SAFETY ─────────────────────────────────────────────────
        case "EMERGENCY_TRIGGER":
          ros?.triggerEmergency?.();
          break;

        // RESET sequence:
        //   1) resetFault() — triggers emergency, publishes /reset_fault at +1.5s
        //   2) the reset state machine (params, driver reset, mode → jog/9)
        //      takes up to 2.5s after /reset_fault
        //   3) once settled, write the jog overspeed profile (350) to all 6
        //      drives — reset lands the robot in mode 9
        case "RESET_FAULT": {
          if (modeSwitchInFlight) {
            wsServer.sendTo(ws, {
              type: "ACTION_RESULT",
              payload: { action: "reset", ok: false, message: "Busy: a mode switch is in progress" },
            });
            break;
          }
          modeSwitchInFlight = true;
          try {
            // 1) + 2) await the /reset_fault publish, then let the reset state
            //    machine finish (fixed 2.5s ceiling).
            await ros?.resetFault?.();
            ros?.publishLogMessage?.("INFO | reset | /reset_fault published; waiting 2500ms for reset to settle");
            await sleep(RESET_SETTLE_MS);

            // 3) Reset ends in mode 9 → write the jog overspeed profile.
            const ov = await applyOverspeedOnly({
              ros, mode: "jog",
              onProgress: (evt) => wsServer.sendTo(ws, { type: "MODE_SWITCH_PROGRESS", payload: evt }),
            });
            ros?.publishLogMessage?.(
              ov.ok
                ? "INFO | reset | jog overspeed applied after reset"
                : `WARN | reset | jog overspeed incomplete: ${ov.message}`
            );

            // Reset leaves the drive in mode 9 — reflect Jog in the UI.
            ros?.broadcastModeState?.("jog");

            wsServer.sendTo(ws, {
              type: "ACTION_RESULT",
              payload: {
                action: "reset",
                ok: true,
                overspeedOk: ov.ok,
                message: ov.ok
                  ? "Reset complete (Jog)"
                  : `Reset complete; overspeed incomplete: ${ov.message}`,
              },
            });
          } finally {
            modeSwitchInFlight = false;
          }
          break;
        }

        case "MONITORING_START": {
          const result = await ros.callMonitoringStart();
          wsServer.sendTo(ws, {
            type: "MONITORING_RESPONSE",
            payload: { action: "start", success: result?.success || false }
          });
          break;
        }

        case "MONITORING_STOP": {
          const result = await ros.callMonitoringStop();
          wsServer.sendTo(ws, {
            type: "MONITORING_RESPONSE",
            payload: { action: "stop", success: result?.success || false }
          });
          break;
        }

        case "SET_SPEED_INT8": {
          const { value } = msg.payload || {};
          if (typeof value !== "number" || value < 0 || value > 100) {
            console.warn("Invalid SET_SPEED_INT8 payload:", msg.payload);
            break;
          }
          ros?.publishSpeedScaleInt8?.(value);
          break;
        }

        // ── SERVO JOG (UPDATED FOR LIGHTWEIGHT BRIDGE) ────
        case "SERVO_JOG": {
          const { mode } = msg.payload || {};

          if (mode === "joint") {
            // Joint mode: pass data array directly
            ros?.publishServoJoint?.(msg.payload.data);
          } else if (mode === "twist") {
            // Twist mode: pass linear and angular objects separately
            // The lightweight bridge handles frame_id internally
            ros?.publishServoTwist?.(
              msg.payload.linear,
              msg.payload.angular
            );
          } else {
            console.warn("SERVO_JOG: unknown mode", mode);
          }
          break;
        }

        // ── SERVO FRAME MANAGEMENT ──────────────────────────────────
        case "SET_SERVO_FRAME": {
          const { frame } = msg.payload || {};
          if (!frame) {
            console.warn("SET_SERVO_FRAME missing frame");
            break;
          }

          ros.setCurrentFrame(frame);   // persists + updates variable

          wsServer.broadcast({
            type: "SERVO_FRAME_CHANGED",
            payload: { frame }
          });
          break;
        }

        case "GET_SERVO_FRAME": {
          const frame = ros.getCurrentFrame();
          wsServer.sendTo(ws, {
            type: "SERVO_FRAME_CHANGED",
            payload: { frame },
          });
          break;
        }

        case "GET_ROSBRIDGE_STATUS": {
          wsServer.sendTo(ws, {
            type: "ROSBRIDGE_STATUS",
            payload: ros.getRosbridgeStatus(),
          });
          break;
        }
        case "TOGGLE_ROSBRIDGE": {
          const { start } = msg.payload || {};
          ros?.publishRosbridgeControl?.(start ? "start" : "stop");
          break;
        }
        // ── HEARTBEAT ──────────────────────────────────────────────
        case "PING":
          wsServer.sendTo(ws, {
            type: "PONG",
            payload: "alive",
            timestamp: Date.now(),
          });
          break;

        default:
          console.warn("Unknown WS message:", msg.type);
      }

    } catch (err) {
      console.error("WS handler error:", err);

      wsServer.sendTo(ws, {
        type: "ERROR",
        payload: err.message || "Internal server error",
      });
    }
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export { createWSHandler };