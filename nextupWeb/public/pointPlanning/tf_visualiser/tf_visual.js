(function () {

  // ---------------------------------------------------------------
  // CONFIG — change to 'rad' if your r/p/w values are in radians
  // ---------------------------------------------------------------
  var UNITS = 'deg';

  // What does +X/+Y/+Z of this frame mean physically for the arm?
  // EDIT these three to match your actual base-frame mounting.
  var AXIS_MEANING = {
    x: 'Right',
    y: 'Fwd',
    z: 'Up'
  };

  var COLORS = {
    axisX: '#c4453b',
    axisY: '#2f9e6e',
    axisZ: '#3578b5',
    planeFill: 'rgba(53, 120, 181, 0.12)',
    planeStroke: '#b9c2cf',
    gridFill: 'rgba(20, 30, 45, 0.025)',
    gridStroke: '#dfe3e9',
    gridOutline: '#c7ccd4',
    origin: '#5a6170'
  };

  function getCalibratedPoints() {
    return points.filter(
      (p) => p.is_tf === undefined || p.is_tf === true
    );
  }

  // ---------------------------------------------------------------
  // Linear algebra: R = Rz(yaw) * Ry(pitch) * Rx(roll)
  // ---------------------------------------------------------------
  function deg2rad(d) { return (d * Math.PI) / 180; }

  function matMul(a, b) {
    var r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var i = 0; i < 3; i++) {
      for (var j = 0; j < 3; j++) {
        r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
      }
    }
    return r;
  }

  function matVec(m, v) {
    return [
      m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
      m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
      m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
    ];
  }

  function rotX(a) { var c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]; }
  function rotY(a) { var c = Math.cos(a), s = Math.sin(a); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; }
  function rotZ(a) { var c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; }

  function composeRPY(rollRaw, pitchRaw, yawRaw) {
    var roll = UNITS === 'deg' ? deg2rad(rollRaw) : rollRaw;
    var pitch = UNITS === 'deg' ? deg2rad(pitchRaw) : pitchRaw;
    var yaw = UNITS === 'deg' ? deg2rad(yawRaw) : yawRaw;
    return matMul(matMul(rotZ(yaw), rotY(pitch)), rotX(roll));
  }

  // ---------------------------------------------------------------
  // Orbit camera
  // ---------------------------------------------------------------
  function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross3(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }
  function norm3(v) {
    var len = Math.sqrt(dot3(v, v)) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
  }

  function makeProjector(azimuth, elevation) {
    var camDir = [
      Math.cos(elevation) * Math.cos(azimuth),
      Math.cos(elevation) * Math.sin(azimuth),
      Math.sin(elevation)
    ];
    var worldUp = [0, 0, 1];
    var right = norm3(cross3(worldUp, camDir));
    var up = cross3(camDir, right);

    return function (v) {
      return { x: dot3(v, right), y: -dot3(v, up) };
    };
  }

  var DEFAULT_AZIMUTH = deg2rad(45);
  var DEFAULT_ELEVATION = deg2rad(35.264);
  var ELEVATION_LIMIT = deg2rad(85);

  // ---------------------------------------------------------------
  // Draw one rotated axis triad for the currently selected point.
  // ---------------------------------------------------------------
  function drawFrame(ctx, cx, cy, R, proj, opts) {
    opts = opts || {};
    var L = opts.length;
    var colors = opts.colors || { x: COLORS.axisX, y: COLORS.axisY, z: COLORS.axisZ };
    var withArrow = opts.arrow !== false;
    var withLabel = opts.label !== false;
    var meaning = opts.meaning || null;

    function toScreen(v) { var p = proj(v); return { x: cx + p.x, y: cy + p.y }; }

    ctx.save();
    ctx.globalAlpha = opts.alpha != null ? opts.alpha : 1;

    [
      { v: [L, 0, 0], color: colors.x, label: 'X' },
      { v: [0, L, 0], color: colors.y, label: 'Y' },
      { v: [0, 0, L], color: colors.z, label: 'Z' }
    ].forEach(function (ax) {
      var end = toScreen(matVec(R, ax.v));

      ctx.setLineDash(opts.dashed ? [4, 3] : []);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(end.x, end.y);
      ctx.strokeStyle = ax.color;
      ctx.lineWidth = opts.lineWidth || 2;
      ctx.stroke();

      var dx = end.x - cx, dy = end.y - cy;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / len, uy = dy / len;

      if (withArrow) {
        ctx.setLineDash([]);
        var ah = 5;
        ctx.beginPath();
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(end.x - ah * (ux + uy * 0.5), end.y - ah * (uy - ux * 0.5));
        ctx.lineTo(end.x - ah * (ux - uy * 0.5), end.y - ah * (uy + ux * 0.5));
        ctx.closePath();
        ctx.fillStyle = ax.color;
        ctx.fill();
      }

      if (withLabel) {
        ctx.setLineDash([]);
        ctx.fillStyle = ax.color;
        ctx.font = '10px monospace';
        var suffix = meaning && meaning[ax.label.toLowerCase()] ? ' ' + meaning[ax.label.toLowerCase()] : '';
        ctx.fillText(ax.label + suffix, end.x + ux * 8, end.y + uy * 8);
      }
    });

    ctx.restore();
  }

  function drawPlane(ctx, cx, cy, R, s, proj, opts) {
    opts = opts || {};
    function toScreen(v) { var p = proj(v); return { x: cx + p.x, y: cy + p.y }; }
    var corners = [[s, s, 0], [-s, s, 0], [-s, -s, 0], [s, -s, 0]]
      .map(function (c) { return toScreen(matVec(R, c)); });

    ctx.save();
    ctx.globalAlpha = opts.alpha != null ? opts.alpha : 1;
    ctx.setLineDash(opts.dashed ? [4, 3] : []);
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (var i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    if (opts.fill) { ctx.fillStyle = opts.fill; ctx.fill(); }
    ctx.strokeStyle = opts.stroke || COLORS.planeStroke;
    ctx.lineWidth = opts.lineWidth || 1;
    ctx.stroke();
    ctx.restore();
  }

  function drawGroundPlane(ctx, cx, cy, half, proj, opts) {
    opts = opts || {};
    var n = opts.divisions || 4;
    function toScreen(v) { var p = proj(v); return { x: cx + p.x, y: cy + p.y }; }

    var corners = [[half, half, 0], [-half, half, 0], [-half, -half, 0], [half, -half, 0]]
      .map(toScreen);

    ctx.save();
    ctx.globalAlpha = opts.alpha != null ? opts.alpha : 1;

    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (var i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    if (opts.fill) { ctx.fillStyle = opts.fill; ctx.fill(); }

    ctx.setLineDash([]);
    ctx.strokeStyle = opts.gridStroke || COLORS.gridStroke;
    ctx.lineWidth = 1;
    for (var j = 0; j <= n; j++) {
      var t = -half + (2 * half) * j / n;
      var p1 = toScreen([-half, t, 0]);
      var p2 = toScreen([half, t, 0]);
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
      var q1 = toScreen([t, -half, 0]);
      var q2 = toScreen([t, half, 0]);
      ctx.beginPath(); ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y); ctx.stroke();
    }

    ctx.lineWidth = 1.2;
    ctx.strokeStyle = opts.outlineStroke || COLORS.gridOutline;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (var k = 1; k < corners.length; k++) ctx.lineTo(corners[k].x, corners[k].y);
    ctx.closePath();
    ctx.stroke();

    ctx.restore();
  }

  // ---------------------------------------------------------------
  // Render one widget. coordinate = { r, p, w }.
  // Reference plane is always shown now (the checkbox was removed).
  // ---------------------------------------------------------------
function drawOrientation(canvas, coordinate, opts) {
    opts = opts || {};
    var detailed = opts.detailed !== false;
    var azimuth = opts.azimuth != null ? opts.azimuth : DEFAULT_AZIMUTH;
    var elevation = opts.elevation != null ? opts.elevation : DEFAULT_ELEVATION;
    var proj = makeProjector(azimuth, elevation);

    var dpr = window.devicePixelRatio || 1;
    var size = canvas.clientWidth || canvas.width || 140;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    var cx = size / 2, cy = size / 2;
    var L = size * 0.34;
    var s = L * 0.55;

    drawGroundPlane(ctx, cx, cy, s * 1.7, proj, {
      fill: COLORS.gridFill,
      gridStroke: COLORS.gridStroke,
      outlineStroke: COLORS.gridOutline,
      divisions: 4
    });

    // --- NEW: static base/reference frame axes (identity rotation) ---
    var IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    drawFrame(ctx, cx, cy, IDENTITY, proj, {
      length: L * 1.15,     // slightly longer so it pokes out past the point's frame
      arrow: detailed,
      label: detailed,
      dashed: true,
      lineWidth: 1.5,
      alpha: 0.55,
      colors: { x: COLORS.axisX, y: COLORS.axisY, z: COLORS.axisZ }
    });
    // -------------------------------------------------------------

    var R = composeRPY(coordinate.r || 0, coordinate.p || 0, coordinate.w || 0);
    drawPlane(ctx, cx, cy, R, s, proj, { fill: COLORS.planeFill, stroke: COLORS.planeStroke });
    drawFrame(ctx, cx, cy, R, proj, {
      length: L,
      arrow: detailed,
      label: detailed
      // meaning: detailed ? AXIS_MEANING : null
    });

    var origin = (function (v) { var p = proj(v); return { x: cx + p.x, y: cy + p.y }; })([0, 0, 0]);
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.origin;
    ctx.fill();
  }

  // ---------------------------------------------------------------
  // Page wiring
  // ---------------------------------------------------------------
  var activeIndex = 0;
  var camAzimuth = DEFAULT_AZIMUTH;
  var camElevation = DEFAULT_ELEVATION;

  // ---- Locked-view persistence ------------------------------------
  var LOCK_STORAGE_KEY = 'tfOrientLockedView';
  var locked = false;

  function loadSavedView() {
    try {
      var raw = localStorage.getItem(LOCK_STORAGE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (typeof saved.azimuth === 'number') camAzimuth = saved.azimuth;
      if (typeof saved.elevation === 'number') camElevation = saved.elevation;
      locked = !!saved.locked;
    } catch (e) {
      // corrupt or unavailable storage — fall back to defaults silently
    }
  }

  function persistView() {
    try {
      localStorage.setItem(LOCK_STORAGE_KEY, JSON.stringify({
        azimuth: camAzimuth,
        elevation: camElevation,
        locked: locked
      }));
    } catch (e) {
      // e.g. private browsing / quota exceeded — view just won't persist
    }
  }

  function updateLockUI() {
    var btn = document.getElementById('tfLockToggle');
    var resetBtn = document.getElementById('tfResetView');
    var canvas = document.getElementById('tfMainCanvas');
    var container = document.getElementById('tfCanvasContainer');
    if (!btn || !resetBtn || !canvas) return;
    btn.textContent = locked ? '🔒' : '🔓';
    btn.title = locked ? 'Unlock view' : 'Lock current view';
    btn.classList.toggle('active', locked);
    resetBtn.disabled = locked;
    canvas.classList.toggle('locked', locked);
    if (container) container.classList.toggle('locked', locked); // NEW
  }

  function renderMain(updateFrame) {
    var canvas = document.getElementById('tfMainCanvas');
    var calibratedPoints = getCalibratedPoints();
    var point = calibratedPoints[activeIndex] || calibratedPoints[0];

    if (!point) {
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      document.getElementById('tfMainRPW').innerHTML =
        '<span style="opacity:.6">No TF points</span>';
      return;
    }

    if (updateFrame) {
      setTFFrame(point.name);
    }

    drawOrientation(canvas, point.coordinate, {
      showBase: true, detailed: true,
      azimuth: camAzimuth, elevation: camElevation
    });

    var unit = UNITS === 'deg' ? '\u00B0' : 'rad';
    document.getElementById('tfMainRPW').innerHTML =
      '<span class="tf-legend-hint"><i class="swatch dashed"></i>ref &nbsp;<i class="swatch"></i>pt</span>' +
      '<span>r=<b>' + point.coordinate.r + unit + '</b></span>' +
      '<span>p=<b>' + point.coordinate.p + unit + '</b></span>' +
      '<span>w=<b>' + point.coordinate.w + unit + '</b></span>';
  }

  function buildPointSelect() {
    var select = document.getElementById('tfPointSelect');
    select.innerHTML = '';

    var calibratedPoints = getCalibratedPoints();

    if (calibratedPoints.length === 0) {
      var opt = document.createElement('option');
      opt.textContent = 'No TF points';
      opt.disabled = true;
      select.appendChild(opt);
      select.disabled = true;
      activeIndex = 0;
      return;
    }

    select.disabled = false;
    calibratedPoints.forEach(function (p, idx) {
      var opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = p.name || ('point ' + idx);
      select.appendChild(opt);
    });

    if (activeIndex >= calibratedPoints.length) {
      activeIndex = 0;
    }
    select.value = activeIndex;

    select.onchange = function (e) {
      activeIndex = parseInt(e.target.value, 10);
      renderMain(true);
    };
  }

  // ---------------------------------------------------------------
  // Drag-to-orbit: mouse + touch. Disabled entirely while locked.
  // ---------------------------------------------------------------
  function setupOrbitControls() {
    var canvas = document.getElementById('tfMainCanvas');
    var dragging = false;
    var lastX = 0, lastY = 0;
    var SENSITIVITY = 0.008;

    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

    function dragStart(x, y) {
      if (locked) return;
      dragging = true;
      lastX = x; lastY = y;
      canvas.classList.add('dragging');
    }
    function dragMove(x, y) {
      if (!dragging || locked) return;
      var dx = x - lastX, dy = y - lastY;
      lastX = x; lastY = y;
      camAzimuth -= dx * SENSITIVITY;
      camElevation = clamp(camElevation + dy * SENSITIVITY, -ELEVATION_LIMIT, ELEVATION_LIMIT);
      renderMain(false);
    }
    function dragEnd() {
      dragging = false;
      canvas.classList.remove('dragging');
    }

    canvas.addEventListener('mousedown', function (e) { dragStart(e.clientX, e.clientY); });
    window.addEventListener('mousemove', function (e) { dragMove(e.clientX, e.clientY); });
    window.addEventListener('mouseup', dragEnd);

    canvas.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      dragStart(t.clientX, t.clientY);
    }, { passive: true });
    canvas.addEventListener('touchmove', function (e) {
      var t = e.touches[0];
      dragMove(t.clientX, t.clientY);
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchend', dragEnd);

    document.getElementById('tfResetView').addEventListener('click', function () {
      if (locked) return;
      camAzimuth = DEFAULT_AZIMUTH;
      camElevation = DEFAULT_ELEVATION;
      renderMain(false);
    });

    document.getElementById('tfLockToggle').addEventListener('click', function () {
      locked = !locked;
      persistView();
      updateLockUI();
    });
  }

  function setupResponsiveRedraw() {
    var resizeTimeout;

    function handleResize() {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(function () {
        var canvas = document.getElementById('tfMainCanvas');
        if (canvas && canvas.offsetParent !== null) {
          renderMain(false);
        }
      }, 100);
    }

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', handleResize);
      return;
    }

    var canvas = document.getElementById('tfMainCanvas');
    var ro = new ResizeObserver(function () {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(function () {
        if (canvas && canvas.offsetParent !== null) {
          renderMain(false);
        }
      }, 50);
    });
    ro.observe(canvas);
  }

  function setupVisibilityDetection() {
    var root = document.querySelector('.tf-orient-root');
    if (!root) return;

    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        if (mutation.attributeName === 'style' || mutation.attributeName === 'class') {
          var canvas = document.getElementById('tfMainCanvas');
          if (canvas && canvas.offsetParent !== null) {
            renderMain(false);
          }
        }
      });
    });

    observer.observe(root, { attributes: true, attributeFilter: ['style', 'class'] });
  }

  // Exposed API, e.g.:
  //   TFOrientationWidget.render(canvasEl, point, {})
  //   TFOrientationWidget.init() — call once your `points` array is populated
  window.TFOrientationWidget = {
    render: function (canvas, pointOrRPW, opts) {
      var c = pointOrRPW.coordinate || pointOrRPW;
      drawOrientation(canvas, c, opts);
    },
    setUnits: function (u) { UNITS = u; },
    init: function () {
      buildPointSelect();
      renderMain(false);
    }
  };

  loadSavedView();
  setupOrbitControls();
  setupResponsiveRedraw();
  setupVisibilityDetection();
  updateLockUI();
})();