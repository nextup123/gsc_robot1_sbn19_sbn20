// Widget.js
// =========================================
// FLOATING WIDGET TOGGLE
// =========================================

const floatingBtn = document.getElementById("floating-toggle-btn");
const floatingWidget = document.getElementById("floating-control-widget");

floatingBtn.addEventListener("click", () => {
    floatingWidget.classList.toggle("open");
});

// =========================================
// PROCESS TOGGLE
// =========================================

const processToggle = document.getElementById("process-toggle");
const processIndicator = document.getElementById("process-indicator");

let processRunning = false;

processToggle.addEventListener("click", () => {

    processRunning = !processRunning;

    processToggle.classList.toggle("active", processRunning);
    processIndicator.classList.toggle("running", processRunning);

    window.parent.postMessage({
        type: "UI_COMMANDS",
        payload: {
            command: "process_control",
            value: processRunning ? "start" : "stop"
        }
    }, "*");
});

// =========================================
// CONTROL BUTTONS
// =========================================

document.getElementById("start-btn").addEventListener("click", () => {

    window.parent.postMessage({
        type: "UI_COMMANDS",
        payload: {
            command: "control_start_bt",
            value: true
        }
    }, "*");

});

document.getElementById("exit-btn").addEventListener("click", () => {

    window.parent.postMessage({
        type: "UI_COMMANDS",
        payload: {
            command: "control_reset_bt",
            value: true
        }
    }, "*");

});

document.getElementById("runonce-btn").addEventListener("click", () => {

    window.parent.postMessage({
        type: "UI_COMMANDS",
        payload: {
            command: "control_start_bt",
            value: true
        }
    }, "*");

    setTimeout(() => {

        window.parent.postMessage({
            type: "UI_COMMANDS",
            payload: {
                command: "control_reset_bt",
                value: true
            }
        }, "*");

    }, 3000);

});

// =========================================
// SPEED SLIDER
// =========================================

const thumb = document.getElementById('thumb');
const trackFill = document.getElementById('track-fill');
const valDisplay = document.getElementById('val-display');
const sliderArea = document.getElementById('slider-area');

const MIN = 0;
const MAX = 100;

let currentVal = 100;
let dragging = false;
let lastPublishedVal = null;

function getTrackRect() {

    const ar = sliderArea.getBoundingClientRect();
    const R = 13;

    return {
        left: ar.left + R,
        width: ar.width - R * 2
    };
}

function updateUI(v) {

    currentVal = Math.round(
        Math.min(MAX, Math.max(MIN, v))
    );

    const pct =
        ((currentVal - MIN) / (MAX - MIN)) * 100;

    thumb.style.left = pct + '%';
    trackFill.style.width = pct + '%';

    valDisplay.textContent = currentVal;

    thumb.setAttribute('aria-valuenow', currentVal);
}

function publish(v) {

    v = Math.round(
        Math.min(MAX, Math.max(MIN, v))
    );

    if (lastPublishedVal === v) return;

    if (lastPublishedVal !== null) {

        const step = v > lastPublishedVal ? 1 : -1;

        for (
            let i = lastPublishedVal + step;
            i !== v + step;
            i += step
        ) {

            updateUI(i);

            window.parent.postMessage({
                type: 'SET_SPEED_INT8',
                payload: { value: i }
            }, '*');
        }

    } else {

        updateUI(v);

        window.parent.postMessage({
            type: 'SET_SPEED_INT8',
            payload: { value: v }
        }, '*');
    }

    lastPublishedVal = v;
}

function clientXToVal(clientX) {

    const { left, width } = getTrackRect();

    const ratio = Math.min(
        1,
        Math.max(0, (clientX - left) / width)
    );

    return Math.round(
        MIN + ratio * (MAX - MIN)
    );
}

// =========================================
// Mouse
// =========================================

thumb.addEventListener('mousedown', e => {

    e.preventDefault();

    dragging = true;
    lastPublishedVal = null;

    thumb.classList.add('dragging');
});

document.addEventListener('mousemove', e => {

    if (!dragging) return;

    e.preventDefault();

    publish(clientXToVal(e.clientX));
});

document.addEventListener('mouseup', () => {

    dragging = false;
    lastPublishedVal = null;

    thumb.classList.remove('dragging');
});

// =========================================
// Touch
// =========================================

thumb.addEventListener('touchstart', e => {

    e.preventDefault();

    dragging = true;
    lastPublishedVal = null;

    thumb.classList.add('dragging');

}, { passive: false });

document.addEventListener('touchmove', e => {

    if (!dragging) return;

    e.preventDefault();

    publish(clientXToVal(e.touches[0].clientX));

}, { passive: false });

document.addEventListener('touchend', () => {

    dragging = false;
    lastPublishedVal = null;

    thumb.classList.remove('dragging');
});

// =========================================
// Keyboard
// =========================================

thumb.addEventListener('keydown', e => {

    let v = currentVal;

    if (
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp'
    ) {
        v = Math.min(MAX, v + 1);
    }

    else if (
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowDown'
    ) {
        v = Math.max(MIN, v - 1);
    }

    else {
        return;
    }

    e.preventDefault();

    lastPublishedVal = currentVal;

    publish(v);

    lastPublishedVal = null;
});

// =========================================
// Prevent Track Click
// =========================================

sliderArea.addEventListener('mousedown', e => {

    if (e.target !== thumb) {

        e.preventDefault();
        e.stopPropagation();
    }
});

sliderArea.addEventListener('touchstart', e => {

    if (e.target !== thumb) {

        e.preventDefault();
        e.stopPropagation();
    }

}, { passive: false });

// =========================================
// Init
// =========================================
// In Widget.js — at the bottom, after init
document.getElementById("start-btn").disabled = true;
document.getElementById("runonce-btn").disabled = true;
document.getElementById("start-btn").classList.add("btn-disabled");
document.getElementById("runonce-btn").classList.add("btn-disabled");
updateUI(100);

// =========================================
// DRAGGABLE WIDGET
// =========================================

const wrapper = document.querySelector('.floating-control-wrapper');
const handle  = document.querySelector('.floating-widget-header');

let widgetDragging = false;          // ← renamed
let dragStartX, dragStartY, origLeft, origTop;

handle.style.cursor = 'grab';

function dragStart(clientX, clientY) {
    if (!floatingWidget.classList.contains('open')) return;

    widgetDragging = true;
    handle.style.cursor = 'grabbing';

    const rect = wrapper.getBoundingClientRect();
    dragStartX = clientX;
    dragStartY = clientY;
    origLeft   = rect.left;
    origTop    = rect.top;

    wrapper.style.right     = 'auto';
    wrapper.style.transform = 'none';
    wrapper.style.left      = origLeft + 'px';
    wrapper.style.top       = origTop  + 'px';
}

function dragMove(clientX, clientY) {
    if (!widgetDragging) return;

    const dx = clientX - dragStartX;
    const dy = clientY - dragStartY;

    const wrapperW = wrapper.offsetWidth;
    const wrapperH = wrapper.offsetHeight;

    const newLeft = Math.max(0, Math.min(window.innerWidth  - wrapperW, origLeft + dx));
    const newTop  = Math.max(0, Math.min(window.innerHeight - wrapperH, origTop  + dy));

    wrapper.style.left = newLeft + 'px';
    wrapper.style.top  = newTop  + 'px';
}

function dragEnd() {
    if (!widgetDragging) return;
    widgetDragging = false;
    handle.style.cursor = 'grab';
}

handle.addEventListener('mousedown', (e) => {
    dragStart(e.clientX, e.clientY);
    e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
    dragMove(e.clientX, e.clientY);
});

document.addEventListener('mouseup', dragEnd);

handle.addEventListener('touchstart', (e) => {
    dragStart(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: true });

document.addEventListener('touchmove', (e) => {
    if (!widgetDragging) return;
    dragMove(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: true });

document.addEventListener('touchend', dragEnd);