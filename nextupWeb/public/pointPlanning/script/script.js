const API_BASE = "http://localhost:3000/point-planning";
const WS_URL = `ws://${window.location.host}`;


let points = [];
let editingPointName = null;
let oldPointName = null;
let lastSequence = "1";
let pendingPoint = null;
let confirmCallback = null;
let backupFilesList = [];
let reorderLocked = true;
// Store latest values
let latestPositions = [0, 0, 0, 0, 0, 0];
let latestCartesianValues = [0, 0, 0, 0, 0, 0];
let updatePointPublishState = false;

// DOM elements
const pointName = document.getElementById("pointName");

let currentRobotPoint = localStorage.getItem("currentRobotPoint") || null;



const dateTime = document.getElementById("dateTime");
const sequence = document.getElementById("sequence");
const nature = document.getElementById("nature");
const updateBtn = document.getElementById("updateBtn");
const pointList = document.getElementById("pointList");
const sequenceCount = document.getElementById("sequenceCount");
const undoBtn = document.getElementById("undoBtn");
const originPointFileName = document.getElementById("origin-point-file-name");
const pointModal = document.getElementById("pointModal");
const nameChangeModal = document.getElementById("nameChangeModal");
const confirmModal = document.getElementById("confirmModal");
const confirmMessage = document.getElementById("confirmMessage");
const motionTypeModal = document.getElementById("motionTypeModal");
const historyEntries = document.getElementById("historyEntries");
const fileName = document.getElementById("fileName");
const backupFilesInput = document.getElementById("backupFilesInput");
const backupFilesDropdown = document.getElementById("backupFilesDropdown");
const fileNameErrorModal = document.getElementById("fileNameErrorModal");
const addPointBtn = document.getElementById("addPointBtn");
const pointFileNameInputField = document.getElementById("fileName");

// WebSocket Connection

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || !msg.type) return;


  handleWebSocketMessage(msg);
});


function setCurrentRobotPoint(pointName) {
  currentRobotPoint = pointName;
  localStorage.setItem("currentRobotPoint", pointName);
  updatePointList();
}

function clearCurrentRobotPoint() {
  currentRobotPoint = null;
  localStorage.removeItem("currentRobotPoint");
  updatePointList();
}


// Handle WebSocket messages from backend
function handleWebSocketMessage(msg) {
  switch (msg.type) {
    case "DRIVER_STATUS":
      if (msg.payload && msg.payload.jointStatus) {
        updateJointStatusDisplay(msg.payload.jointStatus);
      }
      if (msg.payload && msg.payload.faultStatus) {
        updateFaultStatusDisplay(msg.payload.faultStatus);
      }
      break;

    case "EMERGENCY_STATUS":
      if (msg.payload && msg.payload.jointStatus) {
        updateEmergencyStatus(msg.payload.jointStatus);
      }
      break;

    case "MOTION_ACTIVE":
    case "DO_STATUS":
    case "CYCLE_TIME":
    case "LOG_MESSAGE_INCOMING":
    case "MOTION_PLANNING_SUCCESS":
    case "CONTROL_ACTIVE":
      break;
    case "ACTIVE_NODES":
      break;

    case "CARTESIAN_VALUES":
      const carValues = msg.payload.values;
      if (Array.isArray(carValues)) {
        latestCartesianValues = carValues;
        updateCartesianDisplay();
      } else if (typeof carValues === "object") {
        latestCartesianValues = Object.values(carValues);
        updateCartesianDisplay();
      } else {
        console.error("Invalid CARTESIAN_VALUES:", carValues);
        return;
      }
      break;
    case "SERVO_RESPONSE":
      handleServoResponse(msg.payload);
      break;
    case "JOINT_STATES":
      // was: latestJointStateValues = jointOrder.map(...)
      latestPositions = msg.payload.positions;

      // homing LEDs
      msg.payload.homingStatus.forEach((isHomed, i) => {
        const led = document.getElementById(`joint${i + 1}-led-homing`);
        if (led) {
          led.classList.toggle("joint-indicator-true", isHomed);
          led.classList.toggle("joint-indicator-false", !isHomed);
        }
      });
      const allHomed = msg.payload.homingStatus.every(Boolean);
      const robotLedHoming = document.getElementById("robot-led-homing");
      if (robotLedHoming) {
        robotLedHoming.classList.toggle("led-homing-true", allHomed);
        robotLedHoming.classList.toggle("led-homing-false", !allHomed);
      }

      // joint display — replaces JOINT_VALUES entirely
      msg.payload.positions.forEach((rad, i) => {
        const el = document.getElementById(`j${i + 1}val`);
        if (el) el.textContent = (rad * 180 / Math.PI).toFixed(2) + "°";
      });
      break;


    case "JOINT_MODE_OF_OPERATION": {
      const mode = msg.payload?.modeOfOperation;
      localStorage.setItem("robotMode", String(mode));
      // Legacy toggle sync (guarded — element replaced by segmented control,
      // which does its own reconciliation in mode_segmented.js).
      if (toggle) {
        if (mode === 9) toggle.checked = true;
        else if (mode === 8) toggle.checked = false;
      }
      break;
    }
    case "MOTION_STATUS":
      break;
    case "PROCESS_STATUS":
      break;

    case "ROSBRIDGE_STATUS":
      updateRosbridgeToggleUI(msg.payload);
      break;
  }
}

function updateJointStatusDisplay(jointStatus) {
  jointStatus.forEach((status, index) => {
    const element = document.getElementById(`j${index + 1}_status`);
    if (element) {
      element.textContent = status ? "ON" : "OFF";
      element.style.color = status ? "green" : "red";
    }
  });
}

function updateFaultStatusDisplay(faultStatus) {
  faultStatus.forEach((fault, index) => {
    const element = document.getElementById(`j${index + 1}_fault`);
    if (element) {
      element.textContent = fault ? "FAULT" : "OK";
      element.style.color = fault ? "red" : "green";
    }
  });
}

function updateEmergencyStatus(emergency) {
  const emergencyElement = document.getElementById("emergency_status");
  if (emergencyElement) {
    const hasEmergency = emergency.some((e) => e === true);
    emergencyElement.textContent = hasEmergency ? "EMERGENCY" : "NORMAL";
    emergencyElement.style.color = hasEmergency ? "red" : "green";
  }
}

function updateJointDisplay() {
  document.getElementById("j1val").textContent = latestJointValues[0].toFixed(2) + "°";
  document.getElementById("j2val").textContent = latestJointValues[1].toFixed(2) + "°";
  document.getElementById("j3val").textContent = latestJointValues[2].toFixed(2) + "°";
  document.getElementById("j4val").textContent = latestJointValues[3].toFixed(2) + "°";
  document.getElementById("j5val").textContent = latestJointValues[4].toFixed(2) + "°";
  document.getElementById("j6val").textContent = latestJointValues[5].toFixed(2) + "°";
}

function updateCartesianDisplay() {
  document.getElementById("xval").textContent = latestCartesianValues[0].toFixed(2) + " cm";
  document.getElementById("yval").textContent = latestCartesianValues[1].toFixed(2) + " cm";
  document.getElementById("zval").textContent = latestCartesianValues[2].toFixed(2) + " cm";
  document.getElementById("rval").textContent = latestCartesianValues[3].toFixed(2) + "°";
  document.getElementById("pval").textContent = latestCartesianValues[4].toFixed(2) + "°";
  document.getElementById("wval").textContent = latestCartesianValues[5].toFixed(2) + "°";
}

function handleServoResponse(response) {
  const button = document.getElementById("startServoButton");
  const success = response && response.success;
  button.classList.add(success ? "success" : "error");
  button.style.background = success
    ? "linear-gradient(135deg, var(--success) 0%, #0a6b4a 100%)"
    : "linear-gradient(135deg, var(--danger) 0%, #c1121f 100%)";
  showStatus(
    success ? "Servo started" : "Failed to start servo",
    success ? "success" : "error",
    2000,
  );
  setTimeout(() => {
    button.classList.remove("success", "error");
    button.style.background = "linear-gradient(135deg, #34c759 0%, #28b44f 100%)";
  }, 2000);
}

// Toast notification
function showStatus(message, type = "success", timeout = 3000) {
  let toastContainer = document.querySelector(".toast-container");
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.className = "toast-container";
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  let icon =
    type === "success"
      ? "check-circle"
      : type === "error"
        ? "exclamation-circle"
        : "info-circle";
  toast.innerHTML = `
        <i class="fas fa-${icon} toast-icon"></i>
        <div class="toast-content">${message}</div>
        <button class="toast-close" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.transform = "translateX(0)";
    toast.style.opacity = "1";
  }, 10);

  if (timeout > 0) {
    setTimeout(() => {
      if (toast.parentElement) {
        toast.classList.add("toast-out");
        setTimeout(() => {
          if (toast.parentElement) toast.remove();
        }, 300);
      }
    }, timeout);
  }
}

// Generate date_time in DDMMM_HHMM format
function getCurrentDateTime() {
  const now = new Date();
  const day = now.getDate().toString().padStart(2, "0");
  const month = now.toLocaleString("en-US", { month: "short" }).toLowerCase();
  const hours = now.getHours().toString().padStart(2, "0");
  const minutes = now.getMinutes().toString().padStart(2, "0");
  return `${day}${month}_${hours}${minutes}`;
}

// Load points from server
async function loadPoints() {
  try {
    const res = await fetch(`${API_BASE}/getPoints`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    points = await res.json();
    updatePointList();

    // Initialize/refresh the TF widget
    if (window.TFOrientationWidget) {
      window.TFOrientationWidget.init();
    }
    showStatus(`Reloaded ${points.length} points`, "success", 1500);
  } catch (err) {
    showStatus(`Failed to reload points: ${err.message}`, "error", 2000);
    console.error(err);
  }
}

function setupDropdownItems() {
  const items = backupFilesDropdown.querySelectorAll(".dropdown-item");
  items.forEach((item) => {
    item.addEventListener("click", () => {
      backupFilesInput.value = item.textContent;
      backupFilesInput.dataset.value = item.dataset.value;
      backupFilesDropdown.style.display = "none";
      showStatus(`Selected ${item.textContent}`, "success", 1500);
    });
  });
}

function setTFFrame(pointName) {
  const frame = pointName;
  if (typeof ServoJog !== "undefined") {
    ServoJog.setFrame(frame);
  } else {
    fetch("/ros/set_frame", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frame }),
    }).catch(console.error);
  }

  document.querySelectorAll(".btn-set-frame").forEach((btn) => {
    btn.classList.remove("active");
  });

  const allPoints = document.querySelectorAll(".point-item");
  allPoints.forEach((item) => {
    if (item.dataset.name === pointName) {
      const btn = item.querySelector(".btn-set-frame");
      if (btn) btn.classList.add("active");
    }
  });

  showStatus(`Servo frame set to: ${pointName}`, "success", 2000);
}

// ── Toggle is_editable for a point directly from the list ─────────────────────
async function togglePointEditable(name) {
  const point = points.find((p) => p.name === name);
  if (!point) return;

  // Flip current value (safe fallback: treat missing as true)
  const currentEditable = point.is_editable ?? true;
  const newEditable = !currentEditable;

  const body = {
    oldName: name,
    ...point,
    is_editable: newEditable,
    date_time: point.date_time, // preserve; don't regenerate on a metadata-only update
  };

  await callAPI("updatePoint", body, () => {
    loadPoints();
  });
}

// Update point list UI
// Update point list UI with collapsible sections
function updatePointList() {
  sequenceCount.textContent = points.length;
  pointList.innerHTML = '';
  pointList.classList.remove('with-sections');

  if (points.length === 0) {
    pointList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <p>No points added yet</p>
                <small>Start by adding a point using the editor</small>
            </div>`;
    refreshFrameDropdown();   // still clear the frame dropdown
    return;
  }

  points.forEach((point, index) => {
    pointList.appendChild(createPointElement(point, index));
  });

  initPointDragAndDrop();
  refreshFrameDropdown();
}

// Helper function to create a collapsible section
function createPointSection(points, title, type, defaultExpanded = true) {
  const section = document.createElement('div');
  section.className = 'points-section';

  // Create header
  const header = document.createElement('div');
  header.className = `section-header ${defaultExpanded ? '' : 'collapsed'}`;

  const headerLeft = document.createElement('div');
  headerLeft.className = 'section-header-left';

  const chevronIcon = document.createElement('i');
  chevronIcon.className = 'fas fa-chevron-down';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'section-title-text';
  titleSpan.textContent = title;

  const countBadge = document.createElement('span');
  countBadge.className = 'section-count';
  countBadge.textContent = points.length;

  const typeBadge = document.createElement('span');
  typeBadge.className = type === 'editable' ? 'badge-editable' : 'badge-non-editable';
  typeBadge.innerHTML = type === 'editable' ? '<i class="fas fa-lock-open"></i> Editable' : '<i class="fas fa-lock"></i> Locked';

  headerLeft.appendChild(chevronIcon);
  headerLeft.appendChild(titleSpan);
  headerLeft.appendChild(countBadge);
  headerLeft.appendChild(typeBadge);

  const headerRight = document.createElement('div');
  headerRight.className = 'section-header-right';
  const expandIcon = document.createElement('i');
  expandIcon.className = 'fas fa-chevron-down';
  headerRight.appendChild(expandIcon);

  header.appendChild(headerLeft);
  header.appendChild(headerRight);

  // Create content container
  const content = document.createElement('div');
  content.className = `section-content ${defaultExpanded ? '' : 'collapsed'}`;

  // Add points to content
  points.forEach((point, index) => {
    const pointElement = createPointElement(point, index);
    content.appendChild(pointElement);
  });

  // Add click handler for collapse/expand
  header.addEventListener('click', () => {
    const isCollapsed = content.classList.toggle('collapsed');
    header.classList.toggle('collapsed', isCollapsed);
    // Update chevron icon
    const chevron = header.querySelector('.section-header-left i');
    if (chevron) {
      chevron.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
    }
  });

  section.appendChild(header);
  section.appendChild(content);

  return section;
}

// Helper function to create individual point element
function createPointElement(point, globalIndex) {
  const editable = point.is_editable ?? true;

  const div = document.createElement('div');
  div.className =
    `point-item` +
    `${point.is_tf ? ' is-tf' : ''}` +
    `${!editable ? ' non-editable' : ''}` +
    `${currentRobotPoint === point.name ? ' current-robot-point' : ''}`;
  div.draggable = true;
  div.dataset.name = point.name;

  const tfFrameButton = point.is_tf
    ? `<button class="btn-icon btn-set-frame"
               title="Use '${point.name}' as servo frame"
               onclick="setTFFrame('${point.name}')">
               <i class="fas fa-crosshairs"></i>
           </button>`
    : '';

  const editBtn = editable
    ? `<button class="btn-icon btn-edit" onclick="editPoint('${point.name}')">
               <i class="fas fa-edit"></i>
           </button>`
    : `<button class="btn-icon btn-edit btn-disabled" disabled title="Point is locked">
               <i class="fas fa-edit"></i>
           </button>`;

  const deleteBtn = !editable
    ? `<button class="btn-icon btn-delete btn-disabled" disabled title="Point is locked">
               <i class="fas fa-trash"></i>
           </button>`
    : `<button class="btn-icon btn-delete"
               onclick="showConfirmModal('Delete point ${point.name}?', () => deletePoint('${point.name}'))">
               <i class="fas fa-trash"></i>
           </button>`;

  div.innerHTML = `
        <div class="point-index-container">
            <span class="drag-handle"></span>
            <span class="point-index">${globalIndex + 1}</span>
        </div>
        <div class="point-content">
            <div class="point-details">
                <span class="badge badge-primary point-name"
                      onclick="showPointDetails('${point.name}')">${point.name}</span>
                ${point.is_tf ? `<span class="badge-tf"><span class="tf-dot"></span>TF</span>` : ''}
                ${!editable ? `<span class="badge-locked"><i class="fas fa-lock"></i> locked</span>` : ''}
            </div>
        </div>
        <div class="point-actions">
            ${tfFrameButton}
            <button class="btn-icon btn-move" onclick="openMotionTypeModal('${point.name}')">
                <i class="fa-solid fa-location-arrow"></i>
            </button>
            ${editBtn}
            ${deleteBtn}
        </div>`;

  return div;
}

function toggleRosbridge(isOn) {
  if (!window.parent) return;
  window.parent.postMessage(
    { type: "TOGGLE_ROSBRIDGE", payload: { start: isOn } },
    "*"
  );
  // Optimistic — will self-correct within ~1s from the next ROSBRIDGE_STATUS
  // broadcast if the command didn't actually take (e.g. WS was down).
}

function updateRosbridgeToggleUI(statusText) {
  const toggle = document.getElementById("rosbridge-toggle");
  if (!toggle) return;
  toggle.checked = statusText.startsWith("RUNNING");
}

// Send motion command via WebSocket
function sendMotionCommand(command) {
  window.parent.postMessage(
    { type: "UI_COMMANDS", payload: { command } },
    "*",
  );
}

// Start servo via WebSocket
function callStartServo() {
  window.parent.postMessage(
    { type: "START_SERVO", payload: {} },
    "*",
  );
}

const toggle = document.getElementById("mode-op-toggle");

let isCooldown = false;

// Legacy 2-state toggle replaced by the 3-mode segmented control
// (see mode_segmented.js). Guard so the old handler is inert when the
// element is absent.
if (toggle) toggle.addEventListener("change", function () {
  if (isCooldown) {
    // Optionally revert the toggle state
    this.checked = !this.checked;
    return;
  }

  isCooldown = true;
  this.disabled = true;

  const mode = this.checked ? "9" : "8";
  localStorage.setItem("robotMode", String(mode));
  changeMode(mode);

  setTimeout(() => {
    this.disabled = false;
    isCooldown = false;
  }, 1500);
});

function changeMode(mode) {
  window.parent.postMessage(
    { type: "CHANGE_MODE", payload: { mode } },
    "*"
  );
}

// Jogging functionality
let activeJog = null;
let jogInterval = null;

function stopJog(joint) {
  if (!activeJog) return;
  clearInterval(jogInterval);
  jogInterval = null;
  sendMotionCommand(`0${activeJog}`);
  activeJog = null;
}

["j1", "j2", "j3", "j4", "j5", "j6", "cx", "cy", "cz", "cr", "cp", "cw"].forEach((joint) => {
  const plus = document.getElementById(`${joint}_plus`);
  const minus = document.getElementById(`${joint}_minus`);

  function startJog(direction, e) {
    if (e.button !== 0) return;
    if (activeJog) stopJog();
    activeJog = joint;
    sendMotionCommand(`${direction}${joint}`);
    jogInterval = setInterval(() => {
      sendMotionCommand(`${direction}${joint}`);
    }, 30);
  }

  if (plus) plus.addEventListener("pointerdown", (e) => {
    startJog("+", e)

  });
  if (minus) minus.addEventListener("pointerdown", (e) => startJog("-", e));

  if (plus) {
    ["pointerup", "pointercancel", "mouseleave"].forEach((evt) => {
      plus.addEventListener(evt, () => stopJog(joint));
    });
  }
  if (minus) {
    ["pointerup", "pointercancel", "mouseleave"].forEach((evt) => {
      minus.addEventListener(evt, () => stopJog(joint));
    });
  }
});

window.addEventListener("blur", () => stopJog());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopJog();
});
window.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  stopJog();
});

// Move to point
async function moveToPoint(point_name) {
  try {
    const res = await fetch(`/ros/moveToPoint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pointName: point_name }),
    });
    const data = await res.json();
    if (res.ok) {
      showStatus(`Moving to ${point_name}`, "info", 2000);
    } else {
      showStatus(`Failed to move to point: ${data.message}`, "error", 2000);
    }
  } catch (err) {
    console.error("Failed to move to point:", err);
    showStatus("Connection error moving to point", "error", 2000);
  }
}

function initLockButtonState() {
  const btn = document.getElementById("lockReorderBtn");
  const label = document.getElementById("lockReorderLabel");
  const icon = btn?.querySelector("i");

  if (btn && label && icon) {
    if (reorderLocked) {
      btn.classList.add("locked");
      icon.className = "fas fa-lock";
      label.textContent = "Locked";
    } else {
      btn.classList.remove("locked");
      icon.className = "fas fa-lock-open";
      label.textContent = "Unlocked";
    }
  }
}

// Initialize drag-and-drop for points
// Initialize drag-and-drop for points (updated for sections)
function initPointDragAndDrop() {
  const items = pointList.querySelectorAll('.point-item');
  items.forEach((item) => {
    if (reorderLocked) {
      item.classList.add('reorder-locked');
      item.draggable = false;
    } else {
      item.classList.remove('reorder-locked');
      item.draggable = true;
    }

    item.addEventListener('dragstart', (e) => {
      if (reorderLocked) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData('text/plain', item.dataset.name);
      item.classList.add('dragging');
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
    });

    item.addEventListener('dragover', (e) => {
      if (reorderLocked) return;
      e.preventDefault();
    });

    item.addEventListener('drop', (e) => {
      if (reorderLocked) return;
      e.preventDefault();
      const draggedName = e.dataTransfer.getData('text/plain');
      const targetItem = e.target.closest('.point-item');
      if (!targetItem || draggedName === targetItem.dataset.name) return;

      // Get all points in order from both sections
      const allItems = Array.from(pointList.querySelectorAll('.point-item'));
      const draggedItem = pointList.querySelector(`.point-item[data-name="${draggedName}"]`);
      const targetIndex = allItems.indexOf(targetItem);
      const draggedIndex = allItems.indexOf(draggedItem);

      if (draggedIndex < targetIndex) {
        targetItem.after(draggedItem);
      } else {
        targetItem.before(draggedItem);
      }

      const newOrder = Array.from(
        pointList.querySelectorAll('.point-item'),
      ).map((item) => item.dataset.name);
      reorderPoints(newOrder);
    });
  });
}

// Reorder points
async function reorderPoints(pointNames) {
  await callAPI("reorderPoints", { pointNames }, loadPoints);
}

// Format number for display
function formatNumber(num) {
  return Number(num).toFixed(5);
}

// Show point details in modal
function showPointDetails(name) {
  const point = points.find((p) => p.name === name);
  if (!point) return;
  document.getElementById("modalName").textContent = `Name: ${point.name}`;
  document.getElementById("modalDateTime").textContent = `Date Time: ${point.date_time}`;
  document.getElementById("modalSequence").textContent = `Sequence: ${point.sequence}`;
  document.getElementById("modalNature").textContent = `Nature: ${point.nature}`;
  document.getElementById("modalEditable").textContent =
    `Editable: ${(point.is_editable ?? true) ? "Yes" : "No (Locked)"}`;
  document.getElementById("modalJoints").textContent =
    `Joints: (${formatNumber(point.joints_values.joint1)}, ${formatNumber(point.joints_values.joint2)}, ${formatNumber(point.joints_values.joint3)}, ${formatNumber(point.joints_values.joint4)}, ${formatNumber(point.joints_values.joint5)}, ${formatNumber(point.joints_values.joint6)})`;
  document.getElementById("modalCoordinates").textContent =
    `Coordinates: (${formatNumber(point.coordinate.x)}, ${formatNumber(point.coordinate.y)}, ${formatNumber(point.coordinate.z)}, ${formatNumber(point.coordinate.r)}, ${formatNumber(point.coordinate.p)}, ${formatNumber(point.coordinate.w)})`;

  const historyContainer = document.getElementById("historyEntries");
  historyContainer.innerHTML = "";
  if (!point.history) {
    historyContainer.innerHTML = '<p class="history-entry">No history available</p>';
  } else {
    const serialEntry = document.createElement("p");
    serialEntry.className = "history-entry";
    serialEntry.textContent = `Latest: ${point.history.Serial}`;
    historyContainer.appendChild(serialEntry);

    const historyKeys = Object.keys(point.history)
      .filter((k) => k !== "Serial" && !isNaN(k))
      .map(Number)
      .sort((a, b) => a - b);
    historyKeys.forEach((key) => {
      const entry = document.createElement("p");
      entry.className = "history-entry";
      entry.textContent = `${key}: ${point.history[key]}`;
      historyContainer.appendChild(entry);
    });
  }

  pointModal.style.display = "flex";
}

function closePointModal() {
  pointModal.style.display = "none";
}

function closeNameChangeModal() {
  nameChangeModal.style.display = "none";
  pendingPoint = null;
}

function closeFileNameErrorModal() {
  fileNameErrorModal.style.display = "none";
}

function showConfirmModal(message, callback) {
  confirmMessage.textContent = message;
  confirmCallback = callback;
  confirmModal.style.display = "flex";
}

function closeConfirmModal() {
  confirmModal.style.display = "none";
  confirmCallback = null;
}

function confirmAction() {
  if (confirmCallback) confirmCallback();
  closeConfirmModal();
}

let selectedPointForMotion = null;

function openMotionTypeModal(pointName) {
  selectedPointForMotion = pointName;
  motionTypeModal.style.display = "flex";
}

function closeMotionTypeModal() {
  motionTypeModal.style.display = "none";
  selectedPointForMotion = null;
}

async function selectMotionType(type) {
  if (!selectedPointForMotion) return;
  const pointName = selectedPointForMotion;
  try {
    await fetch(`/ros/setMotionType`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motionType: type }),
    });
    closeMotionTypeModal();
    setTimeout(() => {
      moveToPoint(`get_last_pose@${pointName}`);

      // Highlight this point
      setCurrentRobotPoint(pointName);
    }, 500);
  } catch (err) {
    console.error("Failed to set motion type:", err);
    showStatus("Failed to set motion type", "error", 2000);
  }
}

pointName.addEventListener("input", () => {
  nature.value = pointName.value;
})
// Get point data from form
function getPointFromForm() {
  let rawName = pointName.value.trim();
  const isTfChecked = document.getElementById("is_tf").checked;

  if (nature.value.length === 0) {
    nature.textContent = pointName.value;
    nature.value = pointName.value;
  }

  // If editing an existing point, preserve the base name logic
  if (editingPointName) {
    // If it's already a TF point and checkbox is checked, don't add another -tf
    if (isTfChecked && editingPointName.endsWith('-tf')) {
      // Already has -tf suffix, keep as is
      rawName = editingPointName;
    }
    // If it wasn't TF but now is, add -tf
    else if (isTfChecked && !editingPointName.endsWith('-tf')) {
      rawName = `${rawName}-tf`;
    }
    // If it was TF but now isn't, remove -tf suffix
    else if (!isTfChecked && editingPointName.endsWith('-tf')) {
      rawName = editingPointName.slice(0, -3);
    }
  } else {
    // New point - apply suffix if TF is checked
    if (isTfChecked) {
      rawName = `${rawName}-tf`;
    }
  }

  return {
    name: rawName,
    date_time: getCurrentDateTime(),
    sequence: Number(sequence.value),
    nature: nature.value.trim(),
    is_tf: isTfChecked,
    is_calibrated: false,
    is_editable: document.getElementById("is_editable").checked,
    joints_values: {
      joint1: Number(latestPositions[0] || 0),
      joint2: Number(latestPositions[1] || 0),
      joint3: Number(latestPositions[2] || 0),
      joint4: Number(latestPositions[3] || 0),
      joint5: Number(latestPositions[4] || 0),
      joint6: Number(latestPositions[5] || 0),
    },
    coordinate: {
      x: Number(latestCartesianValues[0] || 0),
      y: Number(latestCartesianValues[1] || 0),
      z: Number(latestCartesianValues[2] || 0),
      r: Number(latestCartesianValues[3] || 0),
      p: Number(latestCartesianValues[4] || 0),
      w: Number(latestCartesianValues[5] || 0),
    },
  };
}

// Validate point data
function validatePoint(point) {
  if (!point.name || !/^[a-zA-Z0-9-_]+$/.test(point.name)) {
    showStatus(
      "Point name must contain only letters, numbers, and dashes",
      "error",
      3000,
    );
    return false;
  }
  if (!point.nature || point.nature.length > 30) {
    showStatus(
      "Nature is required and must be 30 characters or less",
      "error",
      3000,
    );
    return false;
  }
  if (isNaN(point.sequence) || point.sequence < 1 || point.sequence > 10) {
    showStatus("Sequence must be between 1 and 10", "error", 3000);
    return false;
  }
  if (
    !Array.isArray(latestPositions) ||
    !Array.isArray(latestCartesianValues) ||
    !latestPositions.every((val) => !isNaN(val)) ||
    !latestCartesianValues.every((val) => !isNaN(val))
  ) {
    showStatus("Invalid joint or cartesian values received", "error", 3000);
    return false;
  }
  return true;
}

// Add a new point
async function addPoint() {
  const point = getPointFromForm();
  if (!validatePoint(point)) return;
  await callAPI("addPoint", point, () => {
    clearForm();
    loadPoints();
  });
}

// Add point from name change modal
async function addPointFromNameChange() {
  if (!pendingPoint) return;
  if (!validatePoint(pendingPoint)) {
    closeNameChangeModal();
    return;
  }
  await callAPI("addPoint", pendingPoint, () => {
    clearForm();
    loadPoints();
    closeNameChangeModal();
  });
}

// Edit a point — only allowed if editable
function editPoint(name) {
  const point = points.find((p) => p.name === name);
  if (!point) return;

  // Guard: don't allow editing locked points (belt-and-suspenders; button is also disabled)
  if (!(point.is_editable ?? true)) {
    showStatus("This point is locked and cannot be edited", "error", 3000);
    return;
  }

  editingPointName = name;
  oldPointName = name;
  pointName.value = point.name;
  pointName.readOnly = true;
  pointName.classList.add("input-readonly");
  dateTime.value = point.date_time;
  sequence.value = point.sequence;
  nature.value = point.nature;
  document.getElementById("is_tf").checked = point.is_tf ?? false;
  // Restore is_editable checkbox from the point being edited
  document.getElementById("is_editable").checked = point.is_editable ?? true;

  lastSequence = point.sequence;

  const updateButton = document.getElementById("updateBtn");
  updateButton.disabled = false;
  updateButton.style.opacity = "1";
  updateButton.style.cursor = "pointer";

  showStatus(`Editing ${name}`, "success", 2000);
}

// Delete a point
async function deletePoint(name) {
  await callAPI("deletePoint", { name }, loadPoints);
}

// Delete all points
async function deleteAll() {
  await callAPI("deleteAll", {}, loadPoints);
}

// Perform undo
async function performUndo() {
  undoBtn.disabled = true;
  await callAPI("undo", {}, () => {
    loadPoints();
    checkUndo();
  });
}

// Check if undo is available
async function checkUndo() {
  try {
    const res = await fetch(`${API_BASE}/canUndo`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    undoBtn.disabled = !data.canUndo;
  } catch (err) {
    undoBtn.disabled = true;
    showStatus(`Failed to check undo: ${err.message}`, "error", 2000);
  }
}

// Save file
async function saveFile() {
  const name = fileName.value.trim();
  if (!name || !/^[a-zA-Z0-9_]+$/.test(name)) {
    showStatus(
      "File name must contain only letters, numbers, and underscores",
      "error",
      3000,
    );
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/savePointFile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: name }),
    });
    const data = await res.json();
    if (res.ok) {
      showStatus(`File saved with ${name}`, "success", 2000);
    } else {
      showStatus(data.message, "error", 2000);
    }
  } catch (err) {
    showStatus("Failed to save file", "error", 2000);
  }
}

// Load file
async function loadFile() {
  const fullName = backupFilesInput.dataset.value;
  if (!fullName) {
    showStatus("Please select a backup file to load", "error", 3000);
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/loadBackupFile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: fullName }),
    });
    const data = await res.json();
    if (res.ok) {
      setTimeout(() => {
        reloadPoints();
        setTimeout(() => {
          disableDeletePoints(true);
        }, 500);
        showStatus(`${backupFilesInput.value} file loaded`, "success", 2000);
      }, 500);
    } else {
      showStatus(data.message, "error", 2000);
    }
  } catch (err) {
    showStatus("Failed to load file", "error", 2000);
  }
}

// Create new file
async function createNewFile() {
  const name = fileName.value.trim();
  if (!name || !/^[a-zA-Z0-9_]+$/.test(name)) {
    fileNameErrorModal.style.display = "flex";
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/createNewFile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: name }),
    });
    const data = await res.json();
    if (res.ok) {
      setTimeout(() => {
        reloadPoints();
        setTimeout(() => {
          disableDeletePoints(false);
        }, 500);
        showStatus(`New blank file created with name: ${name}`, "success", 2000);
        pointFileNameInputField.value = "";
      }, 500);
    } else {
      showStatus(data.message, "error", 2000);
    }
  } catch (err) {
    showStatus("Failed to create file", "error", 2000);
  }
}

// Delete file
async function deleteFile() {
  const fullName = backupFilesInput.dataset.value;
  if (!fullName) {
    showStatus("Please select a backup file to delete", "error", 3000);
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/deleteBackupFile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: fullName }),
    });
    const data = await res.json();
    if (res.ok) {
      setTimeout(() => {
        reloadPoints();
        setTimeout(() => {
          disableDeletePoints(true);
        }, 500);
        showStatus(`${backupFilesInput.value} file deleted`, "success", 2000);
        clearBackupFileForm();
      }, 500);
    } else {
      showStatus(data.message, "error", 2000);
    }
  } catch (err) {
    showStatus("Failed to delete file", "error", 2000);
  }
}

// Disable/enable delete points
function disableDeletePoints(disabled) {
  updatePointPublishState = disabled;
  // Re-render the list so delete button disabled states are recalculated
  updatePointList();
  showStatus(
    disabled ? "Delete buttons disabled" : "Delete buttons enabled",
    "info",
    1500,
  );
}

// Clear backup file form
function clearBackupFileForm() {
  backupFilesInput.value = "";
  showStatus("Backup File Form refreshed", "success", 1500);
}

// API call function
async function callAPI(endpoint, body, callback) {
  showStatus("Processing...", "info", 1000);
  try {
    const res = await fetch(`${API_BASE}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      showStatus(data.message, "success", 2000);
      if (callback) callback();
    } else {
      showStatus(data.message, "error", 3000);
    }
  } catch (err) {
    showStatus(`Connection error: ${err.message}`, "error", 3000);
  }
}

// Clear form and reset state
function clearForm() {
  pointName.value = "";
  pointName.readOnly = false;
  pointName.classList.remove("input-readonly");
  dateTime.value = "Auto-generated";
  sequence.value = lastSequence;
  nature.value = "";
  document.getElementById("is_tf").checked = false;
  // Default new points to editable
  document.getElementById("is_editable").checked = true;
  editingPointName = null;
  oldPointName = null;
  showStatus("Form cleared", "success", 1500);
}

// Reload points
async function reloadPoints() {
  await loadPoints();
}

// Persist sequence selection
sequence.addEventListener("change", () => {
  lastSequence = sequence.value;
});

// Update point
async function updatePoint() {
  if (!editingPointName) {
    showStatus("No point selected for editing", "error", 3000);
    return;
  }
  const point = getPointFromForm();
  if (!validatePoint(point)) return;
  if (point.name !== oldPointName) {
    pendingPoint = point;
    nameChangeModal.style.display = "flex";
    return;
  }
  const body = { oldName: oldPointName, ...point };
  await callAPI("updatePoint", body, () => {
    clearForm();
    loadPoints();
  });
  if (updatePointPublishState) {
    try {
      await fetch(`${API_BASE}/editedPoint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pointName: point.name }),
      });
      console.log(`Published ${point.name}`);
      setTimeout(() => {
        reloadPoints();
        showStatus(`${point.name} published`, "info", 2000);
      }, 500);
    } catch (err) {
      console.error("Failed to publish edited point:", err);
    }
  }
}

// ─── Reorder lock ──────────────────────────────────────────────────────────
function toggleReorderLock() {
  reorderLocked = !reorderLocked;
  const btn = document.getElementById("lockReorderBtn");
  const label = document.getElementById("lockReorderLabel");
  const icon = btn.querySelector("i");

  if (reorderLocked) {
    btn.classList.add("locked");
    icon.className = "fas fa-lock";
    label.textContent = "Locked";
    showStatus("Reordering locked", "info", 1500);
  } else {
    btn.classList.remove("locked");
    icon.className = "fas fa-lock-open";
    label.textContent = "Unlocked";
    showStatus("Reordering unlocked", "info", 1500);
  }

  initPointDragAndDrop();
}

// ─── Servo frame dropdown ──────────────────────────────────────────────────
let currentActiveFrame = null;

function toggleFrameDropdown() {
  const menu = document.getElementById("frameDropdownMenu");
  const toggle = document.getElementById("frameDropdownToggle");
  const isOpen = menu.classList.toggle("open");
  toggle.classList.toggle("open", isOpen);
}

function selectFrameFromDropdown(frame) {
  if (typeof ServoJog !== "undefined") {

    ServoJog.setFrame(frame);
  }
  document.getElementById("frameDropdownMenu").classList.remove("open");
  document.getElementById("frameDropdownToggle").classList.remove("open");
  showStatus(`Servo frame set to: ${frame}`, "success", 2000);
}

function getTFPoints() {
  return points.filter((p) => p.is_tf);
}


function refreshFrameDropdown() {
  const container = document.getElementById("tfFramesContainer");
  if (!container) return;

  const tfPoints = getTFPoints();

  // Clear stale active frame if it was deleted
  if (
    currentActiveFrame &&
    !tfPoints.some((p) => p.name === currentActiveFrame)
  ) {
    currentActiveFrame = null;

    const label = document.getElementById("frameDropdownLabel");
    if (label) {
      label.textContent = "Select frame...";
    }
  }

  if (tfPoints.length === 0) {
    container.innerHTML =
      `<div class="frame-dropdown-empty">No TF points</div>`;
    return;
  }

  container.innerHTML = tfPoints
    .map(
      (p) => `
      <div class="frame-dropdown-item"
           data-frame="${p.name}"
           onclick="selectFrameFromDropdown('${p.name}')">
        <i class="fas fa-crosshairs"></i> ${p.name}
      </div>`
    )
    .join("");

  if (currentActiveFrame) {
    updateFrameDropdownActive(currentActiveFrame);
  }
}

function updateFrameDropdownActive(frame) {
  currentActiveFrame = frame;

  document.querySelectorAll(".frame-dropdown-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.frame === frame);
  });

  const label = document.getElementById("frameDropdownLabel");
  if (label) {
    label.textContent = frame || "Select frame...";
  }
}


window.addEventListener("message", (event) => {
  const msg = event.data;

  // ✅ EXISTING: Handle frame changed from backend
  if (msg?.type === "SERVO_FRAME_CHANGED") {
    updateFrameDropdownActive(msg.payload.frame);
  }

  // 🆕 NEW: Handle iframe requesting the saved frame on page load
  if (msg?.type === "GET_SERVO_FRAME") {
    console.log("📡 Iframe requesting saved servo frame...");

    fetch("/ros/get_frame")
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (data.success && data.frame) {
          console.log(`✅ Loaded servo frame from backend: "${data.frame}"`);

          // Send frame back to all iframes so they can update their UI
          document.querySelectorAll("iframe").forEach(iframe => {
            iframe.contentWindow.postMessage(
              { type: "SERVO_FRAME_LOADED", payload: { frame: data.frame } },
              "*"
            );
          });

          // Also update main page UI
          updateFrameDropdownActive(data.frame);
        } else {
          console.warn("⚠️ Backend returned frame but it's invalid:", data);
        }
      })
      .catch(err => {
        console.error("❌ Failed to load servo frame from backend:", err);
      });
  }
});

document.addEventListener("click", (e) => {
  const wrapper = document.querySelector(".frame-dropdown-wrapper");
  if (wrapper && !wrapper.contains(e.target)) {
    const menu = document.getElementById("frameDropdownMenu");
    const toggle = document.getElementById("frameDropdownToggle");
    if (menu) menu.classList.remove("open");
    if (toggle) toggle.classList.remove("open");
  }
});

async function init() {
  sequence.value = lastSequence;
  await loadPoints();
  await checkUndo();
  initLockButtonState();
}

document.addEventListener("DOMContentLoaded", () => {
  // In each child iframe (e.g., pointPlanning section)
  window.parent.postMessage({
    type: "REGISTER_PAGE",
    payload: {
      pageId: "page1",  // must match the iframe ID in mainWeb
      messageTypes: ["JOINT_STATES", "CARTESIAN_VALUES", "DRIVER_STATUS", "MODE_SWITCH_PROGRESS", "MODE_SWITCH_RESULT", "DETECT_MODE_RESULT", "MODE_STATE", "ROSBRIDGE_STATUS"]
    }
  }, "*");

  window.parent.postMessage({ type: "GET_ROSBRIDGE_STATUS", payload: {} }, "*");
  init();
  disableDeletePoints(true);
  const savedMode = localStorage.getItem("robotMode");
  if (savedMode === "9") {
    // toggle.checked = true;
  } else if (savedMode === "8") {
    toggle.checked = false;
  }
});

document.addEventListener("DOMContentLoaded", () => {
  ["j1", "j2", "j3", "j4", "j5", "j6", "cx", "cy", "cz", "cr", "cp", "cw"].forEach((joint) => {
    const plus = document.getElementById(`${joint}_plus`);
    const minus = document.getElementById(`${joint}_minus`);

    function startJog(direction, e) {
      if (e.button !== 0) return;
      if (activeJog) stopJog();
      activeJog = joint;
      sendMotionCommand(`${direction}${joint}`);
      jogInterval = setInterval(() => {
        sendMotionCommand(`${direction}${joint}`);
      }, 30);
    }

    if (plus) plus.addEventListener("pointerdown", (e) => startJog("+", e));
    if (minus) minus.addEventListener("pointerdown", (e) => startJog("-", e));

    if (plus) {
      ["pointerup", "pointercancel", "mouseleave"].forEach((evt) => {
        plus.addEventListener(evt, () => stopJog(joint));
      });
    }
    if (minus) {
      ["pointerup", "pointercancel", "mouseleave"].forEach((evt) => {
        minus.addEventListener(evt, () => stopJog(joint));
      });
    }
  });
});


function setupToggleRows() {
  // Setup Is TF toggle
  const isTfContainer = document.querySelector('#is_tf').closest('.form-group > div');
  if (isTfContainer) {
    isTfContainer.style.cursor = 'pointer';
    isTfContainer.addEventListener('click', function (e) {
      // Don't trigger if clicking directly on the checkbox (to avoid double toggle)
      if (e.target.type !== 'checkbox') {
        const checkbox = document.getElementById('is_tf');
        checkbox.checked = !checkbox.checked;
        // Trigger change event if needed
        checkbox.dispatchEvent(new Event('change'));
      }
    });
  }

  // Setup Editable toggle
  const editableContainer = document.querySelector('#is_editable').closest('.form-group > div');
  if (editableContainer) {
    editableContainer.style.cursor = 'pointer';
    editableContainer.addEventListener('click', function (e) {
      // Don't trigger if clicking directly on the checkbox (to avoid double toggle)
      if (e.target.type !== 'checkbox') {
        const checkbox = document.getElementById('is_editable');
        checkbox.checked = !checkbox.checked;
        // Trigger change event if needed
        checkbox.dispatchEvent(new Event('change'));
      }
    });
  }
}


let amWorkingPoints = [];
let amSelected = { editable: new Set(), locked: new Set() };
let amDragSrc = null;

// ─── Open / close ──────────────────────────────────────────────────
function openAccessManager() {
  // Deep-clone current points into working copy
  amWorkingPoints = points.map(p => ({ ...p }));
  amSelected = { editable: new Set(), locked: new Set() };
  document.getElementById('am-search-editable').value = '';
  document.getElementById('am-search-locked').value = '';
  amRenderCols();
  document.getElementById('accessManagerModal').style.display = 'flex';
}

function closeAccessManager() {
  document.getElementById('accessManagerModal').style.display = 'none';
}

// Close on backdrop click
document.getElementById('accessManagerModal').addEventListener('click', function (e) {
  if (e.target === this) closeAccessManager();
});

// ─── Render both columns ───────────────────────────────────────────
function amRenderCols() {
  const eFilter = document.getElementById('am-search-editable').value.toLowerCase();
  const lFilter = document.getElementById('am-search-locked').value.toLowerCase();

  const editablePts = amWorkingPoints.filter(p => (p.is_editable ?? true) === true);
  const lockedPts = amWorkingPoints.filter(p => (p.is_editable ?? true) === false);

  document.getElementById('am-count-editable').textContent = editablePts.length;
  document.getElementById('am-count-locked').textContent = lockedPts.length;

  amRenderZone('editable', editablePts, eFilter);
  amRenderZone('locked', lockedPts, lFilter);
  amUpdateFooter();
}

function amRenderZone(type, pts, filter) {
  const zone = document.getElementById('am-zone-' + type);
  const sel = amSelected[type];
  zone.innerHTML = '';

  const filtered = pts.filter(p =>
    p.name.toLowerCase().includes(filter) ||
    (p.nature || '').toLowerCase().includes(filter)
  );

  if (filtered.length === 0) {
    zone.innerHTML = `
            <div class="am-zone-empty">
                <i class="fas fa-inbox"></i>
                <span>${filter ? 'No matches' : 'Drop points here'}</span>
            </div>`;
    return;
  }

  filtered.forEach(p => {
    const row = document.createElement('div');
    row.className = [
      'am-pt-row',
      sel.has(p.name) ? 'am-selected' : '',
      type === 'locked' ? 'am-locked-row' : ''
    ].filter(Boolean).join(' ');
    row.dataset.name = p.name;
    row.dataset.col = type;
    row.draggable = true;

    row.innerHTML = `
            <div class="am-pt-check ${sel.has(p.name) ? 'am-checked' : ''}"
                 onclick="amToggleSelect(event,'${type}','${p.name}')"></div>
            <div class="am-drag-handle" aria-hidden="true">
                <span></span><span></span><span></span>
            </div>
            <span class="am-pt-name">${p.name}</span>
            ${p.is_tf ? '<span class="am-badge-tf">TF</span>' : ''}
            <span class="am-pt-nature">${p.nature || ''}</span>`;

    row.addEventListener('dragstart', e => {
      amDragSrc = { name: p.name, fromCol: type };
      row.classList.add('am-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => row.classList.remove('am-dragging'));

    zone.appendChild(row);
  });
}

// ─── Selection helpers ─────────────────────────────────────────────
function amToggleSelect(e, col, name) {
  e.stopPropagation();
  amSelected[col].has(name)
    ? amSelected[col].delete(name)
    : amSelected[col].add(name);
  amRenderCols();
}

function amSelectAll(col) {
  amWorkingPoints
    .filter(p => col === 'editable' ? (p.is_editable ?? true) : !(p.is_editable ?? true))
    .forEach(p => amSelected[col].add(p.name));
  amRenderCols();
}

function amSelectNone(col) {
  amSelected[col].clear();
  amRenderCols();
}

function amUpdateFooter() {
  const total = amSelected.editable.size + amSelected.locked.size;
  const info = document.getElementById('am-footer-info');
  info.textContent = total
    ? `${total} point${total > 1 ? 's' : ''} selected`
    : 'Select points to move, or drag them directly';
  document.getElementById('am-btn-lock').disabled = amSelected.editable.size === 0;
  document.getElementById('am-btn-unlock').disabled = amSelected.locked.size === 0;
}

// ─── Move via arrow buttons ────────────────────────────────────────
function amMoveSelected(toCol) {
  const fromCol = toCol === 'locked' ? 'editable' : 'locked';
  const names = [...amSelected[fromCol]];
  if (!names.length) return;

  names.forEach(n => {
    const p = amWorkingPoints.find(x => x.name === n);
    if (p) p.is_editable = (toCol === 'editable');
  });
  amSelected[fromCol].clear();
  amRenderCols();
  amShowToast(
    `${names.length} point${names.length > 1 ? 's' : ''} ${toCol === 'locked' ? 'locked' : 'unlocked'}`
  );
}

// ─── Drag and drop ─────────────────────────────────────────────────
function amDragOver(e, col) {
  e.preventDefault();
  document.getElementById('am-zone-' + col).classList.add('am-drag-over');
}

function amDragLeave(col) {
  document.getElementById('am-zone-' + col).classList.remove('am-drag-over');
}

function amDrop(e, toCol) {
  e.preventDefault();
  document.getElementById('am-zone-' + toCol).classList.remove('am-drag-over');
  if (!amDragSrc || amDragSrc.fromCol === toCol) return;

  const p = amWorkingPoints.find(x => x.name === amDragSrc.name);
  if (p) {
    p.is_editable = (toCol === 'editable');
    amSelected[amDragSrc.fromCol].delete(amDragSrc.name);
    amRenderCols();
    amShowToast(`${p.name} ${toCol === 'locked' ? 'locked' : 'unlocked'}`);
  }
  amDragSrc = null;
}

// ─── Filter (search boxes) ─────────────────────────────────────────
function amFilterPoints() {
  amRenderCols();
}

// ─── Apply changes to the real points array ────────────────────────
async function amApplyChanges() {
  // Find only the points whose is_editable actually changed
  const changed = amWorkingPoints.filter(wp => {
    const orig = points.find(p => p.name === wp.name);
    return orig && (orig.is_editable ?? true) !== (wp.is_editable ?? true);
  });

  if (changed.length === 0) {
    closeAccessManager();
    return;
  }

  showStatus('Saving access changes…', 'info', 1200);

  for (const wp of changed) {
    await callAPI('updatePoint', { oldName: wp.name, ...wp }, null);
  }

  await loadPoints();
  closeAccessManager();
  showStatus(
    `${changed.length} point${changed.length > 1 ? 's' : ''} updated`,
    'success',
    2000
  );
}

// ─── Mini toast inside the modal ──────────────────────────────────
let amToastTimer = null;

function amShowToast(msg) {
  let toast = document.getElementById('am-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'am-toast';
    toast.className = 'am-toast';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<i class="fas fa-check-circle" style="color:#34c759"></i> ${msg}`;
  toast.classList.add('am-toast-show');
  clearTimeout(amToastTimer);
  amToastTimer = setTimeout(() => toast.classList.remove('am-toast-show'), 2000);
}

// Call this function when the page loads
document.addEventListener('DOMContentLoaded', setupToggleRows);


function callTogglePlanner(isPilz) {
  const toggleEl = document.getElementById('planner-toggle');
  fetch(`http://localhost:3000/ros/togglePlanner`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isPilz }),
  })
    .then((res) => {
      if (!res.ok) throw new Error('togglePlanner failed');
    })
    .catch((err) => {
      console.error(err);
      toggleEl.checked = !isPilz;
    });
}

document.addEventListener('DOMContentLoaded', () => {
  fetch('http://localhost:3000/ros/plannerState')
    .then((res) => res.json())
    .then((data) => {
      const toggleEl = document.getElementById('planner-toggle');
      if (toggleEl && data.success) {
        toggleEl.checked = data.isPilz;
      }
    })
    .catch((err) => console.error('Failed to load planner state:', err));
});