// nexsim-embed.js — self-contained NexSim viewer launcher for nextupWeb.
//
// ============================================================================
// TESTING-ONLY MODULE. To fully remove NexSim from the HMI, delete:
//   1. public/nexsim/                     (this folder: bundle + meshes + this file)
//   2. the 2 lines marked "NEXSIM" in public/pointPlanning/index.html
// Nothing else references it. No server.js changes were made.
// ============================================================================
//
// Behaviour:
//   - Injects its own docked-left, resizable window + styles (all class names
//     prefixed `nxs-`), lazy-loads the viewer bundle on first open, disposes
//     fully on close.
//   - While OPEN, HOVERING the page's existing Joint (j1..j6) and Cartesian
//     (cx/cy/cz/cr/cp/cw) jog buttons shows the ghost / arrows preview in the
//     sim. CLICKS are left completely untouched — the real servo command fires
//     exactly as before. Closing the window stops all preview behaviour.

(() => {
  "use strict";
  if (window.__nexsimEmbedLoaded) return;
  window.__nexsimEmbedLoaded = true;

  // ---- resolve asset base from THIS script's own URL -----------------------
  // Robust whether the HMI is served at domain root or behind a sub-path/proxy.
  const SELF = document.currentScript && document.currentScript.src;
  const BASE = SELF ? SELF.slice(0, SELF.lastIndexOf("/") + 1) : "/nexsim/";
  const BUNDLE_URL = BASE + "nexsim-viewer.js";
  const MESH_PATH  = BASE + "meshes/";
  // If rosbridge is not on the same host as this page, hard-code it, e.g.
  //   const ROSBRIDGE_URL = "ws://192.168.1.50:9090";
  const ROSBRIDGE_URL = undefined; // undefined -> ws://<page-host>:9090

  const JOINT_JOG_DEG = 15; // ghost offset per joint jog press

  // page jog button id -> handler descriptor
  //   cartesian: {type:'cart', cmd:'+cx'}   joint: {type:'joint', idx:0, sign:+1}
  const CART_AXES = ["cx", "cy", "cz", "cr", "cp", "cw"];
  const BTN_MAP = {};
  CART_AXES.forEach((ax) => {
    BTN_MAP[ax + "_plus"]  = { type: "cart", cmd: "+" + ax };
    BTN_MAP[ax + "_minus"] = { type: "cart", cmd: "-" + ax };
  });
  for (let j = 1; j <= 6; j++) {
    BTN_MAP["j" + j + "_plus"]  = { type: "joint", idx: j - 1, sign: +1 };
    BTN_MAP["j" + j + "_minus"] = { type: "joint", idx: j - 1, sign: -1 };
  }

  let viewer = null;
  let libLoading = null;
  let hijackOn = false;

  // ---- styles ---------------------------------------------------------------
  const css = `
  .nxs-dock{position:fixed;top:0;left:0;width:50vw;height:100vh;min-width:320px;min-height:240px;
    z-index:100000;background:#14161b;border:1px solid #2c3140;border-radius:0;display:none;
    flex-direction:column;box-shadow:8px 0 40px rgba(0,0,0,.45);}
  .nxs-dock.nxs-floating{border-radius:10px;}
  .nxs-dock.nxs-open{display:flex;}
  .nxs-titlebar{display:flex;align-items:center;justify-content:space-between;height:46px;
    padding:0 14px;border-bottom:1px solid #2c3140;color:#d7dbe4;flex:0 0 auto;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;cursor:move;
    user-select:none;-webkit-user-select:none;}
  .nxs-title{font-weight:700;font-size:14px;display:flex;align-items:center;gap:8px;}
  .nxs-title .nxs-dot{color:#ff7847;}
  .nxs-tag{color:#8b93a6;font-weight:400;font-size:11px;}
  .nxs-right{display:flex;gap:8px;align-items:center;}
  .nxs-btn{cursor:pointer;background:#232733;color:#d7dbe4;border:1px solid #2c3140;
    border-radius:6px;padding:6px 10px;font-size:12px;font-family:inherit;}
  .nxs-btn:hover{background:#2b3040;}
  .nxs-ros{font:12px ui-monospace,Menlo,Consolas,monospace;color:#8b93a6;
    text-transform:uppercase;letter-spacing:.5px;}
  .nxs-ros[data-state=connected]{color:#6bd36b;}
  .nxs-ros[data-state=connecting]{color:#ffd23f;}
  .nxs-ros[data-state=error]{color:#ff6b6b;}
  .nxs-mount{flex:1 1 auto;min-height:0;position:relative;}
  .nxs-mount canvas{display:block;}
  .nxs-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    color:#8b93a6;font:14px -apple-system,sans-serif;background:#1a1c22;}
  .nxs-hint{position:absolute;bottom:10px;left:12px;color:#8b93a6;
    font:11px ui-monospace,monospace;background:rgba(20,22,27,.6);padding:4px 8px;border-radius:4px;}
  .nxs-mode-badge{position:absolute;top:10px;left:12px;color:#ff7847;
    font:11px ui-monospace,monospace;background:rgba(255,120,71,.12);
    border:1px solid #b8532f;padding:3px 8px;border-radius:4px;}
  /* resize handles: 4 edges + 4 corners */
  .nxs-rz{position:absolute;z-index:3;}
  .nxs-rz:hover{background:rgba(255,120,71,.28);}
  .nxs-rz-n{top:-3px;left:8px;right:8px;height:7px;cursor:ns-resize;}
  .nxs-rz-s{bottom:-3px;left:8px;right:8px;height:7px;cursor:ns-resize;}
  .nxs-rz-w{left:-3px;top:8px;bottom:8px;width:7px;cursor:ew-resize;}
  .nxs-rz-e{right:-3px;top:8px;bottom:8px;width:7px;cursor:ew-resize;}
  .nxs-rz-nw{top:-4px;left:-4px;width:14px;height:14px;cursor:nwse-resize;}
  .nxs-rz-ne{top:-4px;right:-4px;width:14px;height:14px;cursor:nesw-resize;}
  .nxs-rz-sw{bottom:-4px;left:-4px;width:14px;height:14px;cursor:nesw-resize;}
  .nxs-rz-se{bottom:-4px;right:-4px;width:14px;height:14px;cursor:nwse-resize;}
  /* while dragging/resizing, don't let the canvas eat pointer events */
  .nxs-dock.nxs-busy .nxs-mount{pointer-events:none;}
  /* launcher button injected into the HMI action row */
  .nxs-launch{cursor:pointer;}
  /* highlight a page jog button while it's driving a preview */
  .nxs-hijack-active{outline:2px solid #ff7847 !important;outline-offset:1px;}
  `;
  const styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ---- dock DOM -------------------------------------------------------------
  const dock = document.createElement("div");
  dock.className = "nxs-dock";
  dock.innerHTML = `
    <div class="nxs-titlebar">
      <span class="nxs-title"><span class="nxs-dot">&#9646;</span> NexSim <span class="nxs-tag">cobot_nextup &middot; test view</span></span>
      <span class="nxs-right">
        <button class="nxs-btn" data-nxs-mode>Jog: arrows</button>
        <span class="nxs-ros" data-nxs-ros>offline</span>
        <button class="nxs-btn" data-nxs-close>Close</button>
      </span>
    </div>
    <div class="nxs-mount" data-nxs-mount>
      <div class="nxs-loading" data-viewer-loading>loading robot&hellip;</div>
      <div class="nxs-mode-badge" data-nxs-badge>hover a jog button &rarr; preview here</div>
      <div class="nxs-hint">L-drag rotate &middot; R-drag pan &middot; wheel zoom &middot; drag titlebar to move, edges to resize</div>
    </div>
    <div class="nxs-rz nxs-rz-n"  data-nxs-rz="n"></div>
    <div class="nxs-rz nxs-rz-s"  data-nxs-rz="s"></div>
    <div class="nxs-rz nxs-rz-w"  data-nxs-rz="w"></div>
    <div class="nxs-rz nxs-rz-e"  data-nxs-rz="e"></div>
    <div class="nxs-rz nxs-rz-nw" data-nxs-rz="nw"></div>
    <div class="nxs-rz nxs-rz-ne" data-nxs-rz="ne"></div>
    <div class="nxs-rz nxs-rz-sw" data-nxs-rz="sw"></div>
    <div class="nxs-rz nxs-rz-se" data-nxs-rz="se"></div>`;
  document.body.appendChild(dock);

  const mount   = dock.querySelector("[data-nxs-mount]");
  const rosLbl  = dock.querySelector("[data-nxs-ros]");
  const modeBtn = dock.querySelector("[data-nxs-mode]");

  // ---- drag (titlebar) + resize (8 handles) --------------------------------
  const MIN_W = 320, MIN_H = 240;

  // Switch from the CSS vw/vh sizing to explicit pixel geometry the first time
  // we move or resize, so left/top/width/height are all authoritative.
  let geomInit = false;
  function ensurePixelGeom() {
    if (geomInit) return;
    const r = dock.getBoundingClientRect();
    dock.style.left = r.left + "px";
    dock.style.top = r.top + "px";
    dock.style.width = r.width + "px";
    dock.style.height = r.height + "px";
    dock.classList.add("nxs-floating");
    geomInit = true;
  }

  function clampToViewport() {
    const r = dock.getBoundingClientRect();
    let left = r.left, top = r.top;
    // keep at least a strip of the titlebar reachable
    left = Math.min(Math.max(left, -r.width + 120), window.innerWidth - 120);
    top = Math.min(Math.max(top, 0), window.innerHeight - 40);
    dock.style.left = left + "px";
    dock.style.top = top + "px";
  }

  // --- dragging by the titlebar ---
  (() => {
    const bar = dock.querySelector(".nxs-titlebar");
    let dragging = false, dx = 0, dy = 0;
    bar.addEventListener("pointerdown", (e) => {
      // ignore clicks on the titlebar's buttons
      if (e.target.closest("button")) return;
      ensurePixelGeom();
      const r = dock.getBoundingClientRect();
      dx = e.clientX - r.left;
      dy = e.clientY - r.top;
      dragging = true;
      dock.classList.add("nxs-busy");
      bar.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    bar.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      dock.style.left = (e.clientX - dx) + "px";
      dock.style.top = (e.clientY - dy) + "px";
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      dock.classList.remove("nxs-busy");
      try { bar.releasePointerCapture(e.pointerId); } catch (_) {}
      clampToViewport();
    };
    bar.addEventListener("pointerup", endDrag);
    bar.addEventListener("pointercancel", endDrag);
  })();

  // --- resizing from any edge/corner ---
  dock.querySelectorAll("[data-nxs-rz]").forEach((h) => {
    const dir = h.getAttribute("data-nxs-rz");
    let active = false, s0 = null;
    h.addEventListener("pointerdown", (e) => {
      ensurePixelGeom();
      const r = dock.getBoundingClientRect();
      s0 = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, w: r.width, h: r.height };
      active = true;
      dock.classList.add("nxs-busy");
      h.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });
    h.addEventListener("pointermove", (e) => {
      if (!active) return;
      const ddx = e.clientX - s0.x, ddy = e.clientY - s0.y;
      let { left, top, w, h: hh } = s0;

      if (dir.includes("e")) w = Math.max(MIN_W, s0.w + ddx);
      if (dir.includes("s")) hh = Math.max(MIN_H, s0.h + ddy);
      if (dir.includes("w")) {
        w = Math.max(MIN_W, s0.w - ddx);
        left = s0.left + (s0.w - w);          // anchor the right edge
      }
      if (dir.includes("n")) {
        hh = Math.max(MIN_H, s0.h - ddy);
        top = s0.top + (s0.h - hh);           // anchor the bottom edge
      }
      dock.style.left = left + "px";
      dock.style.top = top + "px";
      dock.style.width = w + "px";
      dock.style.height = hh + "px";
    });
    const endRz = (e) => {
      if (!active) return;
      active = false;
      dock.classList.remove("nxs-busy");
      try { h.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    h.addEventListener("pointerup", endRz);
    h.addEventListener("pointercancel", endRz);
  });

  // ---- lazy bundle load -----------------------------------------------------
  function loadLib() {
    if (window.NexSimViewer) return Promise.resolve();
    if (libLoading) return libLoading;
    libLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = BUNDLE_URL;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("failed to load " + BUNDLE_URL));
      document.head.appendChild(s);
    });
    return libLoading;
  }

  // ---- open / close ---------------------------------------------------------
  async function open() {
    dock.classList.add("nxs-open");
    try {
      await loadLib();
    } catch (err) {
      const el = mount.querySelector("[data-viewer-loading]");
      if (el) el.innerHTML = `<span style="color:#ff6b6b">${err.message}</span>`;
      console.error("[nexsim]", err);
      return;
    }
    if (!viewer) {
      viewer = new window.NexSimViewer(mount, {
        meshPath: MESH_PATH,
        rosbridgeUrl: ROSBRIDGE_URL,
        shadows: true,
        jogMode: "arrows",
        onStatus: (s) => {
          rosLbl.dataset.state = s;
          rosLbl.textContent = s === "connected" ? "live"
            : s === "connecting" ? "connecting…"
            : s === "error" ? "error" : "offline";
        },
      });
    }
    enableHijack();
  }

  function close() {
    disableHijack();
    if (viewer) { viewer.dispose(); viewer = null; }
    dock.classList.remove("nxs-open");
  }

  // ---- hover-preview on the page's jog buttons -----------------------------
  // While the window is open, HOVERING a mapped jog button shows the ghost /
  // arrows in the sim. Clicks are NOT touched — the real servo command fires
  // exactly as before. Preview clears when the pointer leaves the button.
  let activeBtnEl = null;

  function findMappedButton(target) {
    // buttons contain an <i> icon, so climb to the element carrying the id
    let el = target;
    for (let i = 0; i < 4 && el; i++, el = el.parentElement) {
      if (el.id && BTN_MAP[el.id]) return el;
    }
    return null;
  }

  function showPreviewFor(btn) {
    const d = BTN_MAP[btn.id];
    if (d.type === "cart") viewer.previewJog(d.cmd);
    else viewer.previewJointJog(d.idx, d.sign, JOINT_JOG_DEG);
    btn.classList.add("nxs-hijack-active");
    activeBtnEl = btn;
  }
  function clearPreview() {
    if (!viewer) return;
    viewer.clearJog();
    if (activeBtnEl) activeBtnEl.classList.remove("nxs-hijack-active");
    activeBtnEl = null;
  }

  function onOver(e) {
    if (!viewer) return;
    const btn = findMappedButton(e.target);
    if (!btn || btn === activeBtnEl) return;
    if (activeBtnEl) activeBtnEl.classList.remove("nxs-hijack-active"); // switch buttons
    showPreviewFor(btn);          // does NOT preventDefault — click still works
  }
  function onOut(e) {
    if (!viewer || !activeBtnEl) return;
    // clear only when the pointer truly leaves the active button (moving onto
    // the button's own <i> icon reports relatedTarget still inside it)
    const to = e.relatedTarget;
    if (to && activeBtnEl.contains(to)) return;
    clearPreview();
  }

  function enableHijack() {
    if (hijackOn) return;
    hijackOn = true;
    // passive listeners in bubble phase — we never interfere with the click
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onOut, true);
  }
  function disableHijack() {
    if (!hijackOn) return;
    hijackOn = false;
    document.removeEventListener("pointerover", onOver, true);
    document.removeEventListener("pointerout", onOut, true);
    clearPreview();
  }

  // ---- wiring ---------------------------------------------------------------
  dock.querySelector("[data-nxs-close]").addEventListener("click", close);
  modeBtn.addEventListener("click", () => {
    if (!viewer) return;
    const next = viewer.jog.mode === "arrows" ? "ghost" : "arrows";
    viewer.setJogMode(next);
    modeBtn.textContent = next === "arrows" ? "Jog: arrows" : "Jog: ghost";
  });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && viewer) close(); });
  document.addEventListener("visibilitychange", () => {
    if (!viewer) return;
    document.hidden ? viewer.pause() : viewer.resume();
  });

  window.openNexSim = open;
  const b = document.getElementById("nexsimLaunchBtn");
  if (b) b.addEventListener("click", open);
})();