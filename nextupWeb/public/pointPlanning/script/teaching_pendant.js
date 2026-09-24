// =============================================================================
// teaching_pendant.js — public/pointPlanning/script/teaching_pendant.js
//
// HID jog pendant that emulates a USB keyboard.  Injects its own button,
// modal, and styles — no HTML changes needed.
//
// Device contract:
//   Jog tokens   : 3 chars + Enter  →  "+j1"  "-cx"  "0j3"
//   Point tokens : 3-4 chars + Enter → "@p1" … "@p99"
//
// Safety model (matches keyboard_pendant.js):
//   1. Nothing published unless modal is open AND modal has focus.
//   2. window "blur"           → stop immediately (OS/app stole focus)
//   3. visibilitychange hidden → stop immediately (tab hidden / minimised)
//   4. document "focusin" outside modal → stop immediately
//   5. Watchdog 50ms poll, 200ms timeout → stop if HID goes silent
//   6. closeModal() always stops any active axis.
//   7. beforeunload stops any active axis.
// =============================================================================

(function () {
  "use strict";

  // ── constants ───────────────────────────────────────────────────────────────
  var WATCHDOG_MS  = 200;
  var POLL_MS      = 50;
  var API_BASE     = "http://localhost:3000/point-planning";

  var JOG_AXES     = ["j1","j2","j3","j4","j5","j6","cx","cy","cz","cr","cp","cw"];
  var JOG_RE       = /^[+\-0](j[1-6]|c[xyzrpw])$/;
  var POINT_RE     = /^@p([1-9][0-9]?)$/;          // @p1 … @p99, no leading zeros

  // ── state ───────────────────────────────────────────────────────────────────
  var modal        = null;
  var open         = false;
  var charBuffer   = "";
  var lastJogCmd   = null;   // "+j2" style — currently jogging
  var lastRx       = 0;
  var watchTmr     = null;
  var stagedPoints = [];

  // ── DOM refs (set in init) ───────────────────────────────────────────────────
  var statusEl  = null;
  var lastCmdEl = null;
  var listEl    = null;
  var emptyEl   = null;

  // ── publish ─────────────────────────────────────────────────────────────────
  function pub(cmd) {
    window.parent.postMessage({ type: "UI_COMMANDS", payload: { command: cmd } }, "*");
  }
  function stopAxis(cmd) { pub("0" + cmd.slice(1)); }

  // ── focus check ─────────────────────────────────────────────────────────────
  function live() {
    return open && modal &&
      (document.activeElement === modal || modal.contains(document.activeElement));
  }

  // ── UI helpers ───────────────────────────────────────────────────────────────
  function setStatus(txt, cls) {
    if (statusEl) { statusEl.textContent = txt; statusEl.className = "tp-status tp-status--" + cls; }
  }
  function setLastCmd(txt) { if (lastCmdEl) lastCmdEl.textContent = txt; }

  // ── jog dispatch ────────────────────────────────────────────────────────────
  function applyJog(token) {
    if (!live()) return;
    lastRx = Date.now();
    pub(token);
    if (token[0] === "0") {
      lastJogCmd = null;
      setStatus("⏹  " + token, "stop");
    } else {
      lastJogCmd = token;
      setStatus("▶  " + token, "active");
    }
    setLastCmd(token);
    highlightAxis(token);
  }

  // ── axis grid highlight ──────────────────────────────────────────────────────
  var lastHighlightedAxis = null;
  function highlightAxis(token) {
    if (!modal) return;
    if (lastHighlightedAxis) {
      var prev = modal.querySelector('[data-axis="' + lastHighlightedAxis + '"]');
      if (prev) prev.classList.remove("tp-axis--active");
    }
    if (token[0] === "0") { lastHighlightedAxis = null; return; }
    var axis = token.slice(1);
    lastHighlightedAxis = axis;
    var cell = modal.querySelector('[data-axis="' + axis + '"]');
    if (cell) cell.classList.add("tp-axis--active");
  }

  // ── point capture ────────────────────────────────────────────────────────────
  function applyPoint(token) {
    var m = POINT_RE.exec(token);
    if (!m) return;
    var id = "p" + m[1];
    var j  = (window._pendantJoints    || [0,0,0,0,0,0]).slice().map(Number);
    var c  = (window._pendantCartesian || [0,0,0,0,0,0]).slice().map(Number);
    var ex = stagedPoints.findIndex(function(p){ return p.id === id; });
    if (ex >= 0) {
      stagedPoints[ex].joints  = j;
      stagedPoints[ex].cart    = c;
      stagedPoints[ex].updated = true;
      setStatus("↺  " + id + " updated", "capture");
    } else {
      stagedPoints.push({ id:id, name:id, joints:j, cart:c,
                          is_tf:false, is_editable:true, saved:false });
      setStatus("📍 " + id + " captured", "capture");
    }
    setLastCmd(token);
    renderList();
  }

  // ── watchdog ─────────────────────────────────────────────────────────────────
  function watchdog() {
    if (!lastJogCmd) return;
    if (!live() || Date.now() - lastRx > WATCHDOG_MS) {
      stopAxis(lastJogCmd);
      setStatus("⚠  Failsafe stop", "warn");
      setLastCmd("0" + lastJogCmd.slice(1));
      lastJogCmd = null;
    }
  }

  // ── keydown (capture phase on document) ──────────────────────────────────────
  // HID device sends one keydown per char, then Enter to end the packet.
  document.addEventListener("keydown", function (e) {
    if (!open) return;

    // Enter = flush buffer
    if (e.key === "Enter") {
      var tok = charBuffer.trim().toLowerCase();
      charBuffer = "";
      if (!tok) return;
      if (tok[0] === "@") {
        if (POINT_RE.test(tok)) applyPoint(tok);
      } else {
        if (JOG_RE.test(tok)) applyJog(tok);
      }
      return;
    }

    var ch = e.key;
    if (ch.length !== 1) return;   // skip Shift, Tab, etc.

    charBuffer += ch;

    // Jog tokens are exactly 3 chars — dispatch early (no Enter needed)
    // only when the buffer doesn't start with @ (point tokens need Enter
    // to know if they're single- or double-digit).
    if (charBuffer[0] !== "@" && charBuffer.length === 3) {
      var tok2 = charBuffer;
      charBuffer = "";
      if (JOG_RE.test(tok2)) applyJog(tok2);
      return;
    }

    // Safety cap — longest valid token is "@p99" = 4 chars
    if (charBuffer.length > 5) charBuffer = charBuffer.slice(-5);
  }, true);

  // ── safety net — same five handlers as keyboard_pendant ──────────────────────

  // window loses focus (Alt+Tab, OS dialog, UAC, devtools)
  window.addEventListener("blur", function () {
    if (lastJogCmd) {
      stopAxis(lastJogCmd);
      setStatus("⚠  Stopped — window lost focus", "warn");
      setLastCmd("0" + lastJogCmd.slice(1));
      lastJogCmd = null;
    }
  });

  // tab hidden / minimised / Win+D
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && lastJogCmd) {
      stopAxis(lastJogCmd);
      setStatus("⚠  Stopped — page hidden", "warn");
      setLastCmd("0" + lastJogCmd.slice(1));
      lastJogCmd = null;
    }
  });

  // focus moved to element outside modal (in-page dialog, etc.)
  document.addEventListener("focusin", function () {
    if (!open || !lastJogCmd) return;
    if (!live()) {
      stopAxis(lastJogCmd);
      setStatus("⚠  Stopped — focus left modal", "warn");
      setLastCmd("0" + lastJogCmd.slice(1));
      lastJogCmd = null;
    }
  });

  // page unload / refresh
  window.addEventListener("beforeunload", function () {
    if (lastJogCmd) pub("0" + lastJogCmd.slice(1));
  });

  // ── open / close ─────────────────────────────────────────────────────────────
  function openModal() {
    if (!modal) { console.error("[TeachingPendant] not ready"); return; }
    // Clear any leftover state
    if (lastJogCmd) { stopAxis(lastJogCmd); lastJogCmd = null; }
    charBuffer = "";
    open = true;
    modal.style.display = "flex";
    setTimeout(function () { modal.focus(); }, 0);
    setStatus("Listening — move the pendant to jog", "idle");
    setLastCmd("—");
    clearInterval(watchTmr);
    watchTmr = setInterval(watchdog, POLL_MS);
    renderList();
    var ob = document.getElementById("tpOpenBtn");
    if (ob) ob.classList.add("tp-btn--active");
  }

  function closeModal() {
    if (lastJogCmd) { stopAxis(lastJogCmd); lastJogCmd = null; }
    charBuffer = "";
    open = false;
    if (modal) modal.style.display = "none";
    clearInterval(watchTmr);
    watchTmr = null;
    var ob = document.getElementById("tpOpenBtn");
    if (ob) ob.classList.remove("tp-btn--active");
  }

  // ── staged point list ────────────────────────────────────────────────────────
  function esc(s) {
    return String(s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function getCurrentDateTime() {
    var now = new Date();
    var d   = now.getDate().toString().padStart(2,"0");
    var mon = now.toLocaleString("en-US",{month:"short"}).toLowerCase();
    var hh  = now.getHours().toString().padStart(2,"0");
    var mm  = now.getMinutes().toString().padStart(2,"0");
    return d + mon + "_" + hh + mm;
  }

  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = "";
    if (stagedPoints.length === 0) {
      if (emptyEl) emptyEl.style.display = "flex";
      return;
    }
    if (emptyEl) emptyEl.style.display = "none";

    stagedPoints.forEach(function (pt, idx) {
      var j = pt.joints.map(function(v){ return v.toFixed(2); });
      var c = pt.cart.map(function(v){ return v.toFixed(2); });
      var row = document.createElement("div");
      row.className = "tp-pt-row" + (pt.saved ? " tp-pt-row--saved" : "");
      row.innerHTML =
        '<div class="tp-pt-hdr">' +
          '<span class="tp-pt-id">' + esc(pt.id) + '</span>' +
          '<input class="tp-pt-name" type="text" value="' + esc(pt.name) + '" ' +
            'placeholder="Point name" maxlength="40" data-idx="' + idx + '" ' +
            (pt.saved ? "disabled" : "") + '>' +
          '<label class="tp-chk" title="Enable TF frame">' +
            '<input type="checkbox" class="tp-tf" data-idx="' + idx + '" ' +
              (pt.is_tf ? "checked" : "") + (pt.saved ? " disabled" : "") + '> TF' +
          '</label>' +
          '<label class="tp-chk" title="Allow editing after save">' +
            '<input type="checkbox" class="tp-ed" data-idx="' + idx + '" ' +
              (pt.is_editable ? "checked" : "") + (pt.saved ? " disabled" : "") + '> Edit' +
          '</label>' +
          '<div class="tp-pt-actions">' +
            (pt.saved
              ? '<span class="tp-saved-badge"><i class="fas fa-check"></i> Saved</span>'
              : '<button class="btn btn-success tp-save-btn" data-idx="' + idx + '" title="Save to robot"><i class="fas fa-save"></i></button>'
            ) +
            '<button class="btn ' + (pt.saved ? "btn-secondary" : "btn-danger") +
              ' tp-del-btn" data-idx="' + idx + '" title="Remove"><i class="fas fa-trash-alt"></i></button>' +
          '</div>' +
        '</div>' +
        '<div class="tp-pt-vals">' +
          '<span class="tp-vl">J</span>' +
          j.map(function(v){ return '<span class="tp-v">' + v + '</span>'; }).join("") +
          '<span class="tp-vl" style="margin-left:6px">C</span>' +
          c.map(function(v){ return '<span class="tp-v">' + v + '</span>'; }).join("") +
        '</div>';
      listEl.appendChild(row);
    });

    // Events — stopPropagation on inputs so HID chars don't leak into jog buffer
    listEl.querySelectorAll(".tp-pt-name").forEach(function (inp) {
      inp.addEventListener("keydown", function (e) { e.stopPropagation(); });
      inp.addEventListener("change", function (e) {
        var i = Number(e.target.dataset.idx);
        stagedPoints[i].name = e.target.value.trim() || stagedPoints[i].id;
        e.target.value = stagedPoints[i].name;
        // Refocus modal overlay so HID keeps working after typing
        if (modal) setTimeout(function(){ modal.focus(); }, 0);
      });
    });
    listEl.querySelectorAll(".tp-tf").forEach(function (chk) {
      chk.addEventListener("change", function (e) {
        stagedPoints[Number(e.target.dataset.idx)].is_tf = e.target.checked;
      });
    });
    listEl.querySelectorAll(".tp-ed").forEach(function (chk) {
      chk.addEventListener("change", function (e) {
        stagedPoints[Number(e.target.dataset.idx)].is_editable = e.target.checked;
      });
    });
    listEl.querySelectorAll(".tp-save-btn").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        savePoint(Number(e.currentTarget.dataset.idx));
      });
    });
    listEl.querySelectorAll(".tp-del-btn").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        stagedPoints.splice(Number(e.currentTarget.dataset.idx), 1);
        renderList();
      });
    });
  }

  async function savePoint(idx) {
    var pt = stagedPoints[idx];
    if (!pt || pt.saved) return;
    var name = pt.name.trim();
    if (!name || !/^[a-zA-Z0-9\-_]+$/.test(name)) {
      alert("Name must contain only letters, numbers, dashes, or underscores.");
      return;
    }
    if (pt.is_tf && !name.endsWith("-tf")) name = name + "-tf";
    var payload = {
      name         : name,
      date_time    : getCurrentDateTime(),
      sequence     : 1,
      nature       : name,
      is_tf        : pt.is_tf,
      is_calibrated: false,
      is_editable  : pt.is_editable,
      joints_values: { joint1:pt.joints[0]||0, joint2:pt.joints[1]||0, joint3:pt.joints[2]||0,
                       joint4:pt.joints[3]||0, joint5:pt.joints[4]||0, joint6:pt.joints[5]||0 },
      coordinate   : { x:pt.cart[0]||0, y:pt.cart[1]||0, z:pt.cart[2]||0,
                       r:pt.cart[3]||0, p:pt.cart[4]||0, w:pt.cart[5]||0 },
    };
    var btn = listEl && listEl.querySelector('.tp-save-btn[data-idx="' + idx + '"]');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
    try {
      var res  = await fetch(API_BASE + "/addPoint", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify(payload),
      });
      var data = await res.json();
      if (res.ok) {
        stagedPoints[idx].saved = true;
        stagedPoints[idx].name  = name;
        setStatus('✅ "' + name + '" saved', "capture");
        renderList();
        if (typeof window.loadPoints === "function") window.loadPoints();
      } else {
        setStatus("❌ Save failed: " + (data.message || "error"), "warn");
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i>'; }
      }
    } catch (err) {
      setStatus("❌ Network error: " + err.message, "warn");
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i>'; }
    }
  }

  // ── init ─────────────────────────────────────────────────────────────────────
  function init() {

    // 1. Styles
    if (!document.getElementById("tp-styles")) {
      var s = document.createElement("style");
      s.id  = "tp-styles";
      s.textContent = [
        "#teachingPendantModal{position:fixed;z-index:9999;inset:0;display:none;",
        "  align-items:center;justify-content:center;",
        "  background:rgba(0,0,0,.52);backdrop-filter:blur(4px);outline:none}",

        ".tp-card{background:#fff;border-radius:12px;width:620px;max-width:96vw;",
        "  max-height:92vh;display:flex;flex-direction:column;overflow:hidden;",
        "  box-shadow:0 20px 60px rgba(0,0,0,.28);animation:modalSlideIn .22s ease-out}",

        ".tp-hdr{display:flex;align-items:center;gap:10px;padding:15px 18px;",
        "  background:linear-gradient(135deg,#1a3a5c,#0d2137);flex-shrink:0}",
        ".tp-hdr-icon{font-size:19px;color:#4fc3f7}",
        ".tp-hdr-title{flex:1;font-size:16px;font-weight:600;margin:0;color:#e8f4ff}",
        ".tp-hdr .modal-close{background:none;border:none;font-size:22px;cursor:pointer;",
        "  color:rgba(255,255,255,.4);transition:.15s}",
        ".tp-hdr .modal-close:hover{color:#ff6b6b}",

        // Status strip
        ".tp-strip{padding:10px 18px;background:#f8f9fa;",
        "  border-bottom:1px solid #e9ecef;display:flex;flex-direction:column;gap:5px;flex-shrink:0}",
        ".tp-row{display:flex;align-items:center;gap:8px}",
        ".tp-lbl{font-size:10px;font-weight:700;text-transform:uppercase;",
        "  letter-spacing:.5px;color:#adb5bd;min-width:68px}",
        ".tp-status{font-size:12px;font-weight:500;padding:2px 9px;border-radius:20px;transition:.1s}",
        ".tp-status--idle   {background:#e8f4ff;color:#1a6fa8}",
        ".tp-status--active {background:#d4edda;color:#155724}",
        ".tp-status--stop   {background:#f8d7da;color:#721c24}",
        ".tp-status--warn   {background:#fff3cd;color:#856404}",
        ".tp-status--capture{background:#d1ecf1;color:#0c5460}",
        "code.tp-lcmd{font-family:monospace;font-size:13px;font-weight:700;",
        "  background:#e9ecef;padding:1px 7px;border-radius:5px;color:#212529}",
        ".tp-fs{display:flex;align-items:center;gap:5px;font-size:11px;color:#adb5bd;",
        "  padding:3px 7px;background:rgba(243,156,18,.07);border-radius:6px;width:fit-content}",
        ".tp-fs i{color:#e67e22}",

        // Axis grid
        ".tp-axis-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:5px;padding:10px 18px;",
        "  background:#f8f9fa;border-bottom:1px solid #e9ecef;flex-shrink:0}",
        ".tp-axis-cell{display:flex;flex-direction:column;align-items:center;gap:3px;",
        "  padding:5px 3px;background:#fff;border-radius:7px;",
        "  border:1px solid #dee2e6;transition:.1s}",
        ".tp-axis-cell.tp-axis--active{background:rgba(46,204,113,.12);",
        "  border-color:rgba(46,204,113,.5)}",
        ".tp-axis-name{font-size:10px;font-family:monospace;font-weight:700;color:#6c757d}",
        ".tp-axis-cell.tp-axis--active .tp-axis-name{color:#155724}",
        ".tp-axis-dot{width:7px;height:7px;border-radius:50%;background:#dee2e6;transition:.1s}",
        ".tp-axis-cell.tp-axis--active .tp-axis-dot{background:#2ecc71}",

        // Points section
        ".tp-pts-wrap{flex:1;overflow-y:auto;padding:12px 18px;display:flex;flex-direction:column;gap:8px}",
        ".tp-pts-hdr{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
        ".tp-pts-title{font-size:12px;font-weight:700;color:#212529;display:flex;align-items:center;gap:5px}",
        ".tp-pts-title i{color:#0066cc}",
        ".tp-pts-hint{font-size:11px;color:#adb5bd;flex:1}",
        ".tp-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;",
        "  gap:8px;padding:24px;color:#adb5bd;text-align:center;font-size:12px;",
        "  border:2px dashed #dee2e6;border-radius:8px}",
        ".tp-empty i{font-size:24px;opacity:.4}",
        ".tp-pt-row{border:1px solid #dee2e6;border-radius:9px;padding:8px 10px;",
        "  background:#fff;transition:border-color .15s}",
        ".tp-pt-row:hover{border-color:#4361ee}",
        ".tp-pt-row--saved{background:#f0fff4;border-color:#2ecc71}",
        ".tp-pt-hdr{display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
        ".tp-pt-id{font-family:monospace;font-size:11px;font-weight:700;",
        "  background:#0066cc;color:#fff;padding:2px 7px;border-radius:4px;white-space:nowrap}",
        ".tp-pt-name{flex:1;min-width:100px;padding:4px 7px;font-size:12px;",
        "  border:1px solid #ced4da;border-radius:5px;outline:none}",
        ".tp-pt-name:focus{border-color:#4361ee}",
        ".tp-pt-name:disabled{background:#f8f9fa;cursor:default}",
        ".tp-chk{display:flex;align-items:center;gap:3px;font-size:11px;",
        "  cursor:pointer;color:#495057;white-space:nowrap}",
        ".tp-pt-actions{display:flex;align-items:center;gap:5px}",
        ".tp-save-btn,.tp-del-btn{padding:4px 9px;font-size:12px}",
        ".tp-saved-badge{font-size:11px;color:#155724;background:#d4edda;",
        "  padding:2px 8px;border-radius:20px;display:flex;align-items:center;gap:3px;white-space:nowrap}",
        ".tp-pt-vals{display:flex;align-items:center;gap:3px;margin-top:6px;flex-wrap:wrap}",
        ".tp-vl{font-size:10px;font-weight:700;text-transform:uppercase;color:#adb5bd;min-width:10px}",
        ".tp-v{font-family:monospace;font-size:10px;padding:1px 5px;",
        "  background:#f1f3f5;border-radius:3px;color:#495057}",

        // Footer
        ".tp-ftr{display:flex;align-items:center;justify-content:space-between;gap:10px;",
        "  padding:10px 18px;border-top:1px solid #e9ecef;background:#f8f9fa;flex-shrink:0}",
        ".tp-ftr-note{font-size:11px;color:#adb5bd;display:flex;align-items:center;gap:4px}",
        ".tp-ftr-note i{color:#e67e22}",

        // Open button pulse
        "#tpOpenBtn.tp-btn--active{background:#e67e22;color:#fff;",
        "  border-color:#e67e22;animation:tpPulse 1.8s ease-in-out infinite}",
        "@keyframes tpPulse{0%,100%{box-shadow:0 0 0 0 rgba(230,126,34,.4)}",
        "  50%{box-shadow:0 0 0 6px rgba(230,126,34,0)}}",
      ].join("\n");
      document.head.appendChild(s);
    }

    // 2. Open button — inserted before nexsimLaunchBtn
    if (!document.getElementById("tpOpenBtn")) {
      var btn = document.createElement("button");
      btn.id        = "tpOpenBtn";
      btn.type      = "button";
      btn.className = "btn btn-secondary";
      btn.title     = "Teaching Pendant (HID device)";
      btn.innerHTML = '<i class="fas fa-gamepad"></i> Teaching Pendant';
      btn.addEventListener("click", openModal);
      var anchor = document.getElementById("nexsimLaunchBtn");
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(btn, anchor);
      } else {
        var ha = document.querySelector(".header-actions");
        if (ha) ha.appendChild(btn);
      }
    }

    // 3. Modal
    if (document.getElementById("teachingPendantModal")) {
      modal = document.getElementById("teachingPendantModal");
    } else {
      // Axis grid cells
      var axisGrid = JOG_AXES.map(function (a) {
        return '<div class="tp-axis-cell" data-axis="' + a + '">' +
               '<span class="tp-axis-name">' + a.toUpperCase() + '</span>' +
               '<span class="tp-axis-dot"></span></div>';
      }).join("");

      modal = document.createElement("div");
      modal.id       = "teachingPendantModal";
      modal.tabIndex = 0;
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.innerHTML =
        '<div class="tp-card">' +

          '<div class="tp-hdr">' +
            '<i class="fas fa-gamepad tp-hdr-icon"></i>' +
            '<h3 class="tp-hdr-title">Teaching Pendant</h3>' +
            '<button class="modal-close" id="tpCloseBtnX" title="Deactivate">&times;</button>' +
          '</div>' +

          '<div class="tp-strip">' +
            '<div class="tp-row">' +
              '<span class="tp-lbl">Status</span>' +
              '<span id="tpStatus" class="tp-status tp-status--idle">Listening — move the pendant to jog</span>' +
            '</div>' +
            '<div class="tp-row">' +
              '<span class="tp-lbl">Last token</span>' +
              '<code id="tpLastCmd" class="tp-lcmd">—</code>' +
            '</div>' +
            '<div class="tp-fs"><i class="fas fa-shield-alt"></i>' +
              'Failsafe: auto-stop after <strong style="margin:0 2px">200 ms</strong> of silence' +
            '</div>' +
          '</div>' +

          '<div class="tp-axis-grid">' + axisGrid + '</div>' +

          '<div class="tp-pts-wrap">' +
            '<div class="tp-pts-hdr">' +
              '<span class="tp-pts-title"><i class="fas fa-map-marker-alt"></i> Captured Points</span>' +
              '<span class="tp-pts-hint">Press the @p button on pendant to capture current position</span>' +
              '<button class="btn btn-secondary tp-save-btn" style="padding:4px 9px;font-size:11px" ' +
                'id="tpClearBtn" title="Remove all unsaved points">' +
                '<i class="fas fa-broom"></i> Clear unsaved' +
              '</button>' +
            '</div>' +
            '<div id="tpPointListEmpty" class="tp-empty">' +
              '<i class="fas fa-dot-circle"></i>' +
              '<span>No points captured yet.<br>Jog to position then press <strong>@p1</strong>–<strong>@p99</strong> on the pendant.</span>' +
            '</div>' +
            '<div id="tpPointList"></div>' +
          '</div>' +

          '<div class="tp-ftr">' +
            '<span class="tp-ftr-note"><i class="fas fa-exclamation-triangle"></i>' +
              'Robot moves only while pendant sends jog tokens' +
            '</span>' +
            '<button class="btn btn-danger" id="tpCloseBtn">' +
              '<i class="fas fa-stop-circle"></i> Deactivate' +
            '</button>' +
          '</div>' +

        '</div>';

      document.body.appendChild(modal);
    }

    // Cache DOM refs
    statusEl  = document.getElementById("tpStatus");
    lastCmdEl = document.getElementById("tpLastCmd");
    listEl    = document.getElementById("tpPointList");
    emptyEl   = document.getElementById("tpPointListEmpty");

    // Wire close buttons
    document.getElementById("tpCloseBtnX").addEventListener("click", closeModal);
    document.getElementById("tpCloseBtn").addEventListener("click",  closeModal);

    document.getElementById("tpClearBtn").addEventListener("click", function () {
      if (!confirm("Remove all unsaved staged points?")) return;
      stagedPoints = stagedPoints.filter(function(p){ return p.saved; });
      renderList();
    });

    // Backdrop click → close
    modal.addEventListener("mousedown", function (e) {
      if (e.target === modal) closeModal();
    });

    // Click inside card (not a button or input) → restore modal focus
    modal.querySelector(".tp-card").addEventListener("mousedown", function (e) {
      var tag = e.target.tagName;
      if (tag !== "BUTTON" && tag !== "INPUT") {
        setTimeout(function () { modal.focus(); }, 0);
      }
    });

    // Escape
    modal.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });

    console.log("[TeachingPendant] ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

}());