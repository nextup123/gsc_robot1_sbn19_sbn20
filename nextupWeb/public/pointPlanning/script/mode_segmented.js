// mode_segmented.js
// Drives the 3-mode segmented control (SafeAuto / Jog / Auto).
//
// Flow:
//   click a segment -> lock control (busy) -> postMessage SWITCH_MODE
//     { mode, fromMode } up to the host bridge -> backend runs overspeed
//     SDO writes + /change_mode in the correct order and streams
//     MODE_SWITCH_PROGRESS events back -> we mirror them into the
//     background progress bar. On MODE_SWITCH_RESULT we unlock or,
//     on failure, paint the background red.
//
// Progress weighting mirrors backend:
//   with mode change: mode = 40%, each of 6 services = 10%  -> 100%
//   without mode change (SafeAuto<->Auto): 6 x ~16.6%       -> 100%
// We simply render whatever `progress` the backend reports, so the two
// stay in lock-step without duplicating the math.

(() => {
  const ORDER = ["safeauto", "jog", "auto"]; // must match DOM button order / thumb index
  const LABELS = { safeauto: "SafeAuto", jog: "Jog", auto: "Auto" };

  const seg = document.getElementById("mode-seg");
  if (!seg) return;

  const thumb = document.getElementById("mode-seg-thumb");
  const progressEl = document.getElementById("mode-seg-progress");
  const buttons = Array.from(seg.querySelectorAll(".mode-seg-btn"));

  // Restore last selection (default safeauto). We store the UI mode name.
  let currentMode = localStorage.getItem("uiMode");
  if (!ORDER.includes(currentMode)) currentMode = "safeauto";

  let busy = false;
  let pendingMode = null; // the mode we're transitioning INTO
  let safetyTimer = null; // hard re-enable if backend never replies
  let lastDriveMode = undefined; // coarse 8/9 from joint_states, for detection hint only

  // ── rendering helpers ─────────────────────────────────────────────
  function idxOf(mode) {
    return Math.max(0, ORDER.indexOf(mode));
  }

  function paintSelection(mode) {
    seg.style.setProperty("--seg-idx", String(idxOf(mode)));
    buttons.forEach((b) => {
      const active = b.dataset.mode === mode;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  // Visually mark which segment the user is *attempting* to switch to,
  // WITHOUT moving the selected thumb (thumb only moves on confirmed success).
  function paintPending(mode) {
    buttons.forEach((b) => {
      b.classList.toggle("is-pending", b.dataset.mode === mode);
    });
  }

  function clearPending() {
    buttons.forEach((b) => b.classList.remove("is-pending"));
  }

  function setProgress(pct) {
    const clamped = Math.max(0, Math.min(100, pct));
    progressEl.style.width = clamped + "%";
  }

  function setBusy(state) {
    busy = state;
    seg.classList.toggle("is-busy", state);
    buttons.forEach((b) => (b.disabled = state));
  }

  function clearError() {
    seg.classList.remove("is-error");
  }

  function showError() {
    seg.classList.add("is-error"); // CSS forces progress to 100% red
  }

  function finish() {
    // common teardown after success or failure
    if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
    setBusy(false);
    clearPending();
    pendingMode = null;
  }

  // ── send a switch request up to the host bridge ───────────────────
  function requestSwitch(nextMode) {
    if (busy || nextMode === currentMode) return;

    clearError();
    setBusy(true);
    setProgress(0);
    pendingMode = nextMode;

    // Feedback only: highlight the pressed target, but DO NOT move the
    // selected thumb. The thumb moves only when the backend confirms.
    paintPending(nextMode);

    // Hard safety: whatever happens, re-enable buttons after 5s. The
    // backend's worst case is 6×300ms services + 3000ms mode change; a
    // 5s ceiling covers a stalled/absent reply.
    if (safetyTimer) clearTimeout(safetyTimer);
    safetyTimer = setTimeout(() => {
      if (!busy) return;
      showError();
      paintSelection(currentMode); // stay on last good mode
      finish();
      if (typeof amShowToast === "function") {
        amShowToast({ text: "Mode switch timed out", type: "error" });
      }
    }, 5000);

    window.parent.postMessage(
      {
        type: "SWITCH_MODE",
        payload: { mode: nextMode, fromMode: currentMode },
      },
      "*"
    );
  }

  // ── handle progress / result coming back from backend ─────────────
  function onProgressEvent(evt) {
    if (!evt) return;

    if (evt.phase === "error" || evt.failed) {
      showError();
      paintSelection(currentMode); // stay on last good mode; thumb never moved
      finish();
      if (typeof amShowToast === "function") {
        amShowToast({ text: `Mode switch failed: ${evt.message || "unknown"}`, type: "error" });
      }
      return;
    }

    if (typeof evt.progress === "number") {
      setProgress(evt.progress);
    }

    if (evt.phase === "complete") {
      setProgress(100);
    }
  }

  function onResult(res) {
    if (!res) return;

    if (res.ok) {
      // ✅ Confirmed by backend — NOW commit the selection (move the thumb).
      currentMode = pendingMode || res.mode || currentMode;
      localStorage.setItem("uiMode", currentMode);
      localStorage.setItem("robotMode", res.mode === "jog" ? "9" : "8");
      paintSelection(currentMode);
      setProgress(100);
      // let the full bar show briefly, then reset track and re-enable
      const settleTimer = setTimeout(() => {
        if (!seg.classList.contains("is-error")) setProgress(0);
      }, 450);
      finish();
      // finish() cleared safetyTimer; settleTimer is harmless if it fires later
      void settleTimer;
    } else {
      showError();
      paintSelection(currentMode); // revert — selection never changed
      finish();
    }
  }

  // ── wire buttons ──────────────────────────────────────────────────
  buttons.forEach((b) => {
    b.addEventListener("click", () => requestSwitch(b.dataset.mode));
  });

  // ── listen for backend messages (same channel the page uses) ──────
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || !msg.type) return;

    if (msg.type === "MODE_SWITCH_PROGRESS") {
      onProgressEvent(msg.payload);
    } else if (msg.type === "MODE_SWITCH_RESULT") {
      onResult(msg.payload);
    } else if (msg.type === "DETECT_MODE_RESULT") {
      // Authoritative current-mode detection (from joint1 threshold + drive
      // mode), used ONLY to initialize the selection on load. Never fired
      // mid-switch and never snaps the user to a mode they didn't pick.
      if (busy) return;
      const detected = msg.payload?.mode;
      if (detected && ORDER.includes(detected)) {
        applyExternalMode(detected);
      }
    } else if (msg.type === "MODE_STATE") {
      // Live, edge-triggered sync from the backend (2Hz, only on change).
      // Fires when the mode changes EXTERNALLY (another node, teach pendant,
      // etc.). We follow it — but never while the user's own switch is in
      // flight, and never for the transient 'edge-pending' (mode: null)
      // that precedes the auto/safeauto resolve.
      if (busy) return;
      const m = msg.payload?.mode;
      if (m && ORDER.includes(m)) {
        applyExternalMode(m);
      }
    } else if (msg.type === "JOINT_MODE_OF_OPERATION") {
      // Legacy coarse stream — kept only as a drive-mode hint for the
      // initial detection request. Does not paint the selection.
      lastDriveMode = msg.payload?.modeOfOperation;
    }
  });

  // Apply a mode that originated OUTSIDE this control (load detection or
  // external change). Updates state + thumb without any confirmation dance.
  function applyExternalMode(mode) {
    if (mode === currentMode) return;
    currentMode = mode;
    localStorage.setItem("uiMode", currentMode);
    localStorage.setItem("robotMode", mode === "jog" ? "9" : "8");
    clearError();
    paintSelection(currentMode);
  }

  // Ask the backend for the real current mode once, on load. If the drive
  // mode has arrived we pass it as a hint; otherwise detection reads the
  // threshold and infers.
  function requestDetect() {
    window.parent.postMessage(
      { type: "DETECT_MODE", payload: { driveMode: lastDriveMode } },
      "*"
    );
  }

  // ── initial paint + detection ─────────────────────────────────────
  paintSelection(currentMode);
  setProgress(0);
  // slight delay so the WS/joint_states hint can arrive first
  setTimeout(requestDetect, 800);
})();