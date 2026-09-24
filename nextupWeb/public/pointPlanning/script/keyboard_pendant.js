// keyboard_pendant.js
// Keyboard jog pendant — Shift+key for Joint, Alt+key for Cartesian.
// Publishes { type:"UI_COMMANDS", payload:{ command } } to window.parent.

(function () {
  "use strict";

  // ── command table ────────────────────────────────────────────────────────────
  var CMD = {
    "shift+q": "+j1",  "shift+w": "-j1",
    "shift+a": "+j2",  "shift+s": "-j2",
    "shift+z": "+j3",  "shift+x": "-j3",
    "shift+e": "+j4",  "shift+r": "-j4",
    "shift+d": "+j5",  "shift+f": "-j5",
    "shift+c": "+j6",  "shift+v": "-j6",
    "alt+q":  "+cx",  "alt+w":  "-cx",
    "alt+a":  "+cy",  "alt+s":  "-cy",
    "alt+z":  "+cz",  "alt+x":  "-cz",
    "alt+e":  "+cr",  "alt+r":  "-cr",
    "alt+d":  "+cp",  "alt+f":  "-cp",
    "alt+c":  "+cw",  "alt+v":  "-cw",
  };

  // Keys we own — used to block browser shortcuts while modal is open
  var OWNED_KEYS = { q:1, w:1, a:1, s:1, z:1, x:1, e:1, r:1, d:1, f:1, c:1, v:1 };

  // ── state ────────────────────────────────────────────────────────────────────
  var modal       = null;
  var open        = false;
  var activeCmd   = null;
  var activeCombo = null;
  var heartbeat   = 0;
  var repeatTmr   = null;
  var watchTmr    = null;

  // ── publish ──────────────────────────────────────────────────────────────────
  function pub(cmd) {
    window.parent.postMessage({ type: "UI_COMMANDS", payload: { command: cmd } }, "*");
  }

  // ── focus guard ──────────────────────────────────────────────────────────────
  function live() {
    return open && modal &&
      (document.activeElement === modal || modal.contains(document.activeElement));
  }

  // ── UI updates ───────────────────────────────────────────────────────────────
  function setStatus(txt, cls) {
    var el = document.getElementById("kpStatus");
    if (el) { el.textContent = txt; el.className = "kp-status kp-status--" + cls; }
  }
  function setLastCmd(txt) {
    var el = document.getElementById("kpLastCmd");
    if (el) el.textContent = txt;
  }

  // Highlight only the cell that matches both key AND modifier
  function highlight(combo, on) {
    if (!modal || !combo) return;
    var parts = combo.split("+");
    var mod   = parts[0];   // "shift" or "alt"
    var key   = parts[1];
    // Each cell has data-key and data-mod attributes
    var cell = modal.querySelector('[data-key="' + key + '"][data-mod="' + mod + '"]');
    if (cell) cell.classList.toggle("kp-key--active", on);
  }

  // ── jog ──────────────────────────────────────────────────────────────────────
  function startJog(combo, cmd) {
    if (activeCmd && activeCombo !== combo) stopJog();
    activeCmd   = cmd;
    activeCombo = combo;
    heartbeat   = Date.now();
    pub(cmd);
    setStatus("▶  " + cmd, "active");
    setLastCmd(cmd);
    highlight(combo, true);
    clearInterval(repeatTmr);
    repeatTmr = setInterval(function () {
      if (!live()) { stopJog(); return; }
      pub(cmd);
      heartbeat = Date.now();
    }, 100);
  }

  function stopJog() {
    clearInterval(repeatTmr);
    repeatTmr = null;
    if (!activeCmd) return;
    var stop = "0" + activeCmd.slice(1);
    pub(stop);
    setStatus("⏹  " + stop, "stop");
    setLastCmd(stop);
    highlight(activeCombo, false);
    activeCmd   = null;
    activeCombo = null;
  }

  // ── watchdog ─────────────────────────────────────────────────────────────────
  function watchdog() {
    if (!activeCmd) return;
    if (!live() || Date.now() - heartbeat > 200) {
      stopJog();
      setStatus("⚠  Auto-stopped (200 ms)", "warn");
    }
  }

  // ── key events ───────────────────────────────────────────────────────────────
  function getCombo(e) {
    if (e.metaKey || e.ctrlKey) return null;   // never intercept Ctrl combos
    if (e.shiftKey && e.altKey) return null;   // both mods together — ignore
    var k = e.key.toLowerCase();
    if (k.length !== 1)         return null;
    if (e.shiftKey) return "shift+" + k;
    if (e.altKey)   return "alt+"   + k;
    return null;
  }

  // keydown — capture phase (before browser shortcut handlers)
  document.addEventListener("keydown", function (e) {
    if (!open) return;
    var k = e.key.toLowerCase();

    // Block browser shortcuts for our owned keys when Shift or Alt held
    if (OWNED_KEYS[k] && !e.ctrlKey && !e.metaKey && (e.shiftKey || e.altKey)) {
      e.preventDefault();
      e.stopPropagation();
    }

    var c = getCombo(e);
    if (!c || !CMD[c]) return;
    if (c === activeCombo) return;   // same key still held — repeatTmr handles it
    startJog(c, CMD[c]);
  }, true);

  // keyup — fires when the letter key OR the modifier is released
  document.addEventListener("keyup", function (e) {
    if (!open || !activeCombo) return;
    var k = e.key.toLowerCase();
    // Match on letter key, or on either modifier being lifted
    if (activeCombo.indexOf(k) !== -1 || k === "shift" || k === "alt") {
      stopJog();
    }
  }, true);

  // ── focus / visibility safety net ────────────────────────────────────────────
  // Scenario A: OS dialog / system popup steals focus (Alt+Tab, UAC, notifications)
  //   → window fires "blur", page fires "focusin" to a non-modal element, OR
  //     neither fires at all while the OS holds focus. The watchdog catches
  //     the 200ms heartbeat gap in all these cases.
  //
  // Scenario B: User Alt+Tabs to another app while key held
  //   → browser fires "blur" on window. We stop immediately, don't wait for watchdog.
  //
  // Scenario C: Browser devtools opened (F12)
  //   → document loses focus → window blur fires.
  //
  // Scenario D: Another modal / dialog opens inside the same page
  //   → focusin fires with target outside our modal → stop immediately.
  //
  // Scenario E: Browser tab becomes hidden (user switches tab, Win+D, minimise)
  //   → visibilitychange fires with document.hidden = true → stop immediately.
  //
  // Scenario F: Page is about to unload / refresh
  //   → beforeunload → stop immediately.
  //
  // Scenario G: Modifier key was held, letter key released, but modifier keyup
  //   was swallowed (focus left during the combo)
  //   → watchdog fires after 200ms (heartbeat from repeatTmr stopped).

  // Scenario A / B / C: window loses focus entirely
  window.addEventListener("blur", function () {
    if (activeCmd) {
      stopJog();
      setStatus("⚠  Stopped — window lost focus", "warn");
    }
  });

  // Scenario D: focus moved to something outside our modal within the same page
  document.addEventListener("focusin", function () {
    if (!open || !activeCmd) return;
    if (!live()) {
      stopJog();
      setStatus("⚠  Stopped — click modal to resume", "warn");
    }
  });

  // Scenario E: tab hidden / minimised / covered
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && activeCmd) {
      stopJog();
      setStatus("⚠  Stopped — page hidden", "warn");
    }
  });

  // Scenario F: page unload / refresh
  window.addEventListener("beforeunload", function () {
    if (activeCmd) pub("0" + activeCmd.slice(1));
  });

  // Scenario G is covered by the 200ms watchdog already running.

  // ── open / close ─────────────────────────────────────────────────────────────
  function openModal() {
    if (!modal) { console.error("[KbPendant] not ready"); return; }
    // Safety: clear any leftover state from a previous session
    stopJog();
    open = true;
    modal.style.display = "flex";
    setTimeout(function () { modal.focus(); }, 0);
    setStatus("Ready — hold Shift+key (joint) or Alt+key (cartesian)", "idle");
    setLastCmd("—");
    clearInterval(watchTmr);
    watchTmr = setInterval(watchdog, 50);
    var ob = document.getElementById("kbPendantOpenBtn");
    if (ob) ob.classList.add("kp-btn--active");
  }

  function closeModal() {
    stopJog();
    open = false;
    if (modal) modal.style.display = "none";
    clearInterval(watchTmr);
    watchTmr = null;
    var ob = document.getElementById("kbPendantOpenBtn");
    if (ob) ob.classList.remove("kp-btn--active");
  }

  // ── init ─────────────────────────────────────────────────────────────────────
  function init() {

    // Styles
    if (!document.getElementById("kp-styles")) {
      var s = document.createElement("style");
      s.id = "kp-styles";
      s.textContent = [
        "#kbPendantModal{position:fixed;z-index:9999;inset:0;display:none;",
        "  align-items:center;justify-content:center;",
        "  background:rgba(0,0,0,.52);backdrop-filter:blur(4px);outline:none}",

        ".kp-card{background:#fff;border-radius:12px;width:480px;max-width:96vw;",
        "  max-height:92vh;display:flex;flex-direction:column;overflow:hidden;",
        "  box-shadow:0 20px 60px rgba(0,0,0,.28);animation:modalSlideIn .22s ease-out}",

        ".kp-hdr{display:flex;align-items:center;gap:10px;padding:15px 18px;",
        "  background:linear-gradient(135deg,#1a3a5c,#0d2137);flex-shrink:0}",
        ".kp-hdr-icon{font-size:19px;color:#4fc3f7}",
        ".kp-hdr-title{flex:1;font-size:16px;font-weight:600;margin:0;color:#e8f4ff}",
        ".kp-hdr .modal-close{background:none;border:none;font-size:22px;cursor:pointer;",
        "  color:rgba(255,255,255,.4);transition:.15s}",
        ".kp-hdr .modal-close:hover{color:#ff6b6b}",

        ".kp-strip{padding:10px 18px;background:#f8f9fa;",
        "  border-bottom:1px solid #e9ecef;display:flex;flex-direction:column;",
        "  gap:5px;flex-shrink:0}",
        ".kp-row{display:flex;align-items:center;gap:8px}",
        ".kp-lbl{font-size:10px;font-weight:700;text-transform:uppercase;",
        "  letter-spacing:.5px;color:#adb5bd;min-width:68px}",
        ".kp-status{font-size:12px;font-weight:500;padding:2px 9px;border-radius:20px;transition:.1s}",
        ".kp-status--idle  {background:#e8f4ff;color:#1a6fa8}",
        ".kp-status--active{background:#d4edda;color:#155724}",
        ".kp-status--stop  {background:#f8d7da;color:#721c24}",
        ".kp-status--warn  {background:#fff3cd;color:#856404}",
        "code.kp-lcmd{font-family:monospace;font-size:13px;font-weight:700;",
        "  background:#e9ecef;padding:1px 7px;border-radius:5px;color:#212529}",
        ".kp-fs{display:flex;align-items:center;gap:5px;font-size:11px;color:#adb5bd;",
        "  padding:3px 7px;background:rgba(243,156,18,.07);border-radius:6px;width:fit-content}",
        ".kp-fs i{color:#e67e22}",

        // Key reference grid
        ".kp-ref{flex:1;overflow-y:auto;padding:14px 18px;display:flex;flex-direction:column;gap:4px}",
        ".kp-ref-hdr{display:grid;grid-template-columns:80px 1fr 1fr;",
        "  font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;",
        "  color:#adb5bd;padding:0 0 6px;border-bottom:1px solid #e9ecef;margin-bottom:4px}",
        ".kp-ref-hdr .h-joint{color:#4361ee}",
        ".kp-ref-hdr .h-cart {color:#129469}",
        ".kp-ref-row{display:grid;grid-template-columns:80px 1fr 1fr;",
        "  align-items:center;padding:3px 0;border-bottom:1px solid #f1f3f5}",
        ".kp-ref-row:last-child{border-bottom:none}",
        ".kp-axis{font-size:11px;font-weight:700;color:#6c757d}",
        ".kp-cell{display:flex;align-items:center;gap:5px}",

        // Key chip
        ".kp-key{display:inline-flex;align-items:center;justify-content:center;",
        "  width:26px;height:26px;border-radius:5px;border:1.5px solid;",
        "  font-size:12px;font-weight:700;font-family:monospace;",
        "  box-shadow:0 2px 0;user-select:none;transition:.1s;flex-shrink:0}",
        ".kp-key--j{border-color:#a8b4f8;color:#4361ee;background:#eef0fd;box-shadow-color:#a8b4f8}",
        ".kp-key--c{border-color:#7ed8b6;color:#129469;background:#e6f7f2;box-shadow-color:#7ed8b6}",
        ".kp-key--active{background:#d4edda!important;border-color:#2ecc71!important;",
        "  color:#155724!important;transform:translateY(1px);",
        "  box-shadow:0 1px 0 #27ae60!important}",

        ".kp-cmd{font-family:monospace;font-size:11px;font-weight:600;color:#6c757d}",
        ".kp-sep{color:#dee2e6;font-size:12px;margin:0 1px}",

        ".kp-mod{font-size:9px;font-weight:700;text-transform:uppercase;",
        "  padding:1px 5px;border-radius:4px;letter-spacing:.4px;flex-shrink:0}",
        ".kp-mod--j{background:#eef0fd;color:#4361ee;border:1px solid #c5cbf9}",
        ".kp-mod--c{background:#e6f7f2;color:#129469;border:1px solid #a3e4cc}",

        ".kp-ftr{display:flex;align-items:center;justify-content:space-between;gap:10px;",
        "  padding:10px 18px;border-top:1px solid #e9ecef;background:#f8f9fa;flex-shrink:0}",
        ".kp-ftr-note{font-size:11px;color:#adb5bd;display:flex;align-items:center;gap:4px}",
        ".kp-ftr-note i{color:#e67e22}",

        "#kbPendantOpenBtn.kp-btn--active{background:#129469;color:#fff;",
        "  border-color:#129469;animation:kpPulse 1.8s ease-in-out infinite}",
        "@keyframes kpPulse{0%,100%{box-shadow:0 0 0 0 rgba(18,148,105,.4)}",
        "  50%{box-shadow:0 0 0 6px rgba(18,148,105,0)}}",
      ].join("\n");
      document.head.appendChild(s);
    }

    // Open button
    if (!document.getElementById("kbPendantOpenBtn")) {
      var btn = document.createElement("button");
      btn.id        = "kbPendantOpenBtn";
      btn.type      = "button";
      btn.className = "btn btn-secondary";
      btn.title     = "Keyboard Pendant — Shift+key Joint, Alt+key Cartesian";
      btn.innerHTML = '<i class="fas fa-keyboard"></i> Keyboard Pendant';
      btn.addEventListener("click", openModal);
      var anchor = document.getElementById("nexsimLaunchBtn");
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(btn, anchor);
      } else {
        var ha = document.querySelector(".header-actions");
        if (ha) ha.appendChild(btn);
      }
    }

    // Modal
    if (document.getElementById("kbPendantModal")) {
      modal = document.getElementById("kbPendantModal");
      return;
    }

    // Key reference rows data
    // [axis-label, posKey, negKey, joint-pos-cmd, joint-neg-cmd, cart-pos-cmd, cart-neg-cmd]
    var ROWS = [
      ["Joint 1 / CX", "q","w", "+j1","-j1", "+cx","-cx"],
      ["Joint 2 / CY", "a","s", "+j2","-j2", "+cy","-cy"],
      ["Joint 3 / CZ", "z","x", "+j3","-j3", "+cz","-cz"],
      ["Joint 4 / CR", "e","r", "+j4","-j4", "+cr","-cr"],
      ["Joint 5 / CP", "d","f", "+j5","-j5", "+cp","-cp"],
      ["Joint 6 / CW", "c","v", "+j6","-j6", "+cw","-cw"],
    ];

    function keyChip(k, mod) {
      // data-key and data-mod allow precise highlight targeting
      var cls = mod === "shift" ? "kp-key--j" : "kp-key--c";
      return '<span class="kp-key ' + cls + '" data-key="' + k + '" data-mod="' + mod + '">' +
             k.toUpperCase() + '</span>';
    }

    var refRows = ROWS.map(function (r) {
      var axis = r[0], pk = r[1], nk = r[2];
      var jPos = r[3], jNeg = r[4], cPos = r[5], cNeg = r[6];
      return '<div class="kp-ref-row">' +
        // Axis label
        '<span class="kp-axis">' + axis + '</span>' +
        // Joint column: Shift badge + pos key → cmd / neg key → cmd
        '<div class="kp-cell">' +
          '<span class="kp-mod kp-mod--j">Shift</span>' +
          keyChip(pk,"shift") +
          '<span class="kp-cmd">' + jPos + '</span>' +
          '<span class="kp-sep">/</span>' +
          keyChip(nk,"shift") +
          '<span class="kp-cmd">' + jNeg + '</span>' +
        '</div>' +
        // Cartesian column: Alt badge + pos key → cmd / neg key → cmd
        '<div class="kp-cell">' +
          '<span class="kp-mod kp-mod--c">Alt</span>' +
          keyChip(pk,"alt") +
          '<span class="kp-cmd">' + cPos + '</span>' +
          '<span class="kp-sep">/</span>' +
          keyChip(nk,"alt") +
          '<span class="kp-cmd">' + cNeg + '</span>' +
        '</div>' +
      '</div>';
    }).join("");

    modal = document.createElement("div");
    modal.id       = "kbPendantModal";
    modal.tabIndex = 0;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    modal.innerHTML =
      '<div class="kp-card">' +

        '<div class="kp-hdr">' +
          '<i class="fas fa-keyboard kp-hdr-icon"></i>' +
          '<h3 class="kp-hdr-title">Keyboard Pendant</h3>' +
          '<button class="modal-close" id="kpCloseBtnX" title="Deactivate">&times;</button>' +
        '</div>' +

        '<div class="kp-strip">' +
          '<div class="kp-row">' +
            '<span class="kp-lbl">Status</span>' +
            '<span id="kpStatus" class="kp-status kp-status--idle">Ready — hold Shift+key (joint) or Alt+key (cartesian)</span>' +
          '</div>' +
          '<div class="kp-row">' +
            '<span class="kp-lbl">Last cmd</span>' +
            '<code id="kpLastCmd" class="kp-lcmd">—</code>' +
          '</div>' +
          '<div class="kp-fs"><i class="fas fa-shield-alt"></i>' +
            'Failsafe: auto-stop after <strong style="margin:0 2px">200 ms</strong> silence' +
          '</div>' +
        '</div>' +

        '<div class="kp-ref">' +
          '<div class="kp-ref-hdr">' +
            '<span>Axis</span>' +
            '<span class="h-joint"><i class="fas fa-cogs"></i> Joint (Shift)</span>' +
            '<span class="h-cart"><i class="fas fa-arrows-alt"></i> Cartesian (Alt)</span>' +
          '</div>' +
          refRows +
        '</div>' +

        '<div class="kp-ftr">' +
          '<span class="kp-ftr-note"><i class="fas fa-exclamation-triangle"></i>' +
            'Robot moves only while modal is focused and key is held' +
          '</span>' +
          '<button class="btn btn-danger" id="kpCloseBtn">' +
            '<i class="fas fa-stop-circle"></i> Deactivate' +
          '</button>' +
        '</div>' +

      '</div>';

    document.body.appendChild(modal);

    document.getElementById("kpCloseBtnX").addEventListener("click", closeModal);
    document.getElementById("kpCloseBtn").addEventListener("click",  closeModal);

    modal.addEventListener("mousedown", function (e) {
      if (e.target === modal) closeModal();
    });

    modal.querySelector(".kp-card").addEventListener("mousedown", function (e) {
      if (e.target.tagName !== "BUTTON") setTimeout(function () { modal.focus(); }, 0);
    });

    modal.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });

    console.log("[KbPendant] ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

}());