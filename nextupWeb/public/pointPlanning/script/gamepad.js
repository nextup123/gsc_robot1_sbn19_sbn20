

/* ================= MODAL CONTROL ================= */
const modalGP = document.getElementById('gamepad-modal');
const backdrop = document.getElementById('gamepad-modal-backdrop');
const openBtnGP = document.getElementById('gamepad-open-btn');
const closeBtnGP = document.getElementById('gamepad-modal-close');
const rateSlider = document.getElementById('gamepad-rate-slider');
const rateValue = document.getElementById('gamepad-rate-value');

openBtnGP.addEventListener('click', () => {
    modalGP.style.display = 'block';
    backdrop.style.display = 'block';
    publishingActive = true;
    updateControlStatus();
});

closeBtnGP.addEventListener('click', closeModalGP);
backdrop.addEventListener('click', closeModalGP);

function closeModalGP() {
    modalGP.style.display = 'none';
    backdrop.style.display = 'none';
    publishingActive = false;
    stopJogGP();
    updateControlStatus();
}

function updateControlStatus() {
    const controlValue = document.getElementById('gamepad-control-value');
    if (publishingActive) {
        controlValue.textContent = 'ACTIVE';
        controlValue.className = 'active';
    } else {
        controlValue.textContent = 'INACTIVE';
        controlValue.className = 'inactive';
    }
}

function msToHz(ms) {
    return (1000 / ms).toFixed(1);
}

function updateRateDisplay() {
    const hz = msToHz(publishInterval);
    rateValue.textContent = `${hz} Hz`;
}

rateSlider.addEventListener('input', () => {
    publishInterval = parseInt(rateSlider.value);
    updateRateDisplay();

    // Restart jog interval with new rate if active
    if (jogIntervalGP) {
        clearInterval(jogIntervalGP);
        jogIntervalGP = setInterval(() => {
            if (activeJogGP && lastCommand && publishingActive) {
                ros2Publish(lastCommand);
            }
        }, publishInterval);
    }
});

// Initialize rate display
updateRateDisplay();

/* ================= JOG CORE ================= */
let activeJogGP = null;
let jogIntervalGP = null;
let lastCommand = null;

function stopJogGP() {
    if (!activeJogGP) return;
    clearInterval(jogIntervalGP);
    jogIntervalGP = null;
    if (lastCommand !== `0${activeJogGP}`) {
        ros2Publish(`0${activeJogGP}`);
        lastCommand = `0${activeJogGP}`;
    }
    activeJogGP = null;
    document.getElementById('gamepad-command-value').textContent = '—';
}

function startJogGP(direction, joint) {
    if (activeJogGP === joint) return;
    if (activeJogGP) stopJogGP();

    activeJogGP = joint;
    const command = `${direction}${joint}`;

    if (lastCommand !== command) {
        ros2Publish(command);
        lastCommand = command;
    }

    document.getElementById('gamepad-command-value').textContent = command;

    jogIntervalGP = setInterval(() => {
        if (publishingActive && lastCommand) {
            ros2Publish(lastCommand);
        }
    }, publishInterval);
}

/* ================= GAMEPAD ================= */
const DEADMAN = 0.2;
const DEADZONE = 0.12;
let gamepadConnected = false;

function updateAxis(id, value) {
    const element = document.getElementById(`gamepad-${id}`);
    if (element) {
        element.textContent = value.toFixed(2);
        // Color coding for visualization
        if (Math.abs(value) > DEADZONE) {
            element.style.color = value > 0 ? 'var(--green)' : 'var(--red)';
        } else {
            element.style.color = 'var(--text)';
        }
    }
}

function dir(v) {
    if (Math.abs(v) < DEADZONE) return null;
    return v > 0 ? '+' : '-';
}

function teleopLoop() {
    const gamepads = navigator.getGamepads();
    const gp = gamepads[0];

    if (!gp) {
        if (gamepadConnected) {
            gamepadConnected = false;
            document.getElementById('gamepad-gamepad-status').textContent = 'Disconnected';
            document.getElementById('gamepad-gamepad-status').className = 'gamepad-compact-value disconnected';
        }
        requestAnimationFrame(teleopLoop);
        return;
    }

    if (!gamepadConnected) {
        gamepadConnected = true;
        document.getElementById('gamepad-gamepad-status').textContent = 'Connected';
        document.getElementById('gamepad-gamepad-status').className = 'gamepad-compact-value connected';
    }

    // Get trigger values
    const lt = gp.buttons[6]?.value || 0;
    const rt = gp.buttons[7]?.value || 0;

    // Determine mode
    let mode = 'idle';
    if (lt >= DEADMAN && rt < DEADMAN) mode = 'joint';
    else if (rt >= DEADMAN && lt < DEADMAN) mode = 'cart';

    // Update mode display
    document.getElementById('gamepad-mode-idle').classList.toggle('active', mode === 'idle');
    document.getElementById('gamepad-mode-joint').classList.toggle('active', mode === 'joint');
    document.getElementById('gamepad-mode-cart').classList.toggle('active', mode === 'cart');

    // Get axes
    const lx = gp.axes[0] || 0;
    const ly = gp.axes[1] || 0;
    const rx = gp.axes[2] || 0;
    const ry = gp.axes[3] || 0;

    // Update axis displays
    updateAxis('lx', lx);
    updateAxis('ly', ly);
    updateAxis('rx', rx);
    updateAxis('ry', ry);

    // D-Pad states
    const dUp = gp.buttons[12]?.pressed || false;
    const dDown = gp.buttons[13]?.pressed || false;
    const dLeft = gp.buttons[14]?.pressed || false;
    const dRight = gp.buttons[15]?.pressed || false;

    // Determine command
    let joint = null;
    let direction = null;

    if (mode === 'joint') {
        if (dir(lx)) { joint = 'j1'; direction = dir(lx); }
        else if (dir(ly)) { joint = 'j2'; direction = dir(-ly); }
        else if (dir(rx)) { joint = 'j3'; direction = dir(rx); }
        else if (dir(ry)) { joint = 'j4'; direction = dir(-ry); }
        else if (dUp) { joint = 'j5'; direction = '+'; }
        else if (dDown) { joint = 'j5'; direction = '-'; }
        else if (dRight) { joint = 'j6'; direction = '+'; }
        else if (dLeft) { joint = 'j6'; direction = '-'; }
    }

    if (mode === 'cart') {
        if (dir(lx)) { joint = 'cx'; direction = dir(lx); }
        else if (dir(ly)) { joint = 'cy'; direction = dir(-ly); }
        else if (dir(rx)) { joint = 'cr'; direction = dir(rx); }
        else if (dir(ry)) { joint = 'cp'; direction = dir(-ry); }
        else if (dUp) { joint = 'cz'; direction = '+'; }
        else if (dDown) { joint = 'cz'; direction = '-'; }
        else if (dRight) { joint = 'cw'; direction = '+'; }
        else if (dLeft) { joint = 'cw'; direction = '-'; }
    }

    // Execute command (only if modal is open)
    if (joint && direction && publishingActive) {
        startJogGP(direction, joint);
    } else if (!publishingActive || !joint || !direction) {
        stopJogGP();
    }

    requestAnimationFrame(teleopLoop);
}

/* ================= INITIALIZATION ================= */
window.addEventListener('gamepadconnected', (e) => {
    teleopLoop();
});

window.addEventListener('gamepaddisconnected', (e) => {
    gamepadConnected = false;
    document.getElementById('gamepad-gamepad-status').textContent = 'Disconnected';
    document.getElementById('gamepad-gamepad-status').className = 'gamepad-compact-value disconnected';
});

// Start the teleop loop
teleopLoop();

// Initialize control status
updateControlStatus();