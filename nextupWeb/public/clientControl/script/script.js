// ============================================================
// clientControl.js
// All ROS communication goes through window.parent.postMessage
// MainWeb.js forwards messages to/from the backend WebSocket
// ============================================================

// ============================================================
// HELPERS
// ============================================================

function sendToParent(msg) {
    window.parent.postMessage(msg, "*");
}

// ============================================================
// GLOBAL STATE
// ============================================================
const rc_countdownTime = 3000; // total countdown time in ms

let currentSpeedScale = 0.1;
let allJointsOp = false;
let processState = "stopped";

// Define these variables globally so they're accessible throughout
let processToggle;
let processIndicator;
let startBtn;
let exitBtn;
let stopBtn;

// ============================================================
// INBOUND MESSAGE ROUTER
// (MainWeb.js forwards all WS messages to iframes via postMessage)
// ============================================================

// ============================================================
// GPIO (dynamic groups) — DI + DO matrix, publish-confirm for DO
// ============================================================
const GPIO_CHANNELS_PER_GROUP = 8;
const gpioGroupOrder = [];
const gpioGroupsSeen = {};   // groupName -> { seenDi: Set, seenDo: Set }
const gpioDiState = {};      // "group::diN" -> bool
const gpioDoState = {};      // "group::doN" -> 0/1 (from GPIO_PUBLISH_CONFIRM only)
const gpioCmdPending = {};   // "group::doN" -> value we sent, cleared on matching confirm

function gpioEnsureGroupTracked(name) {
    if (gpioGroupsSeen[name]) return;
    gpioGroupsSeen[name] = { seenDi: new Set(), seenDo: new Set() };
    gpioGroupOrder.push(name);
}

function renderGpioGroups() {
    const host = document.getElementById('gpioGroups');
    if (!host) return;
    host.innerHTML = '';
    if (gpioGroupOrder.length === 0) {
        host.innerHTML = '<div class="gp-empty">Waiting for GPIO state…</div>';
        return;
    }
    host.appendChild(buildGpioMatrix('di'));
    host.appendChild(buildGpioMatrix('do'));
}

function buildGpioMatrix(kind) {
    const isDo = kind === 'do';
    const wrap = document.createElement('div');
    wrap.className = 'gp-matrix-wrap';

    const head = document.createElement('div');
    head.className = 'gp-matrix-head';
    head.textContent = isDo ? 'GPIO Digital Outputs' : 'GPIO Digital Inputs';
    wrap.appendChild(head);

    const table = document.createElement('table');
    table.className = 'gp-matrix-table';

    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    htr.appendChild(Object.assign(document.createElement('th'), { textContent: 'Group' }));
    for (let n = 1; n <= GPIO_CHANNELS_PER_GROUP; n++) {
        htr.appendChild(Object.assign(document.createElement('th'), { textContent: (isDo ? 'DO' : 'DI') + n }));
    }
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    gpioGroupOrder.forEach(g => {
        const tr = document.createElement('tr');
        const label = document.createElement('td');
        label.innerHTML = `<b>${g}</b>`;
        tr.appendChild(label);
        for (let n = 1; n <= GPIO_CHANNELS_PER_GROUP; n++) {
            const td = document.createElement('td');
            td.appendChild(isDo ? buildGpioDoCell(g, n) : buildGpioDiCell(g, n));
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
}

function buildGpioDiCell(g, n) {
    const led = document.createElement('span');
    led.className = 'di-indicator-light';
    led.dataset.gpDi = '1';
    led.dataset.group = g;
    led.dataset.n = n;
    return led;
}

function buildGpioDoCell(g, n) {
    const container = document.createElement('div');
    container.className = 'do-toggle-container';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'do-toggle';
    toggle.dataset.gpDoToggle = '1';
    toggle.dataset.group = g;
    toggle.dataset.n = n;
    toggle.addEventListener('change', (e) => sendGpioDOCommand(g, n, e.target.checked));

    const led = document.createElement('span');
    led.className = 'do-indicator';
    led.dataset.gpDoLed = '1';
    led.dataset.group = g;
    led.dataset.n = n;

    container.appendChild(toggle);
    container.appendChild(led);
    return container;
}

function sendGpioDOCommand(group, channel, value) {
    const key = `${group}::do${channel}`;
    gpioCmdPending[key] = value ? 1 : 0;
    sendToParent({
        type: "GPIO_COMMAND",
        payload: { group, channel: parseInt(channel, 10), value: Boolean(value) }
    });
}

function requestGpioState() {
    sendToParent({ type: "REQUEST_GPIO_STATE", payload: { timestamp: Date.now() } });
}

function handleGpioStateMsg(payload) {
    const groups = (payload && payload.groups) || {};
    let structureChanged = false;

    Object.keys(groups).forEach(g => {
        const existed = !!gpioGroupsSeen[g];
        gpioEnsureGroupTracked(g);
        if (!existed) structureChanged = true;
        const track = gpioGroupsSeen[g];

        Object.entries(groups[g].di || {}).forEach(([n, v]) => {
            const num = Number(n);
            if (!track.seenDi.has(num)) { track.seenDi.add(num); structureChanged = true; }
            gpioDiState[`${g}::di${num}`] = !!v;
            document.querySelectorAll('.di-item[data-kind="gpio"]').forEach(item => {

                if (
                    item.dataset.gpio === g &&
                    item.dataset.diId === String(num)
                ) {
                    item.querySelector(".di-indicator")
                        ?.classList.toggle("active", !!v);
                }

            });
        });
        Object.entries(groups[g].do || {}).forEach(([n, v]) => {
            const num = Number(n);
            if (!track.seenDo.has(num)) { track.seenDo.add(num); structureChanged = true; }
            const vNum = v ? 1 : 0;
            const key = `${g}::do${num}`;
            if (gpioCmdPending[key] === undefined) gpioDoState[key] = vNum;
        });
    });

    if (structureChanged) renderGpioGroups();
    updateGpioValuesOnly();
    refreshDynamicGPIO_DI();
    refreshDynamicGPIO_DO();
}

function handleGpioPublishConfirm(payload) {
    const { group, do: doPatch } = payload || {};
    if (!group || !doPatch) return;
    Object.entries(doPatch).forEach(([n, v]) => {
        const key = `${group}::do${n}`;
        const vNum = v ? 1 : 0;
        if (gpioCmdPending[key] === vNum) delete gpioCmdPending[key];
        gpioDoState[key] = vNum;
        document.querySelectorAll('.do-item[data-kind="gpio"]').forEach(item => {

            if (
                item.dataset.gpio === group &&
                item.dataset.doId === String(n)
            ) {

                const toggle = item.querySelector(".switch-input");

                if (toggle)
                    toggle.checked = Boolean(vNum);
            }

        });
    });
    updateGpioValuesOnly();
    refreshDynamicGPIO_DI();
    refreshDynamicGPIO_DO();
}
function refreshDynamicGPIO_DI() {
    document.querySelectorAll('.di-item[data-kind="gpio"]').forEach(item => {

        const key = `${item.dataset.gpio}::di${item.dataset.diId}`;

        item.querySelector(".di-indicator")
            ?.classList.toggle("active", !!gpioDiState[key]);
    });
}

function refreshDynamicGPIO_DO() {
    document.querySelectorAll('.do-item[data-kind="gpio"]').forEach(item => {

        const key = `${item.dataset.gpio}::do${item.dataset.doId}`;

        const toggle = item.querySelector(".switch-input");

        if (toggle)
            toggle.checked = !!gpioDoState[key];
    });
}
function updateGpioValuesOnly() {
    const host = document.getElementById('gpioGroups');
    if (!host) return;

    host.querySelectorAll('[data-gp-di]').forEach(led => {
        const key = `${led.dataset.group}::di${led.dataset.n}`;
        const known = gpioGroupsSeen[led.dataset.group]?.seenDi.has(Number(led.dataset.n));
        led.classList.toggle('on', !!gpioDiState[key]);
        led.classList.toggle('stale', !known);
    });
    host.querySelectorAll('[data-gp-do-led]').forEach(led => {
        const key = `${led.dataset.group}::do${led.dataset.n}`;
        led.classList.toggle('on', !!gpioDoState[key]);
    });
    host.querySelectorAll('[data-gp-do-toggle]').forEach(t => {
        const key = `${t.dataset.group}::do${t.dataset.n}`;
        const isOn = !!gpioDoState[key];
        if (t.checked !== isOn) t.checked = isOn;
    });
}

window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || !msg.type) return;

    switch (msg.type) {
        case "DRIVER_STATUS":
            handleDriverStatus(msg.payload);
            break;
        case "JOINT_STATUS":
            handleJointStatus(msg.payload);
            break;
        case "DI_STATUS":
            updateDIStatusFromBackend(msg.payload);
            break;

        case "GPIO_STATE":
            handleGpioStateMsg(msg.payload);
            break;
        case "GPIO_PUBLISH_CONFIRM":
            handleGpioPublishConfirm(msg.payload);
            break;
        case "DO_STATUS":
            handleDOStatus(msg.payload);
            break;

        case "CONTROL_ACTIVE":
            setStartButtonsEnabled(msg.payload);
            break;

        case "ACTION_RESULT":
            // start_bt (Auto) sequence finished — re-enable the start buttons.
            if (msg.payload?.action === "start_bt") {
                if (window.__startBtSafetyTimer) { clearTimeout(window.__startBtSafetyTimer); window.__startBtSafetyTimer = null; }
                window.setStartButtonsEnabled?.(true);
                if (!msg.payload.ok && typeof showStartBlockedModal === "function") {
                    showStartBlockedModal([`Start failed: ${msg.payload.message || "Auto switch failed"}`]);
                }
            }
            break;

        case "PROCESS_STATUS":
            const payloadText =
                typeof msg.payload === "string"
                    ? msg.payload
                    : JSON.stringify(msg.payload || "");

            const firstWord = payloadText.trim().split(/\s+/)[0].toLowerCase();

            if (firstWord === "running") {
                processState = "running";
                if (processToggle) processToggle.classList.add("active");
                if (processIndicator) processIndicator.classList.add("running");
            } else if (firstWord === "stopped") {
                processState = "stopped";
                if (processToggle) processToggle.classList.remove("active");
                if (processIndicator) processIndicator.classList.remove("running");
                setTimeout(() => {
                    if (startBtn) {
                        startBtn.classList.add("btn-disabled");
                    }
                    // if (runonceBtn) {
                    //     runonceBtn.classList.add("btn-disabled");
                    // }
                }, 1000);
            }
            break;

        case "CYCLE_TIME":
            const deltaSec = msg.payload;

            // ✅ COUNT FIX (ADD THIS LINE)
            handleCycleIncrement();

            // ✅ EXISTING TIME LOGIC
            if (deltaSec > 0 && deltaSec < 300) {
                if (lastCycleEl) lastCycleEl.textContent = deltaSec.toFixed(3);

                sum5 = pushToBuffer(recent5, deltaSec, 5, sum5);
                sum15 = pushToBuffer(recent15, deltaSec, 15, sum15);

                if (avg5El) avg5El.textContent = (sum5 / recent5.length).toFixed(3);
                if (avg15El) avg15El.textContent = (sum15 / recent15.length).toFixed(3);
            }
            break;
    }
});

// ============================================================
// CNC START GATE LOGIC + TEST OVERRIDE
// ============================================================

const DEBUG_CNC_START = false;
const logOnce = (...args) => DEBUG_CNC_START && console.log("[CNC-START]", ...args);

let cncFaultActive = false;
let cncAutoMode = false;

let useOverride = false;
let overrideAllJointsOp = true;
let overrideCncFault = false;
let overrideCncAutoMode = true;

// CNC fault / auto mode come from DI_STATUS (driver 2, di3 & di4)
// Parsed inside updateDIStatusFromBackend — see DI STATUS section below



function getEffectiveStates() {
    return {
        jointsOp: useOverride ? overrideAllJointsOp : allJointsOp,
        cncFault: useOverride ? overrideCncFault : cncFaultActive,
        cncAuto: useOverride ? overrideCncAutoMode : cncAutoMode,
    };
}

function canRobotStart() {
    // const { jointsOp, cncFault, cncAuto } = getEffectiveStates();
    const jointsOp = true;
    const cncFault = false;
    const cncAuto = true;
    const issues = [];

    if (!jointsOp) issues.push("One or more robot joints are NOT operational");
    if (cncFault) issues.push("CNC alarm / fault is active");
    if (!cncAuto) issues.push("CNC is NOT in AUTO mode");

    return { allowed: issues.length === 0, issues };
}

function showStartBlockedModal(issues) {
    const modal = document.getElementById("start-blocked-modal");
    const list = document.getElementById("start-blocked-list");
    if (!modal || !list) return;

    list.innerHTML = "";
    issues.forEach(issue => {
        const li = document.createElement("li");
        li.textContent = issue;
        list.appendChild(li);
    });
    modal.classList.add("show");
}

function closeStartBlockedModal() {
    document.getElementById("start-blocked-modal")?.classList.remove("show");
}

function openOverrideModal() {
    document.getElementById("override-modal")?.classList.add("show");
    document.getElementById("override-enable").checked = useOverride;
    document.getElementById("override-joints").checked = overrideAllJointsOp;
    document.getElementById("override-fault").checked = overrideCncFault;
    document.getElementById("override-auto").checked = overrideCncAutoMode;
}

function closeOverrideModal() {
    document.getElementById("override-modal")?.classList.remove("show");
}

function applyOverrides() {
    useOverride = document.getElementById("override-enable").checked;
    overrideAllJointsOp = document.getElementById("override-joints").checked;
    overrideCncFault = document.getElementById("override-fault").checked;
    overrideCncAutoMode = document.getElementById("override-auto").checked;
    closeOverrideModal();
}

// Make setStartButtonsEnabled globally accessible
window.setStartButtonsEnabled = function (enabled) {
    [startBtn].forEach(btn => {
        if (!btn) return;
        btn.disabled = !enabled;
        btn.classList.toggle("btn-disabled", !enabled);
    });
};

// ============================================================
// SPEED / MODE / CNC SETTINGS
// ============================================================

const lowBtn = document.getElementById("mode-low");
const highBtn = document.getElementById("mode-high");
const productionBtn = document.getElementById("mode-production");
const slider = document.getElementById("speed-slider");
const speedValue = document.getElementById("speed-value");
const cncButtons = document.querySelectorAll(".cnc-btn");

let settings = { mode: "testing", speed: 0.1, cnc: "none" };

function publishSpeed(value) {
    sendToParent({
        type: "UI_COMMANDS",
        payload: { command: "set_speed", value: parseFloat(value) },
    });
}

function publishCNC(selection) {
    sendToParent({
        type: "UI_COMMANDS",
        payload: { command: "select_cnc", value: selection },
    });
}

async function loadSettings() {
    try {
        const res = await fetch("/settings");
        const data = await res.json();
        settings = data;
        applySettings();
        publishSpeed(settings.speed);
        publishCNC(settings.cnc);
    } catch (err) {
        console.error("Failed to load settings:", err);
    }
}

async function saveSettings() {
    try {
        await fetch("/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(settings),
        });
    } catch (err) {
        console.error("Failed to save settings:", err);
    }
}

function applySettings() {
    [lowBtn, highBtn, productionBtn].forEach(b => b?.classList.remove("active"));

    if (settings.mode === "low_testing") {
        lowBtn?.classList.add("active");
        if (slider) slider.disabled = true;
        if (slider) slider.min = 0.01;
        if (slider) slider.max = 0.20;
        currentSpeedScale = 0.1;
    } else if (settings.mode === "high_testing") {
        highBtn?.classList.add("active");
        if (slider) slider.disabled = false;
        if (slider) slider.min = 0.50;
        if (slider) slider.max = 0.90;
        currentSpeedScale = settings.speed;
    } else if (settings.mode === "production") {
        productionBtn?.classList.add("active");
        if (slider) slider.disabled = true;
        currentSpeedScale = 0.0;
    }

    if (slider) slider.value = currentSpeedScale;
    if (speedValue) speedValue.textContent = currentSpeedScale.toFixed(2);
    publishSpeed(currentSpeedScale);
}

lowBtn?.addEventListener("click", () => {
    settings.mode = "low_testing";
    settings.speed = 0.1;
    applySettings();
    saveSettings();
});

highBtn?.addEventListener("click", () => {
    settings.mode = "high_testing";
    if (settings.speed < 0.5) settings.speed = 0.5;
    applySettings();
    saveSettings();
});

productionBtn?.addEventListener("click", () => {
    settings.mode = "production";
    settings.speed = 0.0;
    applySettings();
    saveSettings();
});

slider?.addEventListener("input", () => {
    if (settings.mode !== "high_testing") return;
    settings.speed = parseFloat(slider.value);
    currentSpeedScale = settings.speed;
    if (speedValue) speedValue.textContent = currentSpeedScale.toFixed(2);
    saveSettings();
    publishSpeed(currentSpeedScale);
});

cncButtons.forEach(btn => {
    btn?.addEventListener("click", () => {
        cncButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        settings.cnc = btn.textContent.trim();
        saveSettings();
        publishCNC(settings.cnc);
    });
});

loadSettings();

// ============================================================
// CYCLE COUNTERS
// ============================================================

const currentEl = document.getElementById("current-operation");
const lastSessionEl = document.getElementById("last-session");
const totalEl = document.getElementById("total-operation");
const resetBtn = document.getElementById("reset-total");

let currentCount = 0;
let lastCount = 0;
let lastSession = 0;
let totalOperations = 0;

async function loadCycleSettings() {
    try {
        const res = await fetch("/settings");
        const data = await res.json();
        lastSession = data.last_session_operations || 0;
        totalOperations = data.total_operations || 0;
        updateCycleUI();
    } catch (err) {
        console.error("Error loading cycle settings:", err);
    }
}

async function saveCycleSettings() {
    try {
        const res = await fetch("/settings");
        const data = await res.json();
        data.total_operations = totalOperations;
        data.last_session_operations = lastSession;
        await fetch("/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
    } catch (err) {
        console.error("Error saving cycle data:", err);
    }
}

function handleCycleIncrement() {
    currentCount++;
    totalOperations++;
    lastCount = currentCount;
    updateCycleUI();
    saveCycleSettings();
}

function updateCycleUI() {
    if (currentEl) currentEl.textContent = currentCount;
    if (lastSessionEl) lastSessionEl.textContent = lastSession;
    if (totalEl) totalEl.textContent = totalOperations;
}

resetBtn?.addEventListener("click", async () => {
    try {
        await fetch("/cycle/reset");
        totalOperations = 0;
        updateCycleUI();
    } catch (err) {
        console.error("Failed to reset total:", err);
    }
});

loadCycleSettings();

// ============================================================
// CYCLE TIMES
// ============================================================

const lastCycleEl = document.getElementById("last-cycle-time");
const avg5El = document.getElementById("avg-5");
const avg15El = document.getElementById("avg-15");

const recent5 = [], recent15 = [];
let sum5 = 0, sum15 = 0;

function pushToBuffer(buffer, newValue, maxSize, currentSum) {
    if (buffer.length >= maxSize) currentSum -= buffer.shift();
    buffer.push(newValue);
    return currentSum + newValue;
}

// ============================================================
// JOINT STATUS
// ============================================================

function handleJointStatus(msg) {
    if (!msg || !msg.name || !msg.op_status) return;

    const jointOrder = ["joint1", "joint2", "joint3", "joint4", "joint5", "joint6"];

    const jointOps = jointOrder.map(name => {
        const index = msg.name.indexOf(name);
        return index !== -1 ? Boolean(msg.op_status[index]) : false;
    });

    let allActive = true;

    jointOps.forEach((active, i) => {
        const el = document.getElementById(`joint${i + 1}`);
        if (!el) return;
        el.classList.toggle("green", active);
        el.classList.toggle("red", !active);
        if (!active) allActive = false;
    });

    allJointsOp = allActive;

    const overallIndicator = document.getElementById("joint-overall-indicator");
    if (overallIndicator) {
        overallIndicator.classList.toggle("green", allActive);
        overallIndicator.classList.toggle("red", !allActive);
        overallIndicator.title = allActive
            ? "All joints OPERATION_ENABLED"
            : "One or more joints not operational";
    }
}

// DRIVER_STATUS comes from the backend (rosService.js → wsServer → MainWeb → iframe)
function handleDriverStatus(data) {
    if (!data) return;
    const { jointStatus } = data;
    if (!jointStatus) return;

    const allActive = jointStatus.every(Boolean);
    allJointsOp = allActive;

    jointStatus.forEach((active, i) => {
        const el = document.getElementById(`joint${i + 1}`);
        if (!el) return;
        el.classList.toggle("green", active);
        el.classList.toggle("red", !active);
    });

    const overallIndicator = document.getElementById("joint-overall-indicator");
    if (overallIndicator) {
        overallIndicator.classList.toggle("green", allActive);
        overallIndicator.classList.toggle("red", !allActive);
    }
}

// ============================================================
// ROBOT CONTROL (START / EXIT / RUN ONCE)
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
    renderGpioGroups();
    setTimeout(requestGpioState, 500);
    setInterval(requestGpioState, 5000);
});


document.addEventListener("DOMContentLoaded", () => {

    // Initialize global references
    startBtn = document.getElementById("start-btn");
    const exitBtn = document.getElementById("exit-btn");
    stopBtn = document.getElementById("stop-btn");
    processToggle = document.querySelector(".process-toggle");
    processIndicator = document.querySelector(".process-status-indicator");

    if (!startBtn || !exitBtn || !stopBtn) {
        console.error("❌ One or more control buttons not found");
        return;
    }

    // Disabled until backend confirms BT is ready
    setTimeout(() => {
        if (startBtn) {
            startBtn.classList.add("btn-disabled");
            startBtn.disabled = true;
        }
        // if (runonceBtn) {
        //     runonceBtn.classList.add("btn-disabled");
        //     runonceBtn.disabled = true;
        // }
    }, 1500);

    // Listen for MOTION_ACTIVE from backend
    window.addEventListener("message", (event) => {
        const msg = event.data;
        if (!msg) return;
        if (msg.type === "CONTROL_ACTIVE") {
            setStartButtonsEnabled(msg.payload);
        }
    });

    function publishSpeedBeforeStart() {
        publishSpeed(currentSpeedScale);
    }

    startBtn.addEventListener("click", () => {
        console.log("starting robot — server sequences change_mode -> overspeed -> start_bt");

        if (startBtn.disabled) return;
        const { allowed, issues } = canRobotStart();
        if (!allowed) { showStartBlockedModal(issues); return; }

        publishSpeedBeforeStart();

        window.setStartButtonsEnabled?.(false);
        if (window.__startBtSafetyTimer) clearTimeout(window.__startBtSafetyTimer);
        window.__startBtSafetyTimer = setTimeout(() => window.setStartButtonsEnabled?.(true), 8000);

        sendToParent({ type: "UI_COMMANDS", payload: { command: "start_bt" } });
        console.log("publish bhi krdiya");

        // Visual-only countdown, runs in parallel with the server sequence above.
        rc_countdown();
    });

    exitBtn.addEventListener("click", () => {
        // if (runonceBtn.disabled) return;
        // const { allowed, issues } = canRobotStart();
        // if (!allowed) { showStartBlockedModal(issues); return; }

        // publishSpeedBeforeStart();
        // start_bt sets Auto (mode 8 + overspeed 6000) THEN starts the BT.
        // window.setStartButtonsEnabled?.(false);
        // if (window.__startBtSafetyTimer) clearTimeout(window.__startBtSafetyTimer);
        // window.__startBtSafetyTimer = setTimeout(() => window.setStartButtonsEnabled?.(true), 6000);
        // sendToParent({ type: "UI_COMMANDS", payload: { command: "start_bt" } });
        // setTimeout(() => {
        sendToParent({ type: "UI_COMMANDS", payload: { command: "control_exit_bt", value: true } });
        console.log("exit command sent to backend");
        // }, rc_countdownTime);
    });

    stopBtn.addEventListener("click", () => {
        sendToParent({ type: "UI_COMMANDS", payload: { command: "control_reset_bt", value: true } });
    });

    // --- Process Toggle ---
    processToggle?.addEventListener("click", () => {
        if (processState === "running") {
            processState = "stopped";
            processToggle.classList.remove("active");
            sendToParent({ type: "UI_COMMANDS", payload: { command: "process_control", value: "stop" } });
        } else {
            processState = "running";
            processToggle.classList.add("active");
            sendToParent({ type: "UI_COMMANDS", payload: { command: "process_control", value: "start" } });
        }
    });
});

// ============================================================
// DI STATUS
// ============================================================

const INDEX_MAP = { di1: 0, di2: 1, di3: 2, di4: 3, di5: 4, sto1: 5, sto2: 6, edm: 7 };
const DRV2_IDX = 1; // driver 2 = array index 1

function updateDIStatusFromBackend(payload) {
    // Extract CNC signals from driver 2 (index 1), di3 & di4
    if (Array.isArray(payload) && payload[DRV2_IDX]) {
        cncFaultActive = Boolean(payload[DRV2_IDX][INDEX_MAP.di3]);
        cncAutoMode = Boolean(payload[DRV2_IDX][INDEX_MAP.di4]);
    }

    // Update indicator elements
    document.querySelectorAll(".di-item").forEach(item => {
        const driver = parseInt(item.dataset.driver, 10);
        const diKey = item.dataset.diKey;
        const indicator = item.querySelector(".di-indicator");
        if (!indicator) return;

        const driverData = payload[driver - 1];
        if (!driverData) return;

        const index = INDEX_MAP[diKey];
        const isActive = driverData[index];
        indicator.classList.toggle("active", Boolean(isActive));
    });
}

// ============================================================
// DO STATUS HANDLER
// ============================================================

function handleDOStatus(payload) {
    const { driver, do1, do2, do3, do4 } = payload;

    const updates = { 1: do1, 2: do2, 3: do3, 4: do4 };

    document.querySelectorAll('.do-item[data-kind="driver"]').forEach(item => {
        const itemDriver = parseInt(item.dataset.driver, 10);
        if (itemDriver !== driver) return;

        const rawDoId = item.dataset.doId;                          // "1", "2", "3", "pi_p"
        const normalizedId = rawDoId === "pi_p" ? 4 : parseInt(rawDoId, 10);

        if (!(normalizedId in updates)) return;
        if (updates[normalizedId] === undefined) return;            // field not in this message

        const toggle = item.querySelector(".switch-input");
        if (toggle) toggle.checked = Boolean(updates[normalizedId]);
    });
}

// ============================================================
// HELPER FUNCTIONS FOR DI AND DO
// ============================================================

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function mapDiIdToKey(diId) {
    const mapping = {
        "1": "di1", "2": "di2", "3": "di3", "4": "di4",
        "5": "di5", "6": "sto1", "7": "sto2", "8": "edm"
    };
    return mapping[diId] || `di${diId}`;
}

function createDISafeId(name, driverId, diId) {
    return `di_${name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase()}_${driverId}_${diId}`;
}

function createDOSafeId(name, driverId, doId) {
    return `do_${name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase()}_${driverId}_${doId}`;
}

// Update counter with animation
function updateCounter(counterElement, count) {
    if (!counterElement) return;
    const oldText = counterElement.textContent;
    const newText = `(${count} item${count !== 1 ? 's' : ''})`;

    if (oldText !== newText) {
        counterElement.textContent = newText;
        counterElement.classList.add('update');
        setTimeout(() => {
            counterElement.classList.remove('update');
        }, 300);
    }
}

// ============================================================
// DI STATUS - Simple Grid Layout with Counter
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
    const diContainer = document.getElementById("di-container");
    const diCounter = document.getElementById("di-counter");

    // Remove edit button if it exists
    const existingEditBtn = document.querySelector("#di-status .edit-layout-btn");
    if (existingEditBtn) existingEditBtn.remove();

    async function loadDIList() {
        if (!diContainer) return;

        try {
            const res = await fetch("/ros/di-list");
            const json = await res.json();
            console.log(json)

            // Clear container
            diContainer.innerHTML = "";

            if (!json.data || json.data.length === 0) {
                diContainer.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px;">No DI devices configured</div>';
                updateCounter(diCounter, 0);
                return;
            }

            const itemsCount = json.data.length;
            updateCounter(diCounter, itemsCount);

            json.data
                .forEach(di => {
                    const diKey = mapDiIdToKey(di.di_id);
                    const safeId = createDISafeId(di.name, di.driver_id, di.di_id);

                    const div = document.createElement("div");
                    div.className = "di-item";
                    div.id = safeId;
                    div.title = `${di.name} (Driver: ${di.driver_id}, DI: ${diKey})`;
                    div.dataset.driver = di.driver_id;
                    div.dataset.diKey = diKey;
                    div.dataset.kind = di.type;          // "driver" or "gpio"
                    div.dataset.gpio = di.gpio_id || "";
                    div.dataset.diId = di.di_id;
                    div.innerHTML = `
                    <span class="di-label">${escapeHtml(di.name)}</span>
                    <div class="di-indicator" id="indicator_${safeId}"></div>
                `;

                    diContainer.appendChild(div);
                });
        } catch (err) {
            console.error("Failed to fetch DI list:", err);
            createDemoDIs();
        }
    }

    function createDemoDIs() {
        if (!diContainer) return;
        diContainer.innerHTML = "";

        const demos = [
            { name: "Limit Switch", driver_id: "1", di_id: "1" },
            { name: "Proximity Sensor", driver_id: "1", di_id: "2" },
            { name: "Safety Gate", driver_id: "1", di_id: "6" },
            { name: "Emergency Stop", driver_id: "1", di_id: "7" },
            { name: "Encoder Zero", driver_id: "2", di_id: "1" },
            { name: "Very Long DI Name That Should Wrap Properly", driver_id: "2", di_id: "2" },
            { name: "Overload Detect", driver_id: "2", di_id: "8" },
        ];

        updateCounter(diCounter, demos.length);

        demos.forEach(di => {
            const diKey = mapDiIdToKey(di.di_id);
            const safeId = createDISafeId(di.name, di.driver_id, di.di_id);
            const div = document.createElement("div");
            div.className = "di-item";
            div.id = safeId;
            div.dataset.driver = di.driver_id;
            div.dataset.diKey = diKey;
            div.innerHTML = `
                <span class="di-label">${escapeHtml(di.name)}</span>
                <div class="di-indicator" id="indicator_${safeId}"></div>
            `;
            diContainer.appendChild(div);
        });
    }

    // Refresh button handler
    document.getElementById("refresh-di")?.addEventListener("click", async () => {
        await loadDIList();
    });

    // Initial load
    await loadDIList();
});

// ============================================================
// DO CONTROL - Simple Grid Layout with Counter
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
    const doContainer = document.getElementById("do-container");
    const doCounter = document.getElementById("do-counter");

    // Remove edit button if it exists
    const existingEditBtn = document.querySelector("#do-control .edit-layout-btn");
    if (existingEditBtn) existingEditBtn.remove();

    function publishDO(driver, doId, state) {
        let mappedDoId =
            doId === "pi_p"
                ? 4
                : parseInt(doId, 10);

        window.parent.postMessage({
            type: "TOGGLE_DO",
            payload: {
                driver: parseInt(driver, 10),
                doId: mappedDoId,
                state: Boolean(state)
            }
        }, "*");
    }

    function publishGpioDO(group, channel, state) {
        window.parent.postMessage({
            type: "GPIO_COMMAND",
            payload: { group, channel: parseInt(channel, 10), value: Boolean(state) }
        }, "*");
    }

    async function handlePush(doItem, btn) {
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = "⏳";
        try {
            if (doItem.type === "gpio") {
                publishGpioDO(doItem.gpio_id, doItem.do_id, true);
                await new Promise(r => setTimeout(r, parseInt(doItem.push_wait) || 250));
                publishGpioDO(doItem.gpio_id, doItem.do_id, false);
            } else {
                publishDO(doItem.driver_id, doItem.do_id, true);
                await new Promise(r => setTimeout(r, parseInt(doItem.push_wait) || 250));
                publishDO(doItem.driver_id, doItem.do_id, false);
            }
        } catch (err) {
            console.error("Error in handlePush:", err);
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }

    function handleSwitch(doItem, toggleEl) {
        if (doItem.type === "gpio") {
            publishGpioDO(doItem.gpio_id, doItem.do_id, toggleEl.checked);
        } else {
            publishDO(doItem.driver_id, doItem.do_id, toggleEl.checked);
        }
    }
    async function loadDOList() {
        if (!doContainer) return;

        try {
            const res = await fetch("/ros/do-list");
            const json = await res.json();
            console.log(json)

            // Clear container
            doContainer.innerHTML = "";

            if (!json.data || json.data.length === 0) {
                doContainer.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px;">No DO devices configured</div>';
                updateCounter(doCounter, 0);
                return;
            }

            const itemsCount = json.data.length;
            updateCounter(doCounter, itemsCount);

            json.data
                .forEach(doItem => {
                    // new
                    const idPart = doItem.type === "gpio" ? doItem.gpio_id : doItem.driver_id;
                    const doId = createDOSafeId(doItem.name, idPart, doItem.do_id);
                    const div = document.createElement("div");
                    div.className = "do-item";
                    div.id = doId;
                    div.dataset.kind = doItem.type;                 // "driver" | "gpio"
                    div.dataset.driver = doItem.driver_id ?? "";
                    div.dataset.gpio = doItem.gpio_id ?? "";
                    div.dataset.doId = doItem.do_id;
                    div.title = doItem.type === "gpio"
                        ? `${doItem.name} (GPIO: ${doItem.gpio_id}, DO: ${doItem.do_id})`
                        : `${doItem.name} (Driver: ${doItem.driver_id}, DO: ${doItem.do_id})`;

                    // Create control based on type
                    let controlHtml = '';
                    if (doItem.type_of_control === "switch") {
                        controlHtml = `
                        <label class="switch-wrapper">
                            <input type="checkbox" class="switch-input">
                            <span class="switch-slider"></span>
                        </label>
                    `;
                    } else {
                        controlHtml = `<button class="do-btn">Push</button>`;
                    }

                    div.innerHTML = `
                    <span class="do-label">${escapeHtml(doItem.name)}</span>
                    ${controlHtml}
                `;

                    doContainer.appendChild(div);

                    // Attach event listeners
                    const btn = div.querySelector(".do-btn");
                    const toggle = div.querySelector(".switch-input");

                    if (btn) {
                        btn.addEventListener("click", () => handlePush(doItem, btn));
                    }
                    if (toggle) {
                        toggle.addEventListener("change", () => handleSwitch(doItem, toggle));
                    }
                });
        } catch (err) {
            console.error("Failed to fetch DO list:", err);
            doContainer.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: red;">Error loading DO devices</div>';
            updateCounter(doCounter, 0);
        }
    }

    // Refresh button handler
    document.getElementById("refresh-do")?.addEventListener("click", async () => {
        await loadDOList();
    });

    // Initial load
    await loadDOList();
});

// ============================================================
// LEGACY LAYOUT EDITOR (localStorage-based, kept for compat)
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".editable-container").forEach(container => {
        const type = container.id.startsWith("di") ? "di" : "do";
        const editBtn = document.querySelector(`.edit-btn[data-target="${type}"]`);
        const saveBtn = document.querySelector(`.save-btn[data-target="${type}"]`);
        if (!editBtn || !saveBtn) return;

        loadLegacyLayout(container, type);
        editBtn.addEventListener("click", () => toggleLegacyEdit(container, editBtn, saveBtn, type));
        saveBtn.addEventListener("click", () => saveLegacyLayout(container, editBtn, saveBtn, type));
    });
});

function toggleLegacyEdit(container, editBtn, saveBtn, type) {
    const isEditing = container.classList.toggle("edit-mode");
    editBtn.textContent = isEditing ? "Add / Delete" : "Edit";
    saveBtn.disabled = !isEditing;
    isEditing ? enableLegacyEditing(container) : disableLegacyEditing(container);
}
function enableLegacyEditing(container) { container.querySelectorAll(".movable").forEach(el => makeLegacyDraggable(el, container)); }
function disableLegacyEditing(container) { container.querySelectorAll(".movable").forEach(el => { el.onmousedown = null; }); }

function makeLegacyDraggable(el, container) {
    let oX, oY, drag = false;
    el.onmousedown = e => {
        drag = true; el.style.cursor = "grabbing"; oX = e.offsetX; oY = e.offsetY;
        document.onmousemove = e => {
            if (!drag) return;
            const r = container.getBoundingClientRect();
            el.style.left = Math.round(Math.max(0, Math.min(e.clientX - r.left - oX, r.width - el.offsetWidth)) / 10) * 10 + "px";
            el.style.top = Math.round(Math.max(0, Math.min(e.clientY - r.top - oY, r.height - el.offsetHeight)) / 10) * 10 + "px";
        };
        document.onmouseup = () => { drag = false; el.style.cursor = "grab"; document.onmousemove = null; };
    };
}

function saveLegacyLayout(container, editBtn, saveBtn, type) {
    const layout = [];
    container.querySelectorAll(".movable").forEach(el => {
        layout.push({ id: el.id, x: parseInt(el.style.left || 0), y: parseInt(el.style.top || 0), width: el.offsetWidth, height: el.offsetHeight });
    });
    localStorage.setItem(`layout_${type}`, JSON.stringify(layout));
    saveBtn.disabled = true; container.classList.remove("edit-mode"); disableLegacyEditing(container);
}

function loadLegacyLayout(container, type) {
    try {
        const saved = localStorage.getItem(`layout_${type}`);
        if (!saved) return;
        JSON.parse(saved).forEach(item => {
            const el = document.getElementById(item.id);
            if (el) { el.style.position = "absolute"; el.style.left = item.x + "px"; el.style.top = item.y + "px"; el.classList.add("movable"); }
        });
    } catch (err) {
        console.error("Failed to load layout:", err);
    }
}

// Register page with parent
window.parent.postMessage({
    type: "REGISTER_PAGE",
    payload: {
        pageId: "page8",
        messageTypes: ["DRIVER_STATUS", "JOINT_STATUS", "DI_STATUS", "DO_STATUS", "GPIO_STATE", "GPIO_PUBLISH_CONFIRM", "CONTROL_ACTIVE", "PROCESS_STATUS", "CYCLE_TIME", "ACTION_RESULT", "REQUEST_GPIO_STATE"]
    }
}, "*");