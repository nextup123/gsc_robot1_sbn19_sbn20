// ===================== WS SETUP =====================
const ws = new WebSocket(`ws://${location.host}`);

ws.onopen = () => {
    console.log("✅ WS Connected");
};

ws.onclose = () => {
    console.warn("❌ WS Disconnected");
};

ws.onerror = (err) => {
    console.error("WS Error:", err);
};

// ===================== GLOBAL STATUS =====================
window.robotStatus = {
    operational: { allOperational: false },
    emergency: { anyEmergency: false },
    running: { anyRunning: false },
    homing: { jointStatus: [], allHomed: false }
};

// ===================== WS MESSAGE HANDLER =====================
ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
        case "DRIVER_STATUS":
            window.robotStatus.operational = {
                allOperational: msg.payload.jointStatus.every(Boolean)
            };
            updateButtonStates();
            break;

        case "EMERGENCY_STATUS":
            window.robotStatus.emergency = {
                anyEmergency: msg.payload.jointStatus.some(Boolean)
            };
            updateButtonStates();
            break;

        case "JOINT_STATES":
            latestJointStateMsg = msg.payload;
            break;

        default:
            console.warn("Unknown WS message:", msg);
    }
};

// ===================== POPUP =====================
const popup = document.createElement('div');
popup.id = 'statusPopup';
popup.style.display = 'none';
popup.style.position = 'fixed';
popup.style.top = '50%';
popup.style.left = '50%';
popup.style.transform = 'translate(-50%, -50%)';
popup.style.backgroundColor = '#2d2d2d';
popup.style.padding = '20px';
popup.style.borderRadius = '8px';
popup.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
popup.style.zIndex = '1000';
popup.style.color = 'white';
popup.style.fontFamily = "'Roboto Mono', monospace";
popup.style.textAlign = 'center';

const popupMessage = document.createElement('p');
popupMessage.style.marginBottom = '20px';

const popupOkButton = document.createElement('button');
popupOkButton.textContent = 'OK';
popupOkButton.style.padding = '8px 16px';
popupOkButton.style.backgroundColor = '#4CAF50';
popupOkButton.style.color = 'white';
popupOkButton.style.border = 'none';
popupOkButton.style.borderRadius = '4px';
popupOkButton.style.cursor = 'pointer';

popupOkButton.addEventListener('click', () => {
    popup.style.display = 'none';
});

popup.appendChild(popupMessage);
popup.appendChild(popupOkButton);
document.body.appendChild(popup);

function showPopup(message) {
    popupMessage.textContent = message;
    popup.style.display = 'block';
}

// ===================== COOLDOWN =====================
const ACTION_COOLDOWN_MS = 2000;

function applyCooldown(button, cooldownMs = ACTION_COOLDOWN_MS) {
    button.disabled = true;
    button.style.opacity = '0.4';
    button.style.cursor = 'not-allowed';

    setTimeout(() => {
        button.disabled = false;
        button.style.opacity = '1';
        button.style.cursor = 'pointer';
    }, cooldownMs);
}

// ===================== BUTTONS =====================
const homeButton = document.getElementById('homeButton');
const resetButton = document.getElementById('resetButton');
const emergencyButton = document.getElementById('emergency-button');

// ===================== HOME =====================
homeButton.addEventListener('click', () => {
    const status = window.robotStatus;

    if (!status.operational.allOperational) {
        showPopup("Cannot HOME: Not all joints are operational");
        return;
    }
    if (status.emergency.anyEmergency) {
        showPopup("Cannot HOME: Emergency condition detected");
        return;
    }
    if (status.running.anyRunning) {
        showPopup("Cannot HOME: Some joints are still running");
        return;
    }

    ws.send(JSON.stringify({
        type: "MOTION_COMMAND",
        payload: { command: "home" }
    }));

    applyCooldown(homeButton);
});

// ===================== RESET =====================
resetButton.addEventListener('click', () => {
        console.log("Reset Pressed")
    const status = window.robotStatus;

    if (status.emergency.anyEmergency) {
        showPopup("Cannot RESET: Emergency condition detected");
        return;
    }

    ws.send(JSON.stringify({
        type: "RESET_FAULT"
    }));

    applyCooldown(resetButton);
});

// ===================== EMERGENCY =====================
emergencyButton.addEventListener('click', () => {
    ws.send(JSON.stringify({
        type: "EMERGENCY_TRIGGER"
    }));
    console.log("🚨 Emergency Trigger Sent");
});

// ===================== BUTTON STATE =====================
function updateButtonStates() {
    const status = window.robotStatus;

    const homeEnabled =
        status.operational.allOperational &&
        !status.emergency.anyEmergency &&
        !status.running.anyRunning;

    homeButton.disabled = !homeEnabled;
    homeButton.style.opacity = homeEnabled ? '1' : '0.6';

    const resetEnabled = !status.emergency.anyEmergency;
    resetButton.disabled = !resetEnabled;
    resetButton.style.opacity = resetEnabled ? '1' : '0.6';
}