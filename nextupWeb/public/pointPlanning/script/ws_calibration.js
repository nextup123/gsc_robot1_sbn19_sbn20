// public/pointPlanning/script/ws_calibration.js
// =============================================================================
// Workspace Calibration UI
//
// Talks to the /ws-calibration/* REST API. Reads live robot state from the same
// globals script.js already maintains from the JOINT_STATES / CARTESIAN_VALUES
// postMessages: `latestPositions` (joint radians) and `latestCartesianValues`
// ([x,y,z,r,p,w], cm + deg). Capture maps r/p/w -> roll/pitch/yaw to match the
// calibration.yaml schema.
//
// Cycle rules:
//   • Points are set serially: point(N) is only settable once point(N-1) is set.
//   • A set point stays editable/re-settable at any time.
//   • Start Calibration enables only when all 4 are set AND the user has
//     re-confirmed at least one point in this session (re-calibrate gate).
//   • Start -> publishes frame name; after 1s, Go to Frame Origin enables.
//   • Go to Frame Origin -> publishes frame name; Finish enables.
//   • Finish -> publishes true. Popup is left as-is afterwards.
// =============================================================================

const WSC_API = "http://localhost:3000/ws-calibration";
const WSC_SLOTS = ["point1", "point2", "point3", "point4"];

// In-memory mirror of calibration.yaml: { frameName: { point1:{...}, ... } }
let wscData = {};
let wscActiveFrame = null;

// Per-session gate: did the user (re)set at least one point since opening this
// frame? Required before Start is allowed, even when all 4 already exist.
let wscConfirmedThisSession = false;

// Phase machine for the three gating buttons:
//   idle | started | started-ready | origin | finished
let wscPhase = "idle";

// ── helpers ───────────────────────────────────────────────────────────────────
function wscEl(id) {
  return document.getElementById(id);
}

// Reuse the page toast if present; fall back to console.
function wscToast(msg, type = "success", t = 2000) {
  if (typeof showStatus === "function") showStatus(msg, type, t);
  else console.log(`[wsc:${type}]`, msg);
}

// Read live joint values (radians) — same source as the point editor.
function wscLiveJoints() {
  const p = typeof latestPositions !== "undefined" ? latestPositions : [];
  return {
    joint1: Number(p[0] || 0),
    joint2: Number(p[1] || 0),
    joint3: Number(p[2] || 0),
    joint4: Number(p[3] || 0),
    joint5: Number(p[4] || 0),
    joint6: Number(p[5] || 0),
  };
}

// Read live cartesian values; map r/p/w -> roll/pitch/yaw for the calib schema.
function wscLiveCoords() {
  const c = typeof latestCartesianValues !== "undefined" ? latestCartesianValues : [];
  return {
    x: Number(c[0] || 0),
    y: Number(c[1] || 0),
    z: Number(c[2] || 0),
    roll: Number(c[3] || 0),
    pitch: Number(c[4] || 0),
    yaw: Number(c[5] || 0),
  };
}

// Index of the first unset slot for the active frame (-1 when all set).
function wscFirstUnsetIndex() {
  const frame = wscData[wscActiveFrame] || {};
  return WSC_SLOTS.findIndex((s) => !frame[s]);
}

function wscSetCount() {
  const frame = wscData[wscActiveFrame] || {};
  return WSC_SLOTS.filter((s) => frame[s]).length;
}

function wscIsComplete() {
  return wscSetCount() === WSC_SLOTS.length;
}

// ── open / close ──────────────────────────────────────────────────────────────
async function openWsCalibration() {
  wscEl("wsCalibModal").style.display = "flex";
  await wscReload();
}

function closeWsCalibration() {
  wscEl("wsCalibModal").style.display = "none";
  setTimeout(async () => {
    await loadPoints();
  }, 1000);
}

// Close on backdrop click
document.addEventListener("DOMContentLoaded", () => {
  const modal = wscEl("wsCalibModal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeWsCalibration();
    });
  }
});

// ── data load ─────────────────────────────────────────────────────────────────
async function wscReload() {
  try {
    const res = await fetch(`${WSC_API}/getCalibration`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    wscData = (await res.json()) || {};
  } catch (err) {
    wscData = {};
    wscToast(`Failed to load calibration: ${err.message}`, "error", 2500);
  }
  wscRenderFrames();

  // Keep the active frame if it still exists, else clear the detail pane.
  if (wscActiveFrame && wscData[wscActiveFrame]) {
    wscRenderDetail();
  } else {
    wscActiveFrame = null;
    wscShowDetailEmpty(true);
  }
}

// ── frame list ────────────────────────────────────────────────────────────────
function wscRenderFrames() {
  const list = wscEl("wscFrameList");
  const names = Object.keys(wscData);

  if (names.length === 0) {
    list.innerHTML = `<div class="wsc-empty"><i class="fas fa-inbox"></i><span>No frames</span></div>`;
    return;
  }

  list.innerHTML = names
    .map((name) => {
      const count = WSC_SLOTS.filter((s) => wscData[name] && wscData[name][s]).length;
      const complete = count === WSC_SLOTS.length;
      const active = name === wscActiveFrame ? " wsc-frame-active" : "";
      return `
        <div class="wsc-frame-item${active}" data-frame="${name}" onclick="wscSelectFrame('${name}')">
          <div class="wsc-frame-main">
            <i class="fas fa-crosshairs"></i>
            <span class="wsc-frame-name">${name}</span>
          </div>
          <div class="wsc-frame-meta">
            <span class="wsc-frame-count ${complete ? "wsc-complete" : ""}">${count}/4</span>
            <button class="wsc-icon-btn wsc-del-frame" title="Delete frame"
              onclick="event.stopPropagation(); wscPromptDeleteFrame('${name}')">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>`;
    })
    .join("");
}

function wscSelectFrame(name) {
  wscActiveFrame = name;
  wscConfirmedThisSession = false; // re-calibrate gate resets per selection
  wscPhase = "idle"; // fresh run starts from a clean gate
  wscRenderFrames();
  wscRenderDetail();
}

// ── add / delete frame ────────────────────────────────────────────────────────
// Inline add-frame form (replaces window.prompt for a consistent in-page UI).
function wscToggleAddFrame(show) {
  const form = wscEl("wscAddFrameForm");
  const input = wscEl("wscAddFrameInput");
  const willShow = show === undefined ? form.style.display === "none" : show;
  form.style.display = willShow ? "block" : "none";
  wscClearAddFrameError();
  if (willShow) {
    input.value = "";
    input.focus();
  }
}

function wscClearAddFrameError() {
  wscEl("wscAddFrameErr").textContent = "";
  wscEl("wscAddFrameInput").classList.remove("wsc-input-error");
}

function wscShowAddFrameError(msg) {
  wscEl("wscAddFrameErr").textContent = msg;
  wscEl("wscAddFrameInput").classList.add("wsc-input-error");
}

function wscAddFrameKeydown(e) {
  if (e.key === "Enter") {
    e.preventDefault();
    wscSubmitAddFrame();
  } else if (e.key === "Escape") {
    e.preventDefault();
    wscToggleAddFrame(false);
  }
}

async function wscSubmitAddFrame() {
  const name = (wscEl("wscAddFrameInput").value || "").trim();
  if (!name) {
    wscShowAddFrameError("Name is required");
    return;
  }
  if (!/^[a-zA-Z0-9-_]+$/.test(name)) {
    wscShowAddFrameError("Only letters, numbers, - and _ allowed");
    return;
  }
  if (Object.prototype.hasOwnProperty.call(wscData, name)) {
    wscShowAddFrameError(`Frame "${name}" already exists`);
    return;
  }
  try {
    const res = await fetch(`${WSC_API}/addFrame`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frame: name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "add failed");
    wscToast(data.message, "success", 1800);
    wscToggleAddFrame(false);
    await wscReload();
    wscSelectFrame(name);
  } catch (err) {
    wscShowAddFrameError(err.message);
  }
}

function wscPromptDeleteFrame(name) {
  // Reuse the page confirm modal if available, else native confirm.
  const doDelete = async () => {
    try {
      const res = await fetch(`${WSC_API}/deleteFrame`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frame: name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "delete failed");
      wscToast(data.message, "success", 1800);
      if (wscActiveFrame === name) wscActiveFrame = null;
      await wscReload();
    } catch (err) {
      wscToast(err.message, "error", 2500);
    }
  };

  if (typeof showConfirmModal === "function") {
    showConfirmModal(`Delete frame "${name}" and all its points?`, doDelete);
  } else if (confirm(`Delete frame "${name}"?`)) {
    doDelete();
  }
}

// ── detail pane ───────────────────────────────────────────────────────────────
function wscShowDetailEmpty(isEmpty) {
  wscEl("wscDetailEmpty").style.display = isEmpty ? "flex" : "none";
  wscEl("wscDetailBody").style.display = isEmpty ? "none" : "block";
}

function wscRenderDetail() {
  if (!wscActiveFrame || !wscData[wscActiveFrame]) {
    wscShowDetailEmpty(true);
    return;
  }
  wscShowDetailEmpty(false);

  wscEl("wscActiveFrameName").textContent = wscActiveFrame;
  const setCount = wscSetCount();
  wscEl("wscProgress").textContent = `${setCount} / 4 points set`;

  const firstUnset = wscFirstUnsetIndex();
  const frame = wscData[wscActiveFrame];

  wscEl("wscPoints").innerHTML = WSC_SLOTS.map((slot, idx) => {
    const pt = frame[slot];
    const isSet = !!pt;
    // Serial enable: a slot is actionable if it's set (re-set/edit) OR it's the
    // first unset slot. Everything past the frontier is locked.
    const locked = !isSet && idx !== firstUnset;

    const label = `Point ${idx + 1}`;
    const btnLabel = isSet ? "Re-set" : "Set";
    const btnIcon = isSet ? "fa-rotate" : "fa-crosshairs";

    let body;
    if (isSet) {
      body = `
        <div class="wsc-pt-vals">
          <span>x ${pt.x.toFixed(2)}</span><span>y ${pt.y.toFixed(2)}</span><span>z ${pt.z.toFixed(2)}</span>
          <span>r ${pt.roll.toFixed(2)}</span><span>p ${pt.pitch.toFixed(2)}</span><span>w ${pt.yaw.toFixed(2)}</span>
        </div>
        <div class="wsc-pt-times">
          <span title="created"><i class="fas fa-plus-circle"></i> ${pt.created}</span>
          <span title="updated"><i class="fas fa-pen"></i> ${pt.updated}</span>
        </div>`;
    } else if (locked) {
      body = `<div class="wsc-pt-hint"><i class="fas fa-lock"></i> Set previous point first</div>`;
    } else {
      body = `<div class="wsc-pt-hint wsc-pt-next"><i class="fas fa-arrow-right"></i> Ready — captures live robot pose</div>`;
    }

    return `
      <div class="wsc-pt-card ${isSet ? "wsc-pt-set" : ""} ${locked ? "wsc-pt-locked" : ""}">
        <div class="wsc-pt-head">
          <div class="wsc-pt-title">
            <span class="wsc-pt-idx">${idx + 1}</span>
            <span>${label}</span>
            ${isSet ? '<span class="wsc-pt-badge"><i class="fas fa-check"></i> set</span>' : ""}
          </div>
          <div class="wsc-pt-actions">
            ${isSet
        ? `<button class="wsc-pt-goto" title="Go to ${label}"
                     onclick="wscGoToPoint('${slot}')">
                     <i class="fas fa-location-arrow"></i>
                   </button>`
        : ""
      }
            <button class="btn ${isSet ? "btn-warning" : "btn-primary"} wsc-pt-btn"
              ${locked ? "disabled" : ""}
              onclick="wscSetPoint('${slot}')">
              <i class="fas ${btnIcon}"></i> ${btnLabel}
            </button>
          </div>
        </div>
        ${body}
      </div>`;
  }).join("");

  wscRefreshActionButtons();
}

// ── set / re-set a point (captures live pose) ─────────────────────────────────
async function wscSetPoint(slot) {
  if (!wscActiveFrame) return;

  // Editing/re-setting any point invalidates an in-progress calibration run.
  wscPhase = "idle";

  const coords = wscLiveCoords();
  const joints = wscLiveJoints();

  // Guard: make sure we actually have live values (arrays populated).
  const allZeroJoints = Object.values(joints).every((v) => v === 0);
  if (allZeroJoints) {
    wscToast("No live joint data yet — is the robot publishing joint states?", "error", 3000);
    return;
  }

  try {
    const res = await fetch(`${WSC_API}/setPoint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frame: wscActiveFrame, slot, ...coords, joints }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "set failed");

    // Update local mirror and mark the session as confirmed.
    if (!wscData[wscActiveFrame]) wscData[wscActiveFrame] = {};
    wscData[wscActiveFrame][slot] = data.point;
    wscConfirmedThisSession = true;

    wscToast(data.message, "success", 1600);
    wscRenderFrames();
    wscRenderDetail();
  } catch (err) {
    wscToast(err.message, "error", 2500);
  }
}

// ── navigate to an already-set point ──────────────────────────────────────────
// Confirms, then publishes "{frame}_{slot}" (e.g. "tf1_point1") on /go_to_tf_point.
function wscGoToPoint(slot) {
  if (!wscActiveFrame) return;
  const frame = wscActiveFrame;
  const target = `${frame}_${slot}`;
  const label = `Point ${slot.replace("point", "")}`;

  const doGo = async () => {
    try {
      const res = await fetch(`${WSC_API}/goToPoint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frame, slot }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "go-to-point failed");
      wscToast(data.message, "success", 2000);
    } catch (err) {
      wscToast(err.message, "error", 2500);
    }
  };

  if (typeof showConfirmModal === "function") {
    showConfirmModal(`Move robot to ${label} of "${frame}" (${target})?`, doGo);
  } else if (confirm(`Move robot to ${target}?`)) {
    doGo();
  }
}

// ── gating buttons ────────────────────────────────────────────────────────────
//
// State machine across the three buttons:
//   startReady  = all 4 set AND confirmed-this-session
//   After Start succeeds -> wscPhase = 'started', enable Origin after 1s
//   After Origin succeeds -> wscPhase = 'origin', enable Finish

function wscRefreshActionButtons() {
  const startBtn = wscEl("wscStartBtn");
  const originBtn = wscEl("wscOriginBtn");
  const finishBtn = wscEl("wscFinishBtn");

  const startReady = wscIsComplete() && wscConfirmedThisSession && wscPhase === "idle";
  startBtn.disabled = !startReady;

  // Origin enables only after Start has fired (1s delay handled in the handler).
  originBtn.disabled = !(wscPhase === "started-ready" || wscPhase === "origin" || wscPhase === "finished");

  // Finish enables after Origin has fired.
  finishBtn.disabled = !(wscPhase === "origin" || wscPhase === "finished");
}


async function wscStartCalibration() {
  if (!wscActiveFrame) return;
  try {
    const res = await fetch(`${WSC_API}/startCalibration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frame: wscActiveFrame }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "start failed");

    wscToast(data.message, "success", 2000);
    wscPhase = "started";
    wscRefreshActionButtons(); // start now disabled, origin still off

    // Enable "Go to Frame Origin" after 1 second, per spec.
    setTimeout(() => {
      wscPhase = "started-ready";
      wscRefreshActionButtons();
      wscToast('You can now "Go to Frame Origin"', "info", 1800);
    }, 1000);
  } catch (err) {
    wscToast(err.message, "error", 2500);
  }
}

async function wscGoToFrameOrigin() {
  if (!wscActiveFrame) return;
  try {
    const res = await fetch(`${WSC_API}/goToFrameOrigin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frame: wscActiveFrame }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "origin failed");

    wscToast(data.message, "success", 2000);
    wscPhase = "origin";
    wscRefreshActionButtons(); // finish now enabled
  } catch (err) {
    wscToast(err.message, "error", 2500);
  }
}

async function wscFinishCalibration() {
  try {
    const res = await fetch(`${WSC_API}/finishCalibration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "finish failed");

    wscToast(data.message, "success", 2200);
    wscPhase = "finished";
    // Leave everything as-is (per spec: do nothing else).
    wscRefreshActionButtons();
  } catch (err) {
    wscToast(err.message, "error", 2500);
  }
}