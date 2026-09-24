const API_BASE = 'http://localhost:3000/io-control';
let xmlContent = '';
let editingControlName = null;
let editingControlType = null;

// DOM elements
const doName = document.getElementById('doName');
const doDriverId = document.getElementById('doDriverId');
const doId = document.getElementById('doId');
const controlType = document.getElementById('controlType');
const pushWait = document.getElementById('pushWait');
const doResponseMsg = document.getElementById('doResponseMsg');
const diName = document.getElementById('diName');
const diDriverId = document.getElementById('diDriverId');
const diId = document.getElementById('diId');
const waitTimeEnabled = document.getElementById('waitTimeEnabled');
const diFallbackEnabled = document.getElementById('diFallbackEnabled');
const waitTime = document.getElementById('waitTime');
const diResponseMsg = document.getElementById('diResponseMsg');
const updateDOBtn = document.getElementById('updateDOBtn');
const updateDIBtn = document.getElementById('updateDIBtn');
const sequenceList = document.getElementById('sequenceList');
const xmlOutput = document.getElementById('xmlOutput');
const xmlModal = document.getElementById('xmlModal');
const sequenceCount = document.getElementById('sequenceCount');
const editorSlider = document.querySelector('.editor-slider');

//---------------------------------------------------ROS CODE------------------------------------------------------
const allDiIndicators = [];

// setInterval(() => {
//     console.log(allDiIndicators);
// }, 1000);

// In each child iframe (e.g., pointPlanning section)
window.parent.postMessage({
    type: "REGISTER_PAGE",
    payload: {
        pageId: "page5",  // must match the iframe ID in mainWeb
        messageTypes: ["DO_STATUS", "DI_STATUS", "GPIO_STATE", "GPIO_PUBLISH_CONFIRM"]
    }
}, "*");

window.addEventListener("message", (event) => {
    const msg = event.data;

    if (!msg || !msg.type) return;


    switch (msg.type) {

        case "DO_STATUS": {
            const { driver, do1, do2, do3, do4 } = msg.payload;

            const updates = { do1, do2, do3, do4 };
            Object.entries(updates).forEach(([key, state]) => {
                if (state === undefined) return; // not in this message — skip

                const id = parseInt(key.replace('do', ''));
                const indicator = document.getElementById(`do_indicator_${driver}_${id}`);
                const toggle = document.getElementById(`do_toggle_${driver}_${id}`);

                if (indicator) indicator.classList.toggle("on", state);
                if (toggle && !toggle.disabled) toggle.checked = state;
            });
            break;
        }


        // In the DI_STATUS message handler in script.js
        case "GPIO_STATE":
            handleGpioState(msg.payload);
            break;
        case "DI_STATUS":
            const payload = msg.payload;
            payload.forEach((driverData, drvIndex) => {
                driverData.forEach((value, diIndex) => {
                    const id = `di_indicator_${drvIndex + 1}_${diIndex}`;
                    const indicator = document.getElementById(id);
                    if (indicator) {
                        indicator.classList.toggle("on", value === true);
                    }
                });
            });
            break;

        // in the message router's switch, add a new case:
        case "GPIO_PUBLISH_CONFIRM": {
            const { group, do: doPatch } = msg.payload || {};
            if (!group || !doPatch) break;
            Object.entries(doPatch).forEach(([n, v]) => {
                const key = `${group}::do${n}`;
                const vNum = v ? 1 : 0;
                if (gpioPendingCmd[key] === vNum) delete gpioPendingCmd[key];
                gpioDoState[key] = vNum;
            });
            updateGpioValuesOnly();
            break;
        }

    }
});

// ========== ROS INITIALIZATION ==========

function playBootAnimation(callback) {
    if (!allDiIndicators.length) {
        callback && callback();
        return;
    }
    const totalDuration = 1000;
    const stepTime = totalDuration / allDiIndicators.length;
    allDiIndicators.forEach((ind, i) => {
        setTimeout(() => {
            ind.classList.add('on');
            setTimeout(() => {
                ind.classList.remove('on');
            }, stepTime * 0.8);
        }, i * stepTime);
    });
    setTimeout(() => {
        callback && callback();
    }, totalDuration + 100);
}


function toggleDO(driver, doId) {
    const toggle = document.getElementById(`do_toggle_${driver}_${doId}`);
    const state = toggle.checked;

    window.parent.postMessage({
        type: "TOGGLE_DO",
        payload: { driver, doId, state }
    }, "*");
}

//---------------------------------------------------LIVE GPIO PANEL (dynamic groups, via rclnodejs/WS)------------------------------------------------------
const GPIO_CHANNELS_PER_GROUP = 8;
const gpioGroups = {};       // groupName -> { di: {1..8}, do: {1..8}, seenDi: Set, seenDo: Set }
const gpioGroupOrder = [];
const gpioDoState = {};      // "group::doN" -> 0/1 (optimistic, latched until echo confirms)
const gpioPendingCmd = {};   // "group::doN" -> 0/1 while waiting for the state echo to catch up
let gpioSynced = false;

const gpioEls = {
    groupsHost: document.getElementById('gpioGroups'),
    connBadge: document.getElementById('gpioConnBadge'),
    newGroupName: document.getElementById('gpioNewGroupName'),
    addGroupBtn: document.getElementById('gpioAddGroupBtn'),
};

function gpioEnsureGroup(name) {
    if (gpioGroups[name]) return gpioGroups[name];
    gpioGroups[name] = { di: {}, do: {}, seenDi: new Set(), seenDo: new Set() };
    gpioGroupOrder.push(name);
    return gpioGroups[name];
}

function handleGpioState(payload) {
    const groups = (payload && payload.groups) || {};
    let structureChanged = false;

    Object.keys(groups).forEach((g) => {
        const existedBefore = !!gpioGroups[g];
        const gState = gpioEnsureGroup(g);
        if (!existedBefore) structureChanged = true;

        const incoming = groups[g];

        Object.keys(incoming.di || {}).forEach((n) => {
            const num = Number(n);
            if (!gState.seenDi.has(num)) { gState.seenDi.add(num); structureChanged = true; }
            gState.di[num] = !!incoming.di[n];
        });

        Object.keys(incoming.do || {}).forEach((n) => {
            const num = Number(n);
            if (!gState.seenDo.has(num)) { gState.seenDo.add(num); structureChanged = true; }
            const vNum = incoming.do[n] ? 1 : 0;
            const key = g + '::do' + num;

            if (gpioPendingCmd[key] === undefined) {
                gpioDoState[key] = vNum;
            } else if (gpioPendingCmd[key] === vNum) {
                delete gpioPendingCmd[key];
                gpioDoState[key] = vNum;
            }
            // else: a command is in flight for this channel - keep showing
            // what was commanded instead of snapping back to a stale echo.
        });
    });

    if (!gpioSynced) { gpioSynced = true; setGpioConnBadge(true); }
    if (structureChanged) renderGpioGroups(); else updateGpioValuesOnly();
}

function setGpioConnBadge(on) {
    if (!gpioEls.connBadge) return;
    gpioEls.connBadge.textContent = on ? '· live' : '· syncing…';
    gpioEls.connBadge.classList.toggle('on', on);
    gpioEls.connBadge.classList.toggle('off', !on);
}

function sendGpioCommand(group, channel, value) {
    const key = group + '::do' + channel;
    const v = value ? 1 : 0;

    // Optimistic: flip immediately, latch until the echo confirms (same
    // pattern as toggleDO/DO_STATUS - many GPIO controllers lag on DO echo).
    gpioDoState[key] = v;
    gpioPendingCmd[key] = v;
    updateGpioValuesOnly();

    window.parent.postMessage({
        type: 'GPIO_COMMAND',
        payload: { group, channel, value: !!value }
    }, '*');
}

function renderGpioGroups() {
    if (!gpioEls.groupsHost) return;
    gpioEls.groupsHost.innerHTML = '';
    if (gpioGroupOrder.length === 0) {
        gpioEls.groupsHost.innerHTML = '<div class="gp-empty">Waiting for GPIO state…</div>';
        return;
    }
    gpioEls.groupsHost.appendChild(buildGpioMatrix('di'));
    gpioEls.groupsHost.appendChild(buildGpioMatrix('do'));
}

function buildGpioMatrix(kind) {
    const isDo = kind === 'do';
    const wrap = document.createElement('div');
    wrap.className = 'gp-matrix-wrap';

    const head = document.createElement('div');
    head.className = 'gp-matrix-head';
    head.textContent = isDo ? 'Digital Outputs' : 'Digital Inputs';
    wrap.appendChild(head);

    const scroll = document.createElement('div');
    scroll.className = 'gp-matrix-scroll';

    const table = document.createElement('table');
    table.className = 'gp-matrix-table';
    table.dataset.kind = kind;

    // header row: "Group" + one column per channel 1..8
    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    const corner = document.createElement('th');
    corner.textContent = 'Group';
    htr.appendChild(corner);
    for (let n = 1; n <= GPIO_CHANNELS_PER_GROUP; n++) {
        const th = document.createElement('th');
        th.textContent = (isDo ? 'DO' : 'DI') + n;
        htr.appendChild(th);
    }
    thead.appendChild(htr);
    table.appendChild(thead);

    // body: one row per group, channels across
    const tbody = document.createElement('tbody');
    gpioGroupOrder.forEach(g => {
        const tr = document.createElement('tr');
        const label = document.createElement('td');
        label.className = 'gp-matrix-rowlabel';
        label.innerHTML = `<b>${g}</b>`;
        tr.appendChild(label);

        for (let n = 1; n <= GPIO_CHANNELS_PER_GROUP; n++) {
            const td = document.createElement('td');
            td.appendChild(isDo ? buildGpioMatrixDoCell(g, n) : buildGpioMatrixDiCell(g, n));
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    wrap.appendChild(scroll);
    return wrap;
}

function buildGpioMatrixDiCell(g, n) {
    const gState = gpioGroups[g];
    const known = gState.seenDi.has(n);
    const on = !!gState.di[n];
    const led = document.createElement('span');
    led.className = 'di-indicator-light' + (on ? ' on' : '') + (known ? '' : ' stale');
    led.dataset.gpDi = '1';
    led.dataset.group = g;
    led.dataset.n = n;
    return led;
}

function buildGpioMatrixDoCell(g, n) {
    const key = g + '::do' + n;
    const on = !!gpioDoState[key];

    const container = document.createElement('div');
    container.className = 'do-toggle-container';

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'do-toggle';
    toggle.checked = on;
    toggle.dataset.gpDoToggle = '1';
    toggle.dataset.group = g;
    toggle.dataset.n = n;
    toggle.addEventListener('change', (e) => sendGpioCommand(g, n, e.target.checked));

    const led = document.createElement('span');
    led.className = 'do-indicator' + (on ? ' on' : '');
    led.dataset.gpDoLed = '1';
    led.dataset.group = g;
    led.dataset.n = n;

    container.appendChild(toggle);
    container.appendChild(led);
    return container;
}

function updateGpioValuesOnly() {
    const host = gpioEls.groupsHost;
    if (!host) return;

    host.querySelectorAll('[data-gp-di]').forEach(led => {
        const gState = gpioGroups[led.dataset.group];
        if (!gState) return;
        const n = Number(led.dataset.n);
        led.classList.toggle('on', !!gState.di[n]);
        led.classList.toggle('stale', !gState.seenDi.has(n));
    });

    host.querySelectorAll('[data-gp-do-led]').forEach(led => {
        const key = led.dataset.group + '::do' + led.dataset.n;
        led.classList.toggle('on', !!gpioDoState[key]);
    });

    host.querySelectorAll('[data-gp-do-toggle]').forEach(t => {
        const key = t.dataset.group + '::do' + t.dataset.n;
        t.checked = !!gpioDoState[key];
    });
}

if (gpioEls.addGroupBtn) {
    gpioEls.addGroupBtn.addEventListener('click', () => {
        const name = gpioEls.newGroupName.value.trim();
        if (!name) return;
        gpioEnsureGroup(name);
        gpioEls.newGroupName.value = '';
        renderGpioGroups();
    });
}
if (gpioEls.newGroupName) {
    gpioEls.newGroupName.addEventListener('keydown', (e) => { if (e.key === 'Enter') gpioEls.addGroupBtn.click(); });
}

renderGpioGroups();
// ----------------------------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------------------------

let currentEditor = 0;

function showStatus(message, type = "success", timeout = 3000) {
    let toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    let icon = 'info-circle';
    if (type === 'success') icon = 'check-circle';
    if (type === 'error') icon = 'exclamation-circle';
    if (type === 'warning') icon = 'exclamation-triangle';
    toast.innerHTML = `
        <i class="fas fa-${icon} toast-icon"></i>
        <div class="toast-content">${message}</div>
        <button class="toast-close" onclick="this.parentElement.remove()">
          <i class="fas fa-times"></i>
        </button>
    `;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.transform = 'translateX(0)';
        toast.style.opacity = '1';
    }, 10);
    if (timeout > 0) {
        setTimeout(() => {
            if (toast.parentElement) {
                toast.classList.add('toast-out');
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

function openXMLModal() {
    reloadXML();
    xmlOutput.textContent = xmlContent || 'No XML available';
    xmlModal.style.display = 'flex';
}

function closeXMLModal() {
    xmlModal.style.display = 'none';
}

let currentFontSize = 10;
function changeFontSize(delta) {
    currentFontSize += delta;
    if (currentFontSize < 7) currentFontSize = 7;
    if (currentFontSize > 20) currentFontSize = 20;
    xmlOutput.style.fontSize = currentFontSize + "px";
}

function copyXML() {
    navigator.clipboard.writeText(xmlOutput.textContent)
        .then(() => showStatus('XML copied to clipboard', 'success', 2000))
        .catch(() => showStatus('Failed to copy XML', 'error', 3000));
}

function togglePushWait() {
    pushWait.disabled = controlType.value !== 'push';
}

function toggleWaitTime() {
    waitTime.disabled = !waitTimeEnabled.checked;
}

function toggleDIFallback() {
    if (diFallbackEnabled.checked) {
        console.log('di fallback enabled');
    }
    else {
        console.log('di fallback disabled');
    }
}

function updateDoIdOptions(driverId) {
    const doIdSelect = document.getElementById('doId');
    doIdSelect.innerHTML = '';

    const options =
        driverId === '5' || driverId === '6'
            ? ['1', '2', '3', 'pi_p']
            : ['1', '2', '3', 'pi_p'];

    options.forEach(id => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = id;
        doIdSelect.appendChild(option);
    });

    const previous = doIdSelect.value;
    doIdSelect.value =
        editingControlName &&
            doIdSelect.querySelector(`option[value="${previous}"]`)
            ? previous
            : '1';

    enforceControlTypeForDO();
}

function enforceControlTypeForDO() {
    const doIdSelect = document.getElementById('doId');
    const controlTypeSelect = document.getElementById('controlType');

    const isPiP = doIdSelect.value === 'pi_p';

    const pushOption = controlTypeSelect.querySelector('option[value="push"]');
    const switchOption = controlTypeSelect.querySelector('option[value="switch"]');

    if (isPiP) {
        if (pushOption) pushOption.disabled = true;
        controlTypeSelect.value = 'switch';
    } else {
        if (pushOption) pushOption.disabled = false;
    }
}

document.getElementById('doId').addEventListener('change', enforceControlTypeForDO);

function swipeEditor(direction) {
    if (direction === 'left' && currentEditor > 0) {
        currentEditor--;
    } else if (direction === 'right' && currentEditor < 1) {
        currentEditor++;
    }
    editorSlider.style.transform = `translateX(-${currentEditor * 50}%)`;

    // ✅ Keep tab highlight in sync
    document.getElementById('doEditor').classList.toggle('active', currentEditor === 0);
    document.getElementById('diEditor').classList.toggle('active', currentEditor === 1);
}

async function loadSequences() {
    try {
        const res = await fetch(`${API_BASE}/getTreeData`);
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const sequences = await res.json();
        sequenceList.innerHTML = '';
        sequenceCount.textContent = sequences.length;
        if (sequences.length === 0) {
            sequenceList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <p>No sequences added yet</p>
                    <small>Start by creating a sequence using the editors</small>
                </div>
            `;
            return;
        }
        sequences.forEach((seq, index) => {
            const isDO = seq.type === 'DO' || seq.type === 'GpioDoControl';
            const isGpio = seq.type === 'GpioDoControl' || seq.type === 'GpioDiControl';

            const div = document.createElement('div');
            div.className = `sequence-item ${isDO ? 'sequence-do' : 'sequence-di'}`;
            div.draggable = true;
            div.dataset.name = seq.name;
            div.dataset.type = seq.type;

            const controllerBadge = isGpio
                ? `<span class="badge badge-secondary">GPIO: ${seq.gpioId}</span>`
                : `<span class="badge badge-secondary">Driver: ${seq.driverId}</span>`;

            const details = `
        <div class="sequence-details">
            <span class="badge badge-primary">${seq.name}</span>
            <span class="badge badge-secondary">${seq.type.toUpperCase()}</span>
            ${controllerBadge}
            <span class="badge badge-secondary">${isDO ? `DO ID: ${seq.doId}` : `DI ID: ${seq.diId}`}</span>
            ${isDO ? `<span class="badge badge-secondary">Control: ${seq.controlType}</span>` : ''}
            ${isDO && seq.controlType === 'push' ? `<span class="badge badge-secondary">Push Wait: ${seq.pushWait}ms</span>` : ''}
            ${!isDO && seq.waitTime ? `<span class="badge badge-secondary">Wait Time: ${seq.waitTime}ms</span>` : ''}
            ${isGpio && seq.with_fallback ? `<span class="badge badge-secondary">Fallback</span>` : ''}
        </div>
    `;

            div.innerHTML = `
        <div class="sequence-index-container">
            <span class="drag-handle"></span>
            <span class="sequence-index">${index + 1}</span>
        </div>
        <div class="sequence-content">
            ${details}
        </div>
        <div class="sequence-actions">
            <button class="btn-icon btn-edit" onclick="editControl('${seq.name}', '${seq.type}')">
                <i class="fas fa-edit"></i>
            </button>
            <button class="btn-icon btn-delete" onclick="deleteControl('${seq.name}')">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `;
            sequenceList.appendChild(div);
        });
        showStatus(`Reloaded ${sequences.length} sequences`, 'success', 1000);
        initDragAndDrop();
    } catch (err) {
        showStatus(`Failed to reload sequences: ${err.message}`, 'error', 3000);
        console.error(err);
    }
}

function initDragAndDrop() {
    const items = sequenceList.querySelectorAll('.sequence-item');
    items.forEach(item => {
        item.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', item.dataset.name);
            item.classList.add('dragging');
        });
        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
        });
        item.addEventListener('dragover', e => e.preventDefault());
        item.addEventListener('drop', e => {
            e.preventDefault();
            const draggedName = e.dataTransfer.getData('text/plain');
            const targetItem = e.target.closest('.sequence-item');
            if (!targetItem || draggedName === targetItem.dataset.name) return;
            const items = Array.from(sequenceList.querySelectorAll('.sequence-item'));
            const draggedItem = sequenceList.querySelector(`.sequence-item[data-name="${draggedName}"]`);
            const targetIndex = items.indexOf(targetItem);
            const draggedIndex = items.indexOf(draggedItem);
            if (draggedIndex < targetIndex) {
                targetItem.after(draggedItem);
            } else {
                targetItem.before(draggedItem);
            }
            const newOrder = Array.from(sequenceList.querySelectorAll('.sequence-item')).map(item => item.dataset.name);
            reorderSequences(newOrder);
        });
    });
}

async function reorderSequences(sequenceNames) {
    await callAPI('reorderSequences', { sequenceNames }, loadSequences);
}

async function addDOControl() {
    if (!doName.value || !/^[A-Za-z0-9]+$/.test(doName.value)) {
        showStatus('DO Name must be alphanumeric without spaces', 'error', 3000);
        return;
    }

    if (!doDriverId.value || !doId.value || !controlType.value || !doResponseMsg.value) {
        showStatus('All required fields must be filled', 'error', 3000);
        return;
    }

    const body = {
        type: 'DO',
        name: `${doName.value}[DO]`,
        driverId: doDriverId.value,
        doId: doId.value,
        controlType: controlType.value,
        pushWait: controlType.value === 'push' ? pushWait.value : '250',
        responseMsg: doResponseMsg.value
    };

    await callAPI('addControl', body, () => {
        clearDOForm();
        loadSequences();
    });
}

async function updateDOControl() {
    if (!editingControlName || !doName.value || !/^[A-Za-z0-9]+(\[(DO|DI)\])?$/.test(doName.value)) {
        showStatus('DO Name must be alphanumeric without spaces', 'error', 3000);
        return;
    }
    if (!doDriverId.value || !doId.value || !controlType.value || !doResponseMsg.value) {
        showStatus('All required fields must be filled', 'error', 3000);
        return;
    }
    const body = {
        oldName: editingControlName,
        type: 'DO',
        name: doName.value,
        driverId: doDriverId.value,
        doId: doId.value,
        controlType: controlType.value,
        pushWait: controlType.value === 'push' ? pushWait.value : '250',
        responseMsg: doResponseMsg.value
    };
    await callAPI('updateControl', body, () => {
        clearDOForm();
        loadSequences();
    });
}

async function addDIControl() {
    if (!diName.value || !/^[A-Za-z0-9]+$/.test(diName.value)) {
        showStatus('DI Name must be alphanumeric without spaces', 'error', 3000);
        return;
    }
    if (!diDriverId.value || !diId.value || !diResponseMsg.value) {
        showStatus('All required fields must be filled', 'error', 3000);
        return;
    }
    const body = {
        type: 'DI',
        name: `${diName.value}[DI]`,
        driverId: diDriverId.value,
        diId: diId.value,
        waitTime: waitTimeEnabled.checked ? waitTime.value : null,
        responseMsg: diResponseMsg.value,
        with_fallback: diFallbackEnabled.checked
    };
    await callAPI('addControl', body, () => {
        clearDIForm();
        loadSequences();
    });
}

async function updateDIControl() {
    if (!editingControlName || !diName.value || !/^[A-Za-z0-9]+(\[(DO|DI)\])?$/.test(diName.value)) {
        showStatus('DI Name must be alphanumeric without spaces', 'error', 3000);
        return;
    }
    if (!diDriverId.value || !diId.value || !diResponseMsg.value) {
        showStatus('All required fields must be filled', 'error', 3000);
        return;
    }
    const body = {
        oldName: editingControlName,
        type: 'DI',
        name: diName.value,
        driverId: diDriverId.value,
        diId: diId.value,
        waitTime: waitTimeEnabled.checked ? waitTime.value : null,
        responseMsg: diResponseMsg.value,
        with_fallback: diFallbackEnabled.checked
    };
    await callAPI('updateControl', body, () => {
        clearDIForm();
        loadSequences();
    });
}

function editControl(name, type) {
    editingControlName = name;
    editingControlType = type;
    swipeEditor(type === 'DO' ? 'left' : 'right');
    if (type === 'DO') {
        fetch(`${API_BASE}/getControl/${name}`)
            .then(res => res.json())
            .then(data => {
                doName.value = data.name;
                doDriverId.value = data.driverId;
                updateDoIdOptions(data.driverId);
                doId.value = data.doId;
                controlType.value = data.controlType;
                pushWait.value = data.pushWait;
                doResponseMsg.value = data.responseMsg;
                togglePushWait();
                updateDOBtn.disabled = false;
                updateDIBtn.disabled = true;
                showStatus(`Editing ${name} (DO)`, 'success', 2000);
            })
            .catch(err => showStatus(`Failed to load control: ${err.message}`, 'error', 3000));
    } else {
        fetch(`${API_BASE}/getControl/${name}`)
            .then(res => res.json())
            .then(data => {
                diName.value = data.name;
                diDriverId.value = data.driverId;
                diId.value = data.diId;
                waitTimeEnabled.checked = !!data.waitTime;
                diFallbackEnabled.checked = data.with_fallback;
                waitTime.value = data.waitTime || '250';
                diResponseMsg.value = data.responseMsg;
                toggleWaitTime();
                updateDIBtn.disabled = false;
                updateDOBtn.disabled = true;
                showStatus(`Editing ${name} (DI)`, 'success', 2000);
            })
            .catch(err => showStatus(`Failed to load control: ${err.message}`, 'error', 3000));
    }
}

async function deleteControl(name) {
    if (confirm(`Delete ${name}?`)) {
        await callAPI('deleteControl', { name }, loadSequences);
    }
}

async function deleteAll() {
    if (confirm('Delete all sequences?')) {
        await callAPI('deleteAll', {}, loadSequences);
    }
}

async function reloadXML() {
    await callAPI('getXML', {}, () => {
        xmlOutput.textContent = xmlContent || 'No XML available';
    });
}

async function callAPI(endpoint, body, callback) {
    showStatus('Processing...', 'process', 1000);
    try {
        const res = await fetch(`${API_BASE}/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (res.ok) {
            xmlContent = data.xml || 'No XML returned';
            showStatus(data.message, 'success', 2000);
            if (callback) callback();
        } else {
            xmlContent = `Error: ${data.message}`;
            showStatus(data.message, 'error', 3000);
        }
    } catch (err) {
        xmlContent = `Error: ${err.message}`;
        showStatus(`Connection error: ${err.message}`, 'error', 3000);
    }
}

function clearDOForm() {
    doName.value = '';
    doDriverId.value = '1';
    updateDoIdOptions('1');
    controlType.value = 'switch';
    pushWait.value = '250';
    doResponseMsg.value = '';
    editingControlName = null;
    editingControlType = null;
    updateDOBtn.disabled = true;
    togglePushWait();
}

function clearDIForm() {
    diName.value = '';
    diDriverId.value = '1';
    diId.value = '1';
    waitTimeEnabled.checked = false;
    waitTime.value = '250';
    diResponseMsg.value = '';
    editingControlName = null;
    editingControlType = null;
    updateDIBtn.disabled = true;
    toggleWaitTime();
}

async function reloadSequences() {
    await loadSequences();
}

// ========== ACTION.JS FUNCTIONS ==========
const undoBtn = document.getElementById('undoBtn');
const sortDiFirstBtn = document.getElementById('sortDiFirst');
const sortDoFirstBtn = document.getElementById('sortDoFirst');

async function makeRequest(endpoint, options = {}) {
    try {
        const response = await fetch(`${API_BASE}/${endpoint}`, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || `HTTP error! status: ${response.status}`);
        }
        return data;
    } catch (error) {
        showStatus(`Error: ${error.message}`, 'error', 3000);
        throw error;
    }
}

async function checkUndo() {
    try {
        undoBtn.disabled = true;
        const data = await makeRequest('canUndo');
        undoBtn.disabled = !data.canUndo;
    } catch (error) {
        undoBtn.disabled = true;
        console.error('Failed to check undo:', error);
    }
}

async function performUndo() {
    try {
        undoBtn.disabled = true;
        const data = await makeRequest('undo', { method: 'POST' });
        showStatus('Undo successful', 'success', 1000);
        setTimeout(reloadSequences, 500);
        setTimeout(checkUndo, 300);
    } catch (error) {
        console.error('Failed to undo:', error);
        checkUndo();
    }
}

async function sortSequences(sortOrder) {
    try {
        const data = await makeRequest(`reorderSequences?sortOrder=${sortOrder}`, { method: 'POST' });
        showStatus(`Sorted ${sortOrder === 'diFirst' ? 'DI' : 'DO'} first successfully`, 'success', 1000);
        setTimeout(reloadSequences, 200);
        setTimeout(checkUndo, 300);
    } catch (error) {
        console.error(`Failed to sort ${sortOrder}:`, error);
        showStatus(`Failed to sort ${sortOrder === 'diFirst' ? 'DI' : 'DO'} first`, 'error', 3000);
    }
}

// ========== INITIALIZATION ==========
async function init() {
    await loadSequences();
    togglePushWait();
    toggleWaitTime();
    updateDoIdOptions(doDriverId.value);
    buildDIIndicatorTable();
    doDriverId.addEventListener('change', () => updateDoIdOptions(doDriverId.value));

    checkUndo();

    if (sortDiFirstBtn) {
        sortDiFirstBtn.addEventListener('click', () => sortSequences('diFirst'));
    }
    if (sortDoFirstBtn) {
        sortDoFirstBtn.addEventListener('click', () => sortSequences('doFirst'));
    }
    if (undoBtn) {
        undoBtn.addEventListener('click', performUndo);
    }

    playBootAnimation(() => {
        // subscribeToDITopic();
        // subscribeToDOTopics();
    });
}

function buildDIIndicatorTable() {
    console.log("Table is trggered")
    const tbody = document.getElementById('di_indicator_table_body');
    tbody.innerHTML = '';

    for (let diIndex = 0; diIndex < 5; diIndex++) {
        const tr = document.createElement('tr');

        const tdLabel = document.createElement('td');
        tdLabel.innerHTML = `<b>DI${diIndex + 1}</b>`;
        tr.appendChild(tdLabel);

        for (let drvIndex = 1; drvIndex <= 6; drvIndex++) {
            const td = document.createElement('td');
            const span = document.createElement('span');
            span.className = 'di-indicator-light';
            span.id = `di_indicator_${drvIndex}_${diIndex}`;
            td.appendChild(span);
            tr.appendChild(td);
            // console.log(span.id);

            // ✅ Reference the span directly — no querySelector on detached nodes
            allDiIndicators.push(span);
        }

        tbody.appendChild(tr);
    }
}

init();


// Form Popup functions
function openFormPopup() {
    closeGpioFormPopup();
    const popup = document.getElementById('formPopup');
    popup.style.display = 'flex';
    document.body.style.overflow = 'hidden'; // Prevent scrolling behind popup

    // Reset the editor slider position to DO
    currentEditor = 0;
    const slider = document.querySelector('#formPopup .editor-slider');
    if (slider) {
        slider.style.transform = 'translateX(0%)';
    }
    document.getElementById('doEditor').classList.add('active');
    document.getElementById('diEditor').classList.remove('active');

    // Update title based on current editor
    updateFormPopupTitle();
}

function closeFormPopup() {
    const popup = document.getElementById('formPopup');
    popup.style.display = 'none';
    document.body.style.overflow = 'auto';
}

function updateFormPopupTitle() {
    const title = document.getElementById('formPopupTitle');
    if (currentEditor === 0) {
        title.textContent = editingControlName ? `Edit ${editingControlName}` : 'Add DO Control';
    } else {
        title.textContent = editingControlName ? `Edit ${editingControlName}` : 'Add DI Control';
    }
}

// Override swipeEditor to update popup title
const originalSwipeEditor = swipeEditor;
swipeEditor = function (direction) {
    originalSwipeEditor(direction);

    // Update popup title if popup is open
    if (document.getElementById('formPopup').style.display === 'flex') {
        updateFormPopupTitle();
    }

    // Also update the tab highlighting in the popup
    const doEditor = document.getElementById('doEditor');
    const diEditor = document.getElementById('diEditor');
    if (currentEditor === 0) {
        doEditor.classList.add('active');
        diEditor.classList.remove('active');
    } else {
        doEditor.classList.remove('active');
        diEditor.classList.add('active');
    }
};

// Close popup when clicking outside
document.addEventListener('click', function (event) {
    const popup = document.getElementById('formPopup');
    if (event.target === popup) {
        closeFormPopup();
    }
});

// Close popup with Escape key
document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
        closeFormPopup();
    }
});

// Override editControl to open the popup
const originalEditControl = editControl;
editControl = function (name, type) {
    if (type === 'GpioDoControl' || type === 'GpioDiControl') {
        editGpioControl(name, type);
        return;
    }
    originalEditControl(name, type);
    openFormPopup();
    updateFormPopupTitle();
};

// Override clearDOForm and clearDIForm to update title
const originalClearDOForm = clearDOForm;
clearDOForm = function () {
    originalClearDOForm();
    if (document.getElementById('formPopup').style.display === 'flex') {
        updateFormPopupTitle();
    }
};

const originalClearDIForm = clearDIForm;
clearDIForm = function () {
    originalClearDIForm();
    if (document.getElementById('formPopup').style.display === 'flex') {
        updateFormPopupTitle();
    }
};

// Override add functions to close popup after adding
// const originalAddDOControl = addDOControl;
// addDOControl = async function () {
//     await originalAddDOControl();
//     if (document.getElementById('formPopup').style.display === 'flex') {
//         closeFormPopup();
//     }
// };

// const originalAddDIControl = addDIControl;
// addDIControl = async function () {
//     await originalAddDIControl();
//     if (document.getElementById('formPopup').style.display === 'flex') {
//         closeFormPopup();
//     }
// };

// Override update functions to close popup after updating
const originalUpdateDOControl = updateDOControl;
updateDOControl = async function () {
    await originalUpdateDOControl();
    if (document.getElementById('formPopup').style.display === 'flex') {
        closeFormPopup();
    }
};

const originalUpdateDIControl = updateDIControl;
updateDIControl = async function () {
    await originalUpdateDIControl();
    if (document.getElementById('formPopup').style.display === 'flex') {
        closeFormPopup();
    }
};

// ========== GPIO DO/DI FORM ==========
const GPIO_CHANNEL_COUNT = 8;      // GPIO channels 1..8 (change if needed)
let currentGpioEditor = 0;

const gpioDoName = document.getElementById('gpioDoName');
const gpioDoGpioId = document.getElementById('gpioDoGpioId');
const gpioDoId = document.getElementById('gpioDoId');
const gpioControlType = document.getElementById('gpioControlType');
const gpioPushWait = document.getElementById('gpioPushWait');
const gpioDoResponseMsg = document.getElementById('gpioDoResponseMsg');

const gpioDiName = document.getElementById('gpioDiName');
const gpioDiGpioId = document.getElementById('gpioDiGpioId');
const gpioDiId = document.getElementById('gpioDiId');
const gpioWaitTimeEnabled = document.getElementById('gpioWaitTimeEnabled');
const gpioWaitTime = document.getElementById('gpioWaitTime');
const gpioDiFallbackEnabled = document.getElementById('gpioDiFallbackEnabled');
const gpioDiResponseMsg = document.getElementById('gpioDiResponseMsg');

const updateGpioDOBtn = document.getElementById('updateGpioDOBtn');
const updateGpioDIBtn = document.getElementById('updateGpioDIBtn');

const gpioFormPopup = document.getElementById('gpioFormPopup');
const gpioEditorSlider = document.querySelector('.gpio-editor-slider');

function populateGpioIdSelects() {
    [gpioDoId, gpioDiId].forEach(sel => {
        if (!sel) return;
        const prev = sel.value;
        sel.innerHTML = '';
        for (let i = 1; i <= GPIO_CHANNEL_COUNT; i++) {
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = String(i);
            sel.appendChild(opt);
        }
        if (prev) sel.value = prev;
    });
}

// makes sure a select contains `value` (for edit of ids outside 1..8)
function ensureOption(select, value) {
    if (!select || value === undefined || value === null || value === '') return;
    const v = String(value);
    if (![...select.options].some(o => o.value === v)) {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
    }
    select.value = v;
}

// datalist of live GPIO groups discovered via GPIO_STATE


function toggleGpioPushWait() {
    gpioPushWait.disabled = gpioControlType.value !== 'push';
}
function toggleGpioWaitTime() {
    gpioWaitTime.disabled = !gpioWaitTimeEnabled.checked;
}

function swipeGpioEditor(direction) {
    if (direction === 'left') currentGpioEditor = 0;
    else if (direction === 'right') currentGpioEditor = 1;
    if (gpioEditorSlider) {
        gpioEditorSlider.style.transform = `translateX(-${currentGpioEditor * 50}%)`;
    }
    document.getElementById('gpioDoEditor').classList.toggle('active', currentGpioEditor === 0);
    document.getElementById('gpioDiEditor').classList.toggle('active', currentGpioEditor === 1);
    updateGpioFormPopupTitle();
}

function updateGpioFormPopupTitle() {
    const title = document.getElementById('gpioFormPopupTitle');
    if (!title) return;
    if (currentGpioEditor === 0) {
        title.textContent = editingControlName ? `Edit ${editingControlName}` : 'Add GPIO DO Control';
    } else {
        title.textContent = editingControlName ? `Edit ${editingControlName}` : 'Add GPIO DI Control';
    }
}

function openGpioFormPopup(which = 'do') {
    closeFormPopup();
    clearGpioDOForm();
    clearGpioDIForm();
    populateGpioIdSelects();
    gpioFormPopup.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    swipeGpioEditor(which === 'di' ? 'right' : 'left');
}
function closeGpioFormPopup() {
    gpioFormPopup.style.display = 'none';
    document.body.style.overflow = 'auto';
}

function clearGpioDOForm() {
    gpioDoName.value = '';
    gpioDoGpioId.value = 'gpio1';
    populateGpioIdSelects();
    gpioDoId.value = '1';
    gpioControlType.value = 'switch';
    gpioPushWait.value = '250';
    gpioDoResponseMsg.value = '';

    editingControlName = null;
    editingControlType = null;

    updateGpioDOBtn.disabled = true;
    toggleGpioPushWait();
}

function clearGpioDIForm() {
    gpioDiName.value = '';
    gpioDiGpioId.value = 'gpio1';
    populateGpioIdSelects();
    gpioDiId.value = '1';
    gpioWaitTimeEnabled.checked = false;
    gpioWaitTime.value = '250';
    gpioDiFallbackEnabled.checked = false;
    gpioDiResponseMsg.value = '';

    editingControlName = null;
    editingControlType = null;

    updateGpioDIBtn.disabled = true;
    toggleGpioWaitTime();
}

// ---------- ADD ----------
async function addGPIODOControl() {
    if (!gpioDoName.value || !/^[A-Za-z0-9]+$/.test(gpioDoName.value)) {
        showStatus('GPIO DO Name must be alphanumeric without spaces', 'error', 3000); return;
    }
    if (!gpioDoGpioId.value || !gpioDoId.value || !gpioControlType.value || !gpioDoResponseMsg.value) {
        showStatus('All required fields must be filled', 'error', 3000); return;
    }
    const body = {
        type: 'GpioDoControl',
        name: `${gpioDoName.value}[DO]`,
        gpioId: gpioDoGpioId.value,
        doId: gpioDoId.value,
        controlType: gpioControlType.value,
        pushWait: gpioControlType.value === 'push' ? gpioPushWait.value : '250',
        responseMsg: gpioDoResponseMsg.value
    };
    await callAPI('addControl', body, () => { clearGpioDOForm(); loadSequences(); closeGpioFormPopup(); });
}

async function addGPIODIControl() {
    if (!gpioDiName.value || !/^[A-Za-z0-9]+$/.test(gpioDiName.value)) {
        showStatus('GPIO DI Name must be alphanumeric without spaces', 'error', 3000); return;
    }
    if (!gpioDiGpioId.value || !gpioDiId.value || !gpioDiResponseMsg.value) {
        showStatus('All required fields must be filled', 'error', 3000); return;
    }
    const body = {
        type: 'GpioDiControl',
        name: `${gpioDiName.value}[DI]`,
        gpioId: gpioDiGpioId.value,
        diId: gpioDiId.value,
        waitTime: gpioWaitTimeEnabled.checked ? gpioWaitTime.value : null,
        responseMsg: gpioDiResponseMsg.value,
        with_fallback: gpioDiFallbackEnabled.checked
    };
    await callAPI('addControl', body, () => { clearGpioDIForm(); loadSequences(); closeGpioFormPopup(); });
}

// ---------- UPDATE ----------
async function updateGPIODOControl() {
    if (!editingControlName || !gpioDoName.value || !/^[A-Za-z0-9]+(\[(DO|DI)\])?$/.test(gpioDoName.value)) {
        showStatus('GPIO DO Name must be alphanumeric without spaces', 'error', 3000); return;
    }
    if (!gpioDoGpioId.value || !gpioDoId.value || !gpioControlType.value || !gpioDoResponseMsg.value) {
        showStatus('All required fields must be filled', 'error', 3000); return;
    }
    const body = {
        oldName: editingControlName,
        type: 'GpioDoControl',
        name: gpioDoName.value,
        gpioId: gpioDoGpioId.value,
        doId: gpioDoId.value,
        controlType: gpioControlType.value,
        pushWait: gpioControlType.value === 'push' ? gpioPushWait.value : '250',
        responseMsg: gpioDoResponseMsg.value
    };
    await callAPI('updateControl', body, () => { clearGpioDOForm(); loadSequences(); closeGpioFormPopup(); });
}

async function updateGPIODIControl() {
    if (!editingControlName || !gpioDiName.value || !/^[A-Za-z0-9]+(\[(DO|DI)\])?$/.test(gpioDiName.value)) {
        showStatus('GPIO DI Name must be alphanumeric without spaces', 'error', 3000); return;
    }
    if (!gpioDiGpioId.value || !gpioDiId.value || !gpioDiResponseMsg.value) {
        showStatus('All required fields must be filled', 'error', 3000); return;
    }
    const body = {
        oldName: editingControlName,
        type: 'GpioDiControl',
        name: gpioDiName.value,
        gpioId: gpioDiGpioId.value,
        diId: gpioDiId.value,
        waitTime: gpioWaitTimeEnabled.checked ? gpioWaitTime.value : null,
        responseMsg: gpioDiResponseMsg.value,
        with_fallback: gpioDiFallbackEnabled.checked
    };
    await callAPI('updateControl', body, () => { clearGpioDIForm(); loadSequences(); closeGpioFormPopup(); });
}

// ---------- EDIT (opens GPIO popup, pulls from getControl) ----------
function editGpioControl(name, type) {
    closeFormPopup();              // <-- add this line first
    editingControlName = name;
    editingControlType = type;
    populateGpioIdSelects();
    gpioFormPopup.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    swipeGpioEditor(type === 'GpioDiControl' ? 'right' : 'left');

    fetch(`${API_BASE}/getControl/${name}`)
        .then(res => res.json())
        .then(data => {
            if (type === 'GpioDoControl') {
                gpioDoName.value = data.name;
                gpioDoGpioId.value = data.gpioId || '';
                ensureOption(gpioDoId, data.doId);
                gpioControlType.value = data.controlType || 'switch';
                gpioPushWait.value = data.pushWait || '250';
                gpioDoResponseMsg.value = data.responseMsg || '';
                toggleGpioPushWait();
                updateGpioDOBtn.disabled = false;
                updateGpioDIBtn.disabled = true;
            } else {
                gpioDiName.value = data.name;
                gpioDiGpioId.value = data.gpioId || '';
                ensureOption(gpioDiId, data.diId);
                gpioWaitTimeEnabled.checked = !!data.waitTime;
                gpioDiFallbackEnabled.checked = !!data.with_fallback;
                gpioWaitTime.value = data.waitTime || '250';
                gpioDiResponseMsg.value = data.responseMsg || '';
                toggleGpioWaitTime();
                updateGpioDIBtn.disabled = false;
                updateGpioDOBtn.disabled = true;
            }
            updateGpioFormPopupTitle();
            showStatus(`Editing ${name} (${type})`, 'success', 2000);
        })
        .catch(err => showStatus(`Failed to load control: ${err.message}`, 'error', 3000));
}

// close GPIO popup on backdrop click / Escape
document.addEventListener('click', (e) => {
    if (e.target === document.getElementById('gpioFormPopup')) closeGpioFormPopup();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeGpioFormPopup();
});