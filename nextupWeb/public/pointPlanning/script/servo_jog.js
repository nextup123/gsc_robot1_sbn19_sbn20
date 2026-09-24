// =============================================================================
// servo_jog.js  –  public/script/servo_jog.js
//
// Routes servo jog through postMessage → wsHandler → rosService.
// frame_id is owned entirely by the backend — the client never sends it
// inside twist messages, only when explicitly switching the frame.
// =============================================================================
let decelTimer = null;

const ServoJog = (() => {

  // Velocity state
  let jointVelCmd = 0.0;
  let twistVelCmd = 0.2;

  let maxJointVel = 0.2;
  let maxTwistVel = 0.2;
  const accelTime = 2.5;
  const decelTime = 0.5;    // Deceleration time in seconds (much faster)


  const INTERVAL_MS = 30;
  const jointAccel = () => maxJointVel * (INTERVAL_MS / 1000) / accelTime;
  const jointDecel = () => maxJointVel * (INTERVAL_MS / 1000) / decelTime;

  const twistAccel = () => maxTwistVel * (INTERVAL_MS / 1000) / accelTime;
  const twistDecel = () => maxTwistVel * (INTERVAL_MS / 1000) / decelTime;


  let activeControl = null;
  let controlInterval = null;

  // ─── send to parent (wsHandler) ────────────────────────────────────────────

  function send(type, payload) {
    window.parent.postMessage({ type, payload }, "*");
  }

  // ─── publish ───────────────────────────────────────────────────────────────

  function publishJoint(axis, sign) {
    jointVelCmd = Math.min(maxJointVel, jointVelCmd + jointAccel());
    const data = [0, 0, 0, 0, 0, 0];
    data[axis] = jointVelCmd * sign;
    send("SERVO_JOG", { mode: "joint", data });
  }

  function publishTwist(axis, sign, angular = false) {
    twistVelCmd = Math.min(maxTwistVel, twistVelCmd + twistAccel());

    const linear = { x: 0, y: 0, z: 0 };
    const angularV = { x: 0, y: 0, z: 0 };

    if (!angular) {
      if (axis === 0) linear.x = twistVelCmd * sign;
      if (axis === 1) linear.y = twistVelCmd * sign;
      if (axis === 2) linear.z = twistVelCmd * sign;
    } else {
      if (axis === 0) angularV.x = twistVelCmd * sign;
      if (axis === 1) angularV.y = twistVelCmd * sign;
      if (axis === 2) angularV.z = twistVelCmd * sign;
    }

    // No frame_id here — backend stamps it from its own currentFrame variable
    send("SERVO_JOG", { mode: "twist", linear, angular: angularV });
  }

  // ─── deceleration ──────────────────────────────────────────────────────────

  function decelerateJoint(axis, sign) {
    clearInterval(decelTimer);
    decelTimer = setInterval(() => {
      jointVelCmd = Math.max(0, jointVelCmd - jointDecel());  // Changed here
      const data = [0, 0, 0, 0, 0, 0];
      data[axis] = jointVelCmd * sign;
      send("SERVO_JOG", { mode: "joint", data });
      if (jointVelCmd <= 0) { clearInterval(decelTimer); decelTimer = null; }
    }, INTERVAL_MS);
  }

  function decelerateTwist(axis, sign, angular = false) {
    clearInterval(decelTimer);
    decelTimer = setInterval(() => {
      twistVelCmd = Math.max(0, twistVelCmd - twistDecel());  // Changed here

      const linear = { x: 0, y: 0, z: 0 };
      const angularV = { x: 0, y: 0, z: 0 };

      if (!angular) {
        if (axis === 0) linear.x = twistVelCmd * sign;
        if (axis === 1) linear.y = twistVelCmd * sign;
        if (axis === 2) linear.z = twistVelCmd * sign;
      } else {
        if (axis === 0) angularV.x = twistVelCmd * sign;
        if (axis === 1) angularV.y = twistVelCmd * sign;
        if (axis === 2) angularV.z = twistVelCmd * sign;
      }

      send("SERVO_JOG", { mode: "twist", linear, angular: angularV });
      if (twistVelCmd <= 0) { clearInterval(decelTimer); decelTimer = null; }
    }, INTERVAL_MS);
  }

  // ─── control lifecycle ─────────────────────────────────────────────────────

  function startControl(type, axis, sign, angular = false) {
    stopControl();
    clearInterval(decelTimer);   // ← ADD: cancel any in-progress decel
    decelTimer = null;
    activeControl = { type, axis, sign, angular };
    controlInterval = setInterval(() => {
      if (type === "joint") publishJoint(axis, sign);
      if (type === "twist") publishTwist(axis, sign, angular);
    }, INTERVAL_MS);
  }

  function stopControl() {
    clearInterval(controlInterval);
    if (!activeControl) return;

    if (activeControl.type === "joint") {
      decelerateJoint(activeControl.axis, activeControl.sign);
    } else {
      decelerateTwist(activeControl.axis, activeControl.sign, activeControl.angular);
    }

    activeControl = null;
    // jointVelCmd = 0;
    // twistVelCmd = 0;
  }

  // ─── frame ─────────────────────────────────────────────────────────────────

  function setFrame(frame) {
    send("SET_SERVO_FRAME", { frame });
    _applyFrameUI(frame);   // optimistic local update
  }

  function _applyFrameUI(frame) {
    const map = {
      btnEnd: "end",
      btnBase: "base_link",
      btnExt: "external_link",
    };
    Object.entries(map).forEach(([id, f]) => {
      const btn = document.getElementById(id);
      if (btn) btn.classList.toggle("active", f === frame);
    });

    // Update the active frame display
    const display = document.getElementById("currentFrameDisplay");
    if (display) display.textContent = frame || "—";

    // Update the new frame dropdown if present
    if (typeof updateFrameDropdownActive === "function") {
      updateFrameDropdownActive(frame);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 🆕 FRAME MESSAGE HANDLERS (updated to handle both CHANGED and LOADED)
  // ════════════════════════════════════════════════════════════════════════════
  window.addEventListener("message", (event) => {
    const msg = event.data;
    
    // ✅ When backend publishes frame change (real-time ROS event)
    if (msg?.type === "SERVO_FRAME_CHANGED") {
      console.log("🔄 Servo frame changed from backend:", msg.payload.frame);
      _applyFrameUI(msg.payload.frame);
    }
    
    // 🆕 When frame is loaded from file on page refresh
    if (msg?.type === "SERVO_FRAME_LOADED") {
      console.log("📂 Servo frame loaded from file:", msg.payload.frame);
      _applyFrameUI(msg.payload.frame);
    }
  });

  // ─── bind buttons ──────────────────────────────────────────────────────────

  const BUTTON_MAP = [
    ["j1", "joint", 0, false],
    ["j2", "joint", 1, false],
    ["j3", "joint", 2, false],
    ["j4", "joint", 3, false],
    ["j5", "joint", 4, false],
    ["j6", "joint", 5, false],
    ["cx", "twist", 0, false],
    ["cy", "twist", 1, false],
    ["cz", "twist", 2, false],
    ["cr", "twist", 0, true],
    ["cp", "twist", 1, true],
    ["cw", "twist", 2, true],
  ];

  function bindButtons() {
    BUTTON_MAP.forEach(([prefix, type, axis, angular]) => {
      const plus = document.getElementById(`${prefix}_plus`);
      const minus = document.getElementById(`${prefix}_minus`);
      if (!plus || !minus) return;

      // Clone to wipe any old listeners from the previous jog system
      const p = plus.cloneNode(true);
      const m = minus.cloneNode(true);
      plus.replaceWith(p);
      minus.replaceWith(m);

      p.addEventListener("pointerdown", (e) => { if (e.button === 0) startControl(type, axis, 1, angular); });
      m.addEventListener("pointerdown", (e) => { if (e.button === 0) startControl(type, axis, -1, angular); });

      ["pointerup", "pointercancel", "pointerleave"].forEach(evt => {
        p.addEventListener(evt, stopControl);
        m.addEventListener(evt, stopControl);
      });
    });
  }

  // ─── safety ────────────────────────────────────────────────────────────────

  window.addEventListener("blur", stopControl);
  window.addEventListener("contextmenu", (e) => { e.preventDefault(); stopControl(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopControl(); });

  // ─── public ────────────────────────────────────────────────────────────────

  return {
    init: bindButtons,
    setFrame,
    stopControl,
    setMaxJointVel: (v) => { maxJointVel = v; },
    setMaxTwistVel: (v) => { maxTwistVel = v; },
  };

})();

// ─── auto-init ─────────────────────────────────────────────────────────────
//
// DORMANT MODE: ServoJog.init() (and frame-button binding) is disabled below.
// This file is kept intact but inert so the old discrete "+j1"/"-j1"
// UI_COMMANDS jog path in pointPlanning.js (sent straight to /ui_commands)
// is what actually drives the jog buttons, instead of this module's
// velocity-ramped SERVO_JOG twist/joint messages.
//
// To re-enable this module, flip SERVO_JOG_ENABLED to true.

const SERVO_JOG_ENABLED = false;

document.addEventListener("DOMContentLoaded", () => {
  // ════════════════════════════════════════════════════════════════════════════
  // 🆕 CRITICAL: Request saved frame EVEN IF servo jog is disabled!
  // ════════════════════════════════════════════════════════════════════════════
  // This ensures the frame persists across page refreshes regardless of
  // whether the full ServoJog module is initialized.
  
  console.log("📡 servo_jog.js loaded - requesting saved frame...");
  window.parent.postMessage({ type: "GET_SERVO_FRAME", payload: {} }, "*");
  
  // ════════════════════════════════════════════════════════════════════════════
  
  if (!SERVO_JOG_ENABLED) {
    console.log("⏸️  ServoJog module disabled (SERVO_JOG_ENABLED = false)");
    return;
  }

  console.log("✅ Initializing ServoJog module...");
  ServoJog.init();

  document.getElementById("btnEnd")?.addEventListener("click", () => ServoJog.setFrame("end"));
  document.getElementById("btnBase")?.addEventListener("click", () => ServoJog.setFrame("base_link"));
  document.getElementById("btnExt")?.addEventListener("click", () => ServoJog.setFrame("external_link"));
});