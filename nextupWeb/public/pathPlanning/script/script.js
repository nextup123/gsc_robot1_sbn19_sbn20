// ============================================
// API Constants and Global Variables
// ============================================
const API_BASE = "http://localhost:3000/path-planning";

let pointData = [];
let editingPathName = null;
let oldPathName = null;
let intermediatePoints = [];
let xmlContent = "";

// ROS connection variables (now using WebSocket)
let isConnected = false;
let ws = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000;

// DOM elements - Main
const startPoint = document.getElementById("startPoint");
const goalPoint = document.getElementById("goalPoint");
const planSpace = document.getElementById("planSpace");
const pathName = document.getElementById("pathName");
const intermediateDisplay = document.getElementById("intermediateDisplay");
const updateBtn = document.getElementById("updateBtn");
const sequenceList = document.getElementById("sequenceList");
const xmlOutput = document.getElementById("xmlOutput");
const pointSelect = document.getElementById("pointSelect");
const selectedPoints = document.getElementById("selectedPoints");
const intermediateModal = document.getElementById("intermediateModal");
const xmlModal = document.getElementById("xmlModal");
const statusModal = document.getElementById("statusModal");
const sequenceCount = document.getElementById("sequenceCount");
const undoBtn = document.getElementById("undoBtn");
const startPlanningBtn = document.getElementById("startPlanningBtn");

// DOM elements - ROS Status
const motionToggle = document.getElementById("motionToggle");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");

// DOM elements - Paths YAML Modal
const pathsYAMLOutput = document.getElementById("pathsYAMLOutput");
const pathsYAMLModal = document.getElementById("pathsYAMLModal");

// Store latest joint states for homing detection
// ============================================
// Toast Notification System
// ============================================
function showStatus(message, type = "success", timeout = 3000) {
  let toastContainer = document.querySelector(".toast-container");
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.className = "toast-container";
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  let icon = "info-circle";
  if (type === "success") icon = "check-circle";
  if (type === "error") icon = "exclamation-circle";
  if (type === "warning") icon = "exclamation-triangle";

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
          if (toast.parentElement) {
            toast.remove();
          }
        }, 300);
      }
    }, timeout);
  }

  return toast;
}

// ============================================
// WebSocket ROS Connection
// ============================================
function initWS() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    console.log("WebSocket connected to ROS backend");
    isConnected = true;
    reconnectAttempts = 0;
    // updateROSConnectionStatus(true);

    // Send ping to verify connection
    ws.send(JSON.stringify({ type: "PING" }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleROSMessage(msg);
    } catch (err) {
      console.error("Failed to parse WebSocket message:", err);
    }
  };

  ws.onclose = () => {
    console.log("WebSocket disconnected");
    isConnected = false;
    // updateROSConnectionStatus(false);

    // Attempt to reconnect
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      setTimeout(initWS, RECONNECT_DELAY);
    }
  };

  ws.onerror = (err) => {
    console.error("WebSocket error:", err);
    isConnected = false;
    // updateROSConnectionStatus(false);
  };
}

function handleROSMessage(msg) {
  switch (msg.type) {
    case "DRIVER_STATUS":
      updateDriverStatusFromROS(msg.payload);
      break;

    case "EMERGENCY_STATUS":
      updateEmergencyStatusFromROS(msg.payload);
      break;

    case "ACTIVE_NODES":
      updateActiveNodes(msg.payload);
      break;

    case "JOINT_STATES":
      // was: latestJointStateMsg = msg.payload; updateHomingStatus();
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
      break;

    case "MOTION_STATUS":
      updateMotionStatus(msg.payload);
      break;

    case "MOTION_ACTIVE":
      updateButtonStatus(msg.payload);
      break;

    case "MOTION_PLANNING_SUCCESS":
      showStatus("Planning Successful", "success", 2000);
      checkPathStatus();

      break;
    case "JOINT_VALUES":
    case "CARTESIAN_VALUES":
    case "DO_STATUS":
    case "CYCLE_TIME":
    case "PROCESS_STATUS":
    case "LOG_MESSAGE_INCOMING":
    case "CONTROL_ACTIVE":
    case "SERVO_RESPONSE":
      break;

  }
}

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  handleROSMessage(msg);
});

// ============================================
// ROS Status Updates
// ============================================
function updateDriverStatusFromROS(data) {
  const { jointStatus, faultStatus } = data;

  // Update joint operational LEDs if they exist in the DOM
  const robotLedOp = document.getElementById("robot-led-op");
  const jointLeds = Array.from({ length: 6 }, (_, i) =>
    document.getElementById(`joint${i + 1}-led-op`),
  );

  const allJointsOperational = jointStatus.every(Boolean);

  if (robotLedOp) {
    robotLedOp.classList.toggle("led-op-true", allJointsOperational);
    robotLedOp.classList.toggle("led-op-false", !allJointsOperational);
  }

  jointStatus.forEach((status, i) => {
    const led = jointLeds[i];
    if (led) {
      led.classList.toggle("joint-indicator-true", status);
      led.classList.toggle("joint-indicator-false", !status);
    }
  });

  // Update fault LEDs
  const robotLedFault = document.getElementById("robot-led-fault");
  const faultLeds = Array.from({ length: 6 }, (_, i) =>
    document.getElementById(`joint${i + 1}-led-fault`),
  );
  const anyFault = faultStatus.some(Boolean);

  if (robotLedFault) {
    robotLedFault.classList.toggle("led-fault-true", !anyFault);
    robotLedFault.classList.toggle("led-fault-false", anyFault);
  }

  faultStatus.forEach((hasFault, i) => {
    const led = faultLeds[i];
    if (led) {
      led.classList.toggle("joint-indicator-true", !hasFault);
      led.classList.toggle("joint-indicator-false", hasFault);
    }
  });
}

function updateEmergencyStatusFromROS(data) {
  const emergencyStatus = data.jointStatus;
  const anyEmergency = emergencyStatus.some(Boolean);

  const robotLedEmergency = document.getElementById("robot-led-emergency");
  const emergencyLeds = Array.from({ length: 6 }, (_, i) =>
    document.getElementById(`joint${i + 1}-led-emergency`),
  );

  if (robotLedEmergency) {
    robotLedEmergency.classList.toggle("led-emergency-true", anyEmergency);
    robotLedEmergency.classList.toggle("led-emergency-false", !anyEmergency);
  }

  emergencyStatus.forEach((hasEmergency, i) => {
    const led = emergencyLeds[i];
    if (led) {
      led.classList.toggle("joint-indicator-true", !hasEmergency);
      led.classList.toggle("joint-indicator-false", hasEmergency);
    }
  });
}


function updateMotionStatus(status) {
  if (status[0] === "r") {
    statusDot.className = "status-dot status-running";
    statusText.textContent = "Running";
    motionToggle.checked = true;
  } else {
    statusDot.className = "status-dot status-stopped";
    statusText.textContent = "Stopped";
    motionToggle.checked = false;
  }
}

function updateButtonStatus(isActive) {
  if (isActive) {
    // statusDot.className = 'status-dot status-active';
    statusText.textContent = "Active";
    if (startPlanningBtn) startPlanningBtn.disabled = false;
  } else {
    // statusDot.className = 'status-dot status-inactive';
    statusText.textContent = "Inactive";
    if (startPlanningBtn) startPlanningBtn.disabled = true;
  }
}

function updateActiveNodes(activeList) {
  const loadingCount = document.getElementById("loadingCount");
  const progressFill = document.getElementById("progressFill");
  const loadingText = document.getElementById("loadingText");

  if (!loadingCount) return;

  // This assumes you have a global loaderState or similar
  if (window.loaderState && window.loaderState.expectedSet) {
    let activeExpectedCount = 0;
    window.loaderState.expectedSet.forEach((name) => {
      if (activeList.includes(name)) activeExpectedCount++;
    });

    const total = window.loaderState.totalCount;
    const percentage =
      total === 0 ? 0 : Math.floor((activeExpectedCount / total) * 100);

    if (progressFill) progressFill.style.width = `${percentage}%`;
    if (loadingText) loadingText.textContent = `${percentage}%`;
    loadingCount.textContent = `${activeExpectedCount} / ${total}`;

    if (percentage === 100) {
      const loadingScreen = document.getElementById("loadingScreen");
      if (loadingScreen)
        setTimeout(() => loadingScreen.classList.add("hidden"), 500);
    }
  }
}

// ============================================
// ROS Command Senders
// ============================================
function sendROSCommand(type, payload = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showStatus("ROS connection not available", "error", 2000);
    return false;
  }

  ws.send(JSON.stringify({ type, payload }));
  return true;
}

function publishMotionCommand(command) {
  sendROSCommand("MOTION_COMMAND", { command });
}

async function startMotionBtFun() {
  try {
    const response = await fetch(`http://localhost:3000/ros/startPlanning`, {
      method: "GET"
    });
    const data = await response.json();
    setTimeout(() => {
      checkPathStatus()
    }, 1300);
  } catch (error) {
    showStatus("Planning Failed", "error", 2000);

    console.error("Error:", error);
  }
}

function autoGeneratePaths() {
  sendROSCommand("AUTO_GENERATE_XML", { data: true });
  setTimeout(() => {
    reloadPaths();
  }, 500);
}

function triggerEmergency() {
  sendROSCommand("EMERGENCY_TRIGGER");
  showStatus("Emergency triggered", "warning", 2000);
}

function resetFault() {
  console.log("Reset triggered from pathPlanning_js");
  sendROSCommand("RESET_FAULT");
  showStatus("Fault reset sent", "success", 2000);
}

// ============================================
// XML Modal Functions
// ============================================
let currentFontSize = 11;

function closeStatusModal() {
  statusModal.style.display = "none";
}

function openXMLModal() {
  reloadXML();
  xmlOutput.textContent = xmlContent || "No XML available";
  xmlModal.style.display = "flex";
}

function closeXMLModal() {
  xmlModal.style.display = "none";
}

function changeFontSize(delta) {
  currentFontSize += delta;
  if (currentFontSize < 7) currentFontSize = 7;
  if (currentFontSize > 24) currentFontSize = 24;
  document.getElementById("xmlOutput").style.fontSize = currentFontSize + "px";
}

function copyXML() {
  navigator.clipboard
    .writeText(xmlOutput.textContent)
    .then(() => showStatus("XML copied to clipboard", "success", 2000))
    .catch(() => showStatus("Failed to copy XML", "error", 3000));
}

// ============================================
// Points Management
// ============================================
async function loadPoints() {
  try {
    const res = await fetch(`${API_BASE}/getPointNames`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    console.log("Reached here");
    pointData = await res.json();
    populateDropdowns();
    updateIntermediateModal();
    showStatus(`Reloaded ${pointData.length} points`, "success", 1500);
  } catch (err) {
    showStatus(`Failed to reload points: ${err.message}`, "error", 2000);
    console.error(err);
  }
}

function populateDropdowns() {
  const startValue = startPoint.value;
  const goalValue = goalPoint.value;

  startPoint.innerHTML = '<option value="">Select point</option>';
  goalPoint.innerHTML = '<option value="">Select point</option>';

  pointData.forEach((p) => {
    if (p !== goalValue) startPoint.add(new Option(p, p));
    if (p !== startValue) goalPoint.add(new Option(p, p));
  });

  startPoint.value = startValue;
  goalPoint.value = goalValue;

  // Remove old listeners and add new ones
  startPoint.removeEventListener("change", handleStartPointChange);
  goalPoint.removeEventListener("change", handleGoalPointChange);

  startPoint.addEventListener("change", handleStartPointChange);
  goalPoint.addEventListener("change", handleGoalPointChange);
}

function handleStartPointChange() {
  const newGoalOptions = pointData.filter((p) => p !== startPoint.value);
  const currentGoal = goalPoint.value;
  goalPoint.innerHTML = '<option value="">Select point</option>';
  newGoalOptions.forEach((p) => goalPoint.add(new Option(p, p)));
  goalPoint.value =
    currentGoal && newGoalOptions.includes(currentGoal) ? currentGoal : "";
  updatePathName();
  updateIntermediateModal();
}

function handleGoalPointChange() {
  const newStartOptions = pointData.filter((p) => p !== goalPoint.value);
  const currentStart = startPoint.value;
  startPoint.innerHTML = '<option value="">Select point</option>';
  newStartOptions.forEach((p) => startPoint.add(new Option(p, p)));
  startPoint.value =
    currentStart && newStartOptions.includes(currentStart) ? currentStart : "";
  updatePathName();
  updateIntermediateModal();
}

// ============================================
// Path Name and Intermediate Points
// ============================================
function updatePathName() {
  const points = [
    startPoint.value,
    ...intermediatePoints,
    goalPoint.value,
  ].filter(Boolean);
  pathName.value = points.length >= 2 ? points.join("_") : "";
  intermediateDisplay.textContent =
    intermediatePoints.length > 0
      ? `Selected: ${intermediatePoints.join(" → ")}`
      : "No points selected";
}

function openIntermediateModal() {
  if (!startPoint.value || !goalPoint.value) {
    showStatus("Select start and goal points first", "error", 3000);
    return;
  }
  updateIntermediateModal();
  intermediateModal.style.display = "flex";
}

function closeIntermediateModal() {
  intermediateModal.style.display = "none";
}

function updateIntermediateModal() {
  const availablePoints = pointData.filter(
    (p) =>
      p !== startPoint.value &&
      p !== goalPoint.value &&
      !intermediatePoints.includes(p),
  );
  pointSelect.innerHTML = '<option value="">Select point</option>';
  availablePoints.forEach((p) => pointSelect.add(new Option(p, p)));

  selectedPoints.innerHTML = "";
  if (intermediatePoints.length === 0) {
    selectedPoints.innerHTML =
      '<div class="empty-state"><i class="fas fa-dot-circle"></i><p>No points selected</p></div>';
  } else {
    intermediatePoints.forEach((point, index) => {
      const div = document.createElement("div");
      div.className = "point-item";
      div.draggable = true;
      div.dataset.point = point;
      div.innerHTML = `
                <span>${point}</span>
                <div class="point-actions">
                    <button class="btn-icon btn-delete" onclick="window.removeIntermediatePoint(${index})">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
      selectedPoints.appendChild(div);
    });
  }

  initPointDragAndDrop();
}

function addIntermediatePoint() {
  const selectedPoint = pointSelect.value;
  if (!selectedPoint) {
    showStatus("Select a point to add", "error", 3000);
    return;
  }
  intermediatePoints.push(selectedPoint);
  updatePathName();
  updateIntermediateModal();
}

function removeIntermediatePoint(index) {
  intermediatePoints.splice(index, 1);
  updatePathName();
  updateIntermediateModal();
}

function initPointDragAndDrop() {
  const items = selectedPoints.querySelectorAll(".point-item");
  items.forEach((item) => {
    item.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", item.dataset.point);
      item.classList.add("dragging");
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
    });
    item.addEventListener("dragover", (e) => e.preventDefault());
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      const draggedPoint = e.dataTransfer.getData("text/plain");
      const targetItem = e.target.closest(".point-item");
      if (!targetItem || draggedPoint === targetItem.dataset.point) return;

      const items = Array.from(selectedPoints.querySelectorAll(".point-item"));
      const draggedItem = selectedPoints.querySelector(
        `.point-item[data-point="${draggedPoint}"]`,
      );
      const targetIndex = items.indexOf(targetItem);
      const draggedIndex = items.indexOf(draggedItem);

      intermediatePoints.splice(draggedIndex, 1);
      intermediatePoints.splice(targetIndex, 0, draggedPoint);
      updatePathName();
      updateIntermediateModal();
    });
  });
}

function saveIntermediatePoints() {
  updatePathName();
  closeIntermediateModal();
}

// ============================================
// Sequences Management
// ============================================
async function loadSequences() {
  try {
    const res = await fetch(`${API_BASE}/getTreeData`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const sequences = await res.json();

    sequenceList.innerHTML = "";
    sequenceCount.textContent = sequences.length;

    if (sequences.length === 0) {
      sequenceList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <p>No paths added yet</p>
                    <small>Start by creating a path using the editor</small>
                </div>
            `;
      return;
    }

    sequences.forEach((seq, index) => {
      const div = document.createElement("div");
      div.className = "sequence-item";
      div.draggable = true;
      div.dataset.name = seq.name;

      const intermediatePointsList = seq.intermediateGoal
        ? seq.intermediateGoal.split(",")
        : [];

      let pathVisualization = `
                <div class="path-visualization">
                    <span class="path-point path-start">${seq.startPoint}</span>
            `;

      if (intermediatePointsList.length > 0) {
        pathVisualization += `<span class="path-arrow">→</span>`;
        intermediatePointsList.forEach((point, idx) => {
          pathVisualization += `
                        <span class="path-point path-intermediate">${point}</span>
                        ${idx < intermediatePointsList.length - 1 ? '<span class="path-arrow">→</span>' : ""}
                    `;
        });
      }

      pathVisualization += `
                <span class="path-arrow">→</span>
                <span class="path-point path-goal">${seq.goalPoint}</span>
                </div>
            `;

      const details = `
                <div class="sequence-details">
                    <span class="badge badge-primary">${seq.name}</span>
                    <span class="badge badge-secondary">${seq.planSpace}</span>
                </div>
            `;

      div.innerHTML = `
                <div class="sequence-index-container">
                    <span class="drag-handle"></span>
                    <span class="sequence-index status-red">${index + 1}</span>
                </div>
                <div class="sequence-content">
                    ${details}
                    ${pathVisualization}
                </div>
                <div class="sequence-actions">
                    <button class="btn-icon btn-edit" onclick="window.editPath('${seq.name}', '${seq.startPoint}', '${seq.goalPoint}', '${seq.planSpace}', '${seq.intermediateGoal}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-icon btn-delete" onclick="window.deletePath('${seq.name}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
      sequenceList.appendChild(div);
    });

    showStatus(`Reloaded ${sequences.length} sequences`, "success", 1000);
    initDragAndDrop();
  } catch (err) {
    showStatus(`Failed to reload sequences: ${err.message}`, "error", 3000);
    console.error(err);
  }
}

function initDragAndDrop() {
  const items = sequenceList.querySelectorAll(".sequence-item");
  items.forEach((item) => {
    item.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", item.dataset.name);
      item.classList.add("dragging");
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
    });
    item.addEventListener("dragover", (e) => e.preventDefault());
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      const draggedName = e.dataTransfer.getData("text/plain");
      const targetItem = e.target.closest(".sequence-item");
      if (!targetItem || draggedName === targetItem.dataset.name) return;

      const items = Array.from(sequenceList.querySelectorAll(".sequence-item"));
      const draggedItem = sequenceList.querySelector(
        `.sequence-item[data-name="${draggedName}"]`,
      );
      const targetIndex = items.indexOf(targetItem);
      const draggedIndex = items.indexOf(draggedItem);

      if (draggedIndex < targetIndex) {
        targetItem.after(draggedItem);
      } else {
        targetItem.before(draggedItem);
      }

      const newOrder = Array.from(
        sequenceList.querySelectorAll(".sequence-item"),
      ).map((item) => item.dataset.name);
      reorderSequences(newOrder);
    });
  });
}

async function reorderSequences(sequenceNames) {
  await callAPI("reorderSequences", { sequenceNames }, loadSequences);
}

// ============================================
// Path CRUD Operations
// ============================================
async function addPath() {
  if (
    !startPoint.value ||
    !goalPoint.value ||
    !planSpace.value ||
    !pathName.value
  ) {
    showStatus("All required fields must be filled", "error", 3000);
    return;
  }
  const body = {
    startPoint: startPoint.value,
    goalPoint: goalPoint.value,
    planSpace: planSpace.value,
    pathName: pathName.value,
    intermediateGoal: intermediatePoints.join(","),
  };
  await callAPI("addPlanPath", body, () => {
    clearForm();
    loadSequences();
  });
}

async function updatePath() {
  if (
    !editingPathName ||
    !startPoint.value ||
    !goalPoint.value ||
    !planSpace.value ||
    !pathName.value
  ) {
    showStatus("All required fields must be filled", "error", 3000);
    return;
  }
  const body = {
    oldPathName: oldPathName,
    newPathName: pathName.value,
    startPoint: startPoint.value,
    goalPoint: goalPoint.value,
    planSpace: planSpace.value,
    intermediateGoal: intermediatePoints.join(","),
  };
  await callAPI("updatePlanPath", body, () => {
    clearForm();
    loadSequences();
  });
}

function editPath(name, start, goal, space, intermediate) {
  editingPathName = name;
  oldPathName = name;
  startPoint.value = start;
  goalPoint.value = goal;
  planSpace.value = space;
  intermediatePoints = intermediate ? intermediate.split(",") : [];
  updatePathName();
  updateBtn.disabled = false;
  showStatus(`Editing ${name}`, "success", 2000);
}

// async function deletePath(pathName) {
//   if (confirm(`Delete ${pathName}?`)) {
//     await callAPI("deletePath", { pathName }, loadSequences);
//   }
// }

// async function deleteLast() {
//   if (confirm("Delete the last sequence?")) {
//     await callAPI("deleteLast", {}, loadSequences);
//   }
// }

// async function deleteAll() {
//   if (confirm("Delete all sequences?")) {
//     await callAPI("deleteAll", {}, loadSequences);
//   }
// }

// ============================================
// Confirm Modal
// ============================================
const confirmModal = document.getElementById("confirmModal");

function showConfirmModal(title, message, onConfirm) {
  document.getElementById("confirmModalTitle").textContent = title;
  document.getElementById("confirmModalMessage").textContent = message;
  const okBtn = document.getElementById("confirmModalOkBtn");
  okBtn.onclick = () => {
    closeConfirmModal();
    onConfirm();
  };
  confirmModal.style.display = "flex";
}

function closeConfirmModal() {
  confirmModal.style.display = "none";
}

// ============================================
// Path CRUD Operations  (updated)
// ============================================
async function deletePath(name) {
  showConfirmModal(
    "Delete path?",
    `This will permanently remove "${name}".`,
    async () => await callAPI("deletePath", { pathName: name }, loadSequences)
  );
}

async function deleteLast() {
  showConfirmModal(
    "Delete last path?",
    "This will remove the last sequence in the list.",
    async () => await callAPI("deleteLast", {}, loadSequences)
  );
}

async function deleteAll() {
  showConfirmModal(
    "Delete all paths?",
    "This will permanently remove every sequence. This action cannot be undone.",
    async () => await callAPI("deleteAll", {}, loadSequences)
  );
}


// ============================================
// API Call Function
// ============================================
async function callAPI(endpoint, body, callback) {
  showStatus("Processing...", "process", 1000);
  try {
    const res = await fetch(`${API_BASE}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      xmlContent = data.xml || "No XML returned";
      showStatus(data.message, "success", 2000);
      if (callback) callback();
    } else {
      xmlContent = `Error: ${data.message}`;
      showStatus(data.message, "error", 3000);
    }
  } catch (err) {
    xmlContent = `Error: ${err.message}`;
    showStatus(`Connection error: ${err.message}`, "error", 3000);
  }
}

// ============================================
// Form Management
// ============================================
function clearForm() {
  startPoint.value = "";
  goalPoint.value = "";
  planSpace.value = "cartesian";
  pathName.value = "";
  intermediatePoints = [];
  editingPathName = null;
  oldPathName = null;
  updateBtn.disabled = true;
  populateDropdowns();
  updatePathName();
}

async function reloadXML() {
  await callAPI("getXML", {}, () => {
    xmlOutput.textContent = xmlContent || "No XML available";
  });
}

function reloadPaths() {
  loadSequences();
  setTimeout(() => {
    checkPathStatus();
  }, 500);

  // setTimeout(updateOriginPointFileName, 400);
}

function reloadPoints() {
  loadPoints();
  // setTimeout(updatePointFileName, 400);
}

// ============================================
// Auto Generate Functions
// ============================================
function autoGenOpenPopup() {
  const popup = document.getElementById("auto-gen-popup");
  if (popup) {
    popup.style.display = "flex";
    const messageEl = document.getElementById("auto-gen-popup-message");
    if (messageEl) messageEl.textContent = "";
  }
}

function autoGenClosePopup() {
  const popup = document.getElementById("auto-gen-popup");
  if (popup) popup.style.display = "none";
}

function autoGenPublishDefault() {
  sendROSCommand("AUTO_GENERATE_SEQUENCE", { data: "default" });
  setTimeout(() => {
    reloadPaths();
    reloadPoints();
  }, 2000);
  autoGenShowSuccess("Default auto-generate published!");
}

function autoGenPublishSequence() {
  const rawInput = document
    .getElementById("auto-gen-sequence-input")
    .value.trim();

  if (!/^[0-9,]+$/.test(rawInput)) {
    autoGenShowError("Only numbers and commas are allowed!");
    return;
  }

  const groups = rawInput.split(",").map((group) => group.split("").join(","));
  const formatted = groups.join("&");

  sendROSCommand("AUTO_GENERATE_SEQUENCE", { data: formatted });

  setTimeout(() => {
    reloadPaths();
  }, 2000);

  autoGenShowSuccess(`Sequence [${formatted}] published!`);
}

function autoGenShowSuccess(text) {
  const message = document.getElementById("auto-gen-popup-message");
  if (message) {
    message.style.color = "#34c759";
    message.textContent = text;
  }
  setTimeout(autoGenClosePopup, 700);
}

function autoGenShowError(text) {
  const message = document.getElementById("auto-gen-popup-message");
  if (message) {
    message.style.color = "#ff3b30";
    message.textContent = text;
  }
}

// ============================================
// Path Status Checking
// ============================================
async function checkPathStatus() {
  try {
    const res = await fetch(`${API_BASE}/getPathNames`);
    if (!res.ok)
      throw new Error(`Server returned ${res.status}: ${await res.text()}`);
    const pathNames = await res.json();
    const sequences = await (await fetch(`${API_BASE}/getTreeData`)).json();

    const sequenceNames = sequences.map((s) =>
      s.name.startsWith("plan_") ? s.name.slice(5) : s.name,
    );
    const extraPathNames = pathNames.filter(
      (name) => !sequenceNames.includes(name),
    );

    if (extraPathNames.length > 0) {
      showStatus("Extra Paths Found: check console for names", "process", 5000);
      sendROSCommand("LOG_MESSAGE", { data: extraPathNames.join(" | ") });
    } else {
      showStatus("No Extra Path Found...", "success", 1000);
    }

    sequenceList.querySelectorAll(".sequence-item").forEach((item) => {
      const seqName = item.dataset.name.startsWith("plan_")
        ? item.dataset.name.slice(5)
        : item.dataset.name;
      const indexSpan = item.querySelector(".sequence-index");
      if (pathNames.includes(seqName)) {
        indexSpan.classList.add("status-green");
        indexSpan.classList.remove("status-red");
      } else {
        indexSpan.classList.add("status-red");
        indexSpan.classList.remove("status-green");
      }
    });
    showStatus("Path status updated", "success", 1500);
  } catch (err) {
    showStatus(`Failed to check path status: ${err.message}`, "error", 2000);
    console.error("Error in checkPathStatus:", err);
  }
}

// ============================================
// File Name Updates
// // ============================================
// async function updateOriginPointFileName() {
//   try {
//     const res = await fetch(`${API_BASE}/getOriginPointFileName`);
//     if (!res.ok)
//       throw new Error(`Server returned ${res.status}: ${await res.text()}`);
//     const data = await res.json();
//     const originElement = document.getElementById("origin-point-file-name");
//     if (originElement) {
//       originElement.textContent =
//         data.originPointFileName || "No origin file name";
//     } else {
//       console.error("Origin point file name element not found");
//     }
//   } catch (err) {
//     showStatus(
//       `Failed to update origin point file name: ${err.message}`,
//       "error",
//       2000,
//     );
//     console.error("Error in updateOriginPointFileName:", err);
//   }
// }

// async function updatePointFileName() {
//   try {
//     const res = await fetch(`${API_BASE}/getPointFileName`);
//     if (!res.ok)
//       throw new Error(`Server returned ${res.status}: ${await res.text()}`);
//     const data = await res.json();
//     const pointElement = document.getElementById("point-file-name");
//     if (pointElement) {
//       pointElement.textContent = data.pointFileName || "No point file name";
//     } else {
//       console.error("Point file name element not found");
//     }
//   } catch (err) {
//     showStatus(
//       `Failed to update point file name: ${err.message}`,
//       "error",
//       2000,
//     );
//     console.error("Error in updatePointFileName:", err);
//   }
// }

// ============================================
// Paths YAML Modal Functions
// ============================================
function openPathsYAMLModal() {
  reloadPathsYAML();
  pathsYAMLOutput.textContent = pathsYAMLContent || "No YAML available";
  pathsYAMLModal.style.display = "flex";
}

function closePathsYAMLModal() {
  pathsYAMLModal.style.display = "none";
}

let pathsYAMLFontSize = 11;

function changePathsYAMLFontSize(delta) {
  pathsYAMLFontSize += delta;
  if (pathsYAMLFontSize < 7) pathsYAMLFontSize = 7;
  if (pathsYAMLFontSize > 24) pathsYAMLFontSize = 24;
  pathsYAMLOutput.style.fontSize = pathsYAMLFontSize + "px";
}

function copyPathsYAML() {
  navigator.clipboard
    .writeText(pathsYAMLOutput.textContent)
    .then(() => showStatus("Paths YAML copied to clipboard", "success", 2000))
    .catch(() => showStatus("Failed to copy Paths YAML", "error", 3000));
}

async function reloadPathsYAML() {
  try {
    const res = await fetch(`${API_BASE}/getPathsYAML`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    const pathsData = data.paths || [];
    pathsYAMLContent = jsyaml.dump({ paths: pathsData });
    pathsYAMLOutput.textContent = pathsYAMLContent || "No YAML available";
    showStatus("Paths YAML reloaded", "success", 1500);
  } catch (err) {
    pathsYAMLOutput.textContent = "Failed to load Paths YAML";
    showStatus(`Failed to reload Paths YAML: ${err.message}`, "error", 2000);
    console.error(err);
  }
}

function showFullPathsYAML() {
  reloadPathsYAML();
}

function showNamesOnlyYAML() {
  fetch(`${API_BASE}/getPathsYAML`)
    .then((res) => res.json())
    .then((data) => {
      const names = (data.paths || []).map((p) => p.name);
      pathsYAMLContent = jsyaml.dump({ paths: names });
      pathsYAMLOutput.textContent = pathsYAMLContent || "No YAML available";
      showStatus("Switched to Names Only view", "success", 1500);
    })
    .catch((err) => {
      showStatus(`Failed to load names: ${err.message}`, "error", 2000);
    });
}

// ============================================
// Undo Functionality
// ============================================
async function makeRequest(endpoint, options = {}) {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...options,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || `HTTP error! status: ${response.status}`);
    }

    return data;
  } catch (error) {
    showStatus(`Error: ${error.message}`, false);
    throw error;
  }
}

async function checkUndo() {
  try {
    if (undoBtn) {
      undoBtn.disabled = true;
      const data = await makeRequest("/canUndo");
      undoBtn.disabled = !data.canUndo;
    }
  } catch (error) {
    if (undoBtn) undoBtn.disabled = true;
    console.error("Failed to check undo:", error);
  }
}

async function performUndo() {
  try {
    if (undoBtn) undoBtn.disabled = true;
    const data = await makeRequest("/undo", { method: "POST" });
    showStatus("Undo Done...", "success", 1000);
    setTimeout(checkUndo, 800);
    setTimeout(reloadPaths, 1000);
  } catch (error) {
    console.error("Failed to undo:", error);
    checkUndo();
  }
}

// ============================================
// Motion Toggle Handler
// ============================================
if (motionToggle) {
  motionToggle.addEventListener("change", function () {
    if (isConnected && ws && ws.readyState === WebSocket.OPEN) {
      const command = motionToggle.checked ? "start" : "stop";
      publishMotionCommand(command);
    } else {
      showStatus("ROS not connected", "error", 2000);
      motionToggle.checked = false;
    }
  });
}

// ============================================
// Initialization
// ============================================
async function init() {
  await loadPoints();
  await loadSequences();
  checkUndo();
  initWS();

  setTimeout(() => {
    // updatePointFileName();
    // setTimeout(updateOriginPointFileName, 400);
    setTimeout(checkPathStatus, 800);
  }, 500);
}

// Expose functions to global scope for HTML onclick handlers
window.removeIntermediatePoint = removeIntermediatePoint;
window.editPath = editPath;
window.deletePath = deletePath;
window.checkPathStatus = checkPathStatus;
// window.updateOriginPointFileName = updateOriginPointFileName;
// window.updatePointFileName = updatePointFileName;
window.autoGenOpenPopup = autoGenOpenPopup;
window.autoGenClosePopup = autoGenClosePopup;
window.autoGenPublishDefault = autoGenPublishDefault;
window.autoGenPublishSequence = autoGenPublishSequence;
window.openPathsYAMLModal = openPathsYAMLModal;
window.closePathsYAMLModal = closePathsYAMLModal;
window.changePathsYAMLFontSize = changePathsYAMLFontSize;
window.copyPathsYAML = copyPathsYAML;
window.showFullPathsYAML = showFullPathsYAML;
window.showNamesOnlyYAML = showNamesOnlyYAML;
window.performUndo = performUndo;
window.addPath = addPath;
window.updatePath = updatePath;
window.deleteLast = deleteLast;
window.deleteAll = deleteAll;
window.openXMLModal = openXMLModal;
window.closeXMLModal = closeXMLModal;
window.changeFontSize = changeFontSize;
window.copyXML = copyXML;
window.openIntermediateModal = openIntermediateModal;
window.closeIntermediateModal = closeIntermediateModal;
window.addIntermediatePoint = addIntermediatePoint;
window.saveIntermediatePoints = saveIntermediatePoints;
window.reloadPaths = reloadPaths;
window.reloadPoints = reloadPoints;
window.autoGeneratePaths = autoGeneratePaths;
window.startMotionBtFun = startMotionBtFun;
window.triggerEmergency = triggerEmergency;
window.resetFault = resetFault;

// Initialize everything when DOM is ready
document.addEventListener("DOMContentLoaded", function () {
  // In each child iframe (e.g., pointPlanning section)
window.parent.postMessage({
  type: "REGISTER_PAGE",
  payload: {
    pageId: "page2",  // must match the iframe ID in mainWeb
    messageTypes: ["JOINT_STATES", "CARTESIAN_VALUES", "DRIVER_STATUS","MOTION_STATUS", "MOTION_ACTIVE", "MOTION_PLANNING_SUCCESS"]
  }
}, "*");
  init();
});
