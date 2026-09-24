// file - error_handleing.js

document.addEventListener('DOMContentLoaded', () => {

    const state = {
        cells: []
    };

    // ── ROS STATUS (driven by parent postMessage) ──────────────



    // ── RECEIVE FROM PARENT (replaces roslib subscriptions) ────
    window.addEventListener("message", (event) => {
        const msg = event.data;
        if (!msg || !msg.type) return;

        switch (msg.type) {

            // NOTE: LOG_MESSAGE_INCOMING is handled by the
            // "Live Log History" block at the bottom of this file.

            // Replaces monitorTopic.subscribe
            case "ACTIVE_NODES": {
                const active = msg.payload;
                Object.values(nodeEls).forEach(e => e.classList.remove('active'));
                Object.values(controllerEls).forEach(e => e.classList.remove('active'));
                active.forEach(name => {
                    nodeEls[name]?.classList.add('active');
                    controllerEls[name]?.classList.add('active');
                });
                break;
            }

            // Service call response
            case "MONITORING_RESPONSE": {
                const btn = msg.payload.action === 'start' ? startBtn : stopBtn;
                flashButton(btn, msg.payload.success ? 'success' : 'failure');
                break;
            }
        }
    });

    // ── CLOCK ──────────────────────────────────────────────────
    function updateClock() {
        document.getElementById('digital-clock').textContent =
            new Date().toLocaleTimeString('en-US', { hour12: false });
    }
    setInterval(updateClock, 1000);
    updateClock();

    // ── SERVICES (send to parent → WS → ROS) ──────────────────
    function sendToParent(type) {
        window.parent.postMessage({ type }, "*");
    }

    function flashButton(button, cls) {
        button.classList.add(cls);
        setTimeout(() => button.classList.remove('success', 'failure'), 2000);
    }

    const startBtn = document.getElementById('monitorStartBtn');
    const stopBtn = document.getElementById('monitorStopBtn');

    startBtn.addEventListener('click', () => sendToParent("MONITORING_START"));
    stopBtn.addEventListener('click', () => sendToParent("MONITORING_STOP"));

    // ── MONITOR MODAL ──────────────────────────────────────────
    const monitorOpenBtn = document.getElementById('monitor-open-btn');
    const monitorCloseBtn = document.getElementById('monitor-close-btn');
    const monitorOverlay = document.getElementById('monitor-modal-overlay');

    monitorOpenBtn.onclick = () => monitorOverlay.classList.remove('hidden');
    monitorCloseBtn.onclick = () => monitorOverlay.classList.add('hidden');

    const monitorNodeContainer = document.getElementById('monitor-nodes');
    const monitorControllerContainer = document.getElementById('monitor-controllers');
    const nodeEls = {};
    const controllerEls = {};

    fetch('/ros-monitor/names')
        .then(r => r.json())
        .then(data => {
            data.nodes.forEach(name => {
                const el = createMonitorItem(name);
                monitorNodeContainer.appendChild(el);
                nodeEls[name] = el;
            });
            data.controllers.forEach(name => {
                const el = createMonitorItem(name);
                monitorControllerContainer.appendChild(el);
                controllerEls[name] = el;
            });
        });

    function createMonitorItem(name) {
        const el = document.createElement('div');
        el.className = 'monitor-item';
        el.textContent = name;
        return el;
    }

    // ── COMMANDS MODAL ─────────────────────────────────────────
    // ... (rest of commands modal, description modal, open-terminal code unchanged)
    // Keep everything from your original below this line as-is:

    const modal = document.getElementById('commands-modal');
    const container = document.getElementById('cells-container');
    const openBtn = document.getElementById('open-commands');
    const closeBtn = document.getElementById('close-commands');
    const saveBtn = document.getElementById('save-commands');
    const addTextBtn = document.getElementById('add-text-cell');
    const addCmdBtn = document.getElementById('add-command-cell');

    openBtn.onclick = () => { modal.classList.remove('hidden'); loadCells(); };
    closeBtn.onclick = () => modal.classList.add('hidden');

    function loadCells() {
        container.innerHTML = 'Loading…';
        fetch('/error-logs/commands')
            .then(res => res.json())
            .then(data => { state.cells = data.cells || []; renderCells(); })
            .catch(() => { state.cells = []; renderCells(); });
    }

    saveBtn.onclick = () => {
        fetch('/error-logs/commands', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cells: state.cells })
        }).then(() => alert('Saved')).catch(() => alert('Save failed'));
    };

    addTextBtn.onclick = () => { state.cells.push({ type: 'text', content: '' }); renderCells(); };
    addCmdBtn.onclick = () => { state.cells.push({ type: 'command', content: '' }); renderCells(); };

    function renderCells() {
        container.innerHTML = '';
        state.cells.forEach((cell, index) => {
            if (cell.type === 'text') renderTextCell(cell, index);
            else renderCommandCell(cell, index);
        });
    }

    function renderTextCell(cell, index) {
        const wrapper = document.createElement('div');
        wrapper.className = 'cell text-cell';
        const content = document.createElement('div');
        content.className = 'cell-content';
        content.textContent = cell.content || 'Click edit to add text';
        content.contentEditable = false;
        const editBtn = createEditBtn(() => enableEdit(content, index));
        wrapper.append(content, editBtn);
        container.appendChild(wrapper);
    }

    function renderCommandCell(cell, index) {
        const wrapper = document.createElement('div');
        wrapper.className = 'cell command-cell';
        const content = document.createElement('div');
        content.className = 'cell-content mono';
        content.textContent = cell.content || 'Click edit to add command';
        content.contentEditable = false;
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.textContent = 'Copy';
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(cell.content || '');
            copyBtn.textContent = 'Copied';
            setTimeout(() => copyBtn.textContent = 'Copy', 1000);
        };
        const editBtn = createEditBtn(() => enableEdit(content, index));
        wrapper.append(content, copyBtn, editBtn);
        container.appendChild(wrapper);
    }

    function createEditBtn(onClick) {
        const btn = document.createElement('button');
        btn.className = 'edit-btn';
        btn.innerHTML = 'edit';
        btn.onclick = onClick;
        return btn;
    }

    function enableEdit(contentDiv, index) {
        contentDiv.contentEditable = true;
        contentDiv.focus();
        contentDiv.onblur = () => {
            state.cells[index].content = contentDiv.textContent.trim();
            contentDiv.contentEditable = false;
        };
    }

    document.getElementById('open-terminal').onclick = () => {
        fetch('/error-logs/open-terminal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cwd: '/home/nextup' })
        }).catch(() => alert('Failed to open terminal'));
    };

    const descModal = document.getElementById('description-modal');
    const textarea = document.getElementById('description-text');
    const editDescBtn = document.getElementById('edit-description');
    const saveDescBtn = document.getElementById('save-description');

    document.getElementById('open-description').onclick = () => {
        descModal.classList.remove('hidden');
        loadDescription();
    };
    document.getElementById('close-description').onclick = () => {
        exitEditMode();
        descModal.classList.add('hidden');
    };
    editDescBtn.onclick = () => {
        textarea.removeAttribute('readonly');
        textarea.focus();
        editDescBtn.classList.add('hidden');
        saveDescBtn.classList.remove('hidden');
    };
    saveDescBtn.onclick = () => {
        fetch('/error-logs/description', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: textarea.value })
        }).then(() => exitEditMode()).catch(() => alert('Failed to save description'));
    };

    function exitEditMode() {
        textarea.setAttribute('readonly', true);
        editDescBtn.classList.remove('hidden');
        saveDescBtn.classList.add('hidden');
    }

    function loadDescription() {
        textarea.value = 'Loading…';
        fetch('/error-logs/description')
            .then(res => res.text())
            .then(text => textarea.value = text)
            .catch(() => textarea.value = 'Failed to load description');
    }

}); // end first DOMContentLoaded

document.addEventListener('DOMContentLoaded', () => {

    const container = document.getElementById('error-history');
    const limitSelect = document.getElementById('limit-select');
    const searchInput = document.getElementById('history-search');
    const countLabel = document.getElementById('history-count');

    let allLogs = [];

    // ---------------- INITIAL LOAD ----------------
    loadLogs(limitSelect.value);

    limitSelect.addEventListener('change', () => {
        loadLogs(limitSelect.value);
    });

    const reloadBtn = document.getElementById('reload-history');
    reloadBtn.addEventListener('click', () => {
        loadLogs(limitSelect.value);
    });


    searchInput.addEventListener('input', applyFilter);

    // ---------------- FETCH ----------------
    function loadLogs(limit) {
        container.innerHTML = `<div class="loading-text">Loading…</div>`;
        countLabel.textContent = '';

        fetch(`/error-logs?limit=${limit}`)
            .then(res => res.json())
            .then(data => {
                allLogs = data.logs || [];
                applyFilter();
            })
            .catch(() => {
                container.innerHTML =
                    `<div class="error-text">Failed to load logs</div>`;
            });
    }

    // ---------------- FILTER ----------------
    function applyFilter() {
        const keyword = searchInput.value.toLowerCase();
        container.innerHTML = '';

        const filtered = allLogs.filter(log => {
            const combined =
                `${log.time} ${log.joint} ${log.last_error} ${toHex(log.last_error)}`;
            return combined.toLowerCase().includes(keyword);
        });

        filtered.slice().reverse().forEach(renderRow);
        countLabel.textContent = `Showing ${filtered.length} / ${allLogs.length}`;
    }

    // ---------------- RENDER ----------------
    function renderRow(log) {
        const row = document.createElement('div');
        row.className = 'error-row';

        row.append(
            pill('time-pill', log.time),
            pill('joint-pill', log.joint),
            errorPills(log.last_error)
        );

        container.appendChild(row);
    }

    function pill(cls, text) {
        const div = document.createElement('div');
        div.className = `pill ${cls}`;
        div.textContent = text;
        return div;
    }

    function errorPills(dec) {
        const wrapper = document.createElement('div');
        wrapper.className = 'error-pill-group';

        // CLICKABLE HEX BUTTON
        const hexBtn = document.createElement('button');
        hexBtn.className = 'pill error-pill clickable-pill';
        hexBtn.textContent = `E ${toHex(dec)}`;

        // Normal decimal pill
        const decPill = pill('error-pill faded', dec);

        // CLICK HANDLER
        hexBtn.addEventListener('click', async () => {

            // Open modal + ensure database loaded
            await showFaultModal();

            const input = document.getElementById('fault-search-input');
            if (!input) return;

            // Fill search
            input.value = `E${toHex(dec)}`;
            // Update internal filter state
            faultSearchTerm = `${toHex(dec).toLowerCase()}`;

            // Trigger rendering
            renderFaultList();

            // Optional focus
            input.focus();
        });

        wrapper.append(hexBtn, decPill);

        return wrapper;
    }

    function toHex(dec) {
        return Number(dec).toString(16).toUpperCase().padStart(2, '0');
    }
});


// ═══════════════════════════════════════════════════════════
//  FAULT LOOKUP
// ═══════════════════════════════════════════════════════════
let faultData = [];
let faultSearchTerm = '';
let faultFilterMode = 'all';

async function showFaultModal() {
    showModal('fault-modal');
    setTimeout(() => document.getElementById('fault-search-input')?.focus(), 200);
    if (faultData.length === 0) {
        try {
            const json = await fetchFaults();
            faultData = json.faults || [];
        } catch {
            document.getElementById('fault-list-container').innerHTML =
                `<div class="fault-no-results"><strong>Could not load fault database</strong>Backend offline or faults.json missing.</div>`;
            return;
        }
    }
    renderFaultList();
}

function filterFaults(term) {
    faultSearchTerm = term.trim().toLowerCase();
    const clearBtn = document.getElementById('fault-search-clear');
    if (clearBtn) clearBtn.style.display = faultSearchTerm ? 'block' : 'none';
    renderFaultList();
}

function clearFaultSearch() {
    document.getElementById('fault-search-input').value = '';
    document.getElementById('fault-search-clear').style.display = 'none';
    faultSearchTerm = '';
    renderFaultList();
}

function setFaultFilter(mode, btn) {
    faultFilterMode = mode;
    document.querySelectorAll('.fault-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderFaultList();
}

function renderFaultList() {
    const container = document.getElementById('fault-list-container');
    const badge = document.getElementById('fault-count-badge');
    const term = faultSearchTerm;

    console.log('Rendering faults, total items:', faultData.length);
    console.log('Search term:', term);
    console.log('Filter mode:', faultFilterMode);

    const results = [];
    
    for (const fault of faultData) {
        // Skip if fault is missing required data
        if (!fault || !fault.subFaults || !Array.isArray(fault.subFaults)) {
            console.warn('Invalid fault structure:', fault);
            continue;
        }
        
        // Determine if this is a warning (check if it's from warnings array)
        // You might need to add a type field to your data or check fault code range
        // For now, I'll assume warnings have fault codes starting with 'E' and then 3 digits
        // Or you can modify your backend to add a 'type' field
        
        const matchingSubFaults = fault.subFaults.filter(sf => {
            if (!sf) return false;
            
            // Filter by resettable mode
            if (faultFilterMode === 'No' && sf.resettable !== 'No') return false;
            if (faultFilterMode === 'Yes' && sf.resettable !== 'Yes') return false;
            
            // Filter by range
            if (faultFilterMode === 'Servo' && !sf.faultRange?.includes('Servo')) return false;
            if (faultFilterMode === 'Axis' && !sf.faultRange?.includes('Axis')) return false;
            if (faultFilterMode === 'Warning' && !sf.faultRange?.includes('Warning')) return false;
            
            // If no search term, include all remaining sub-faults
            if (!term) return true;
            
            // Search in all relevant fields
            const searchableText = [
                fault.faultCode,
                fault.faultName,
                sf.subFaultCode,
                sf.name,
                sf.errorCode603Fh,
                sf.auxiliaryCode203Fh,
                ...(sf.causesAndSolutions || []).flatMap(cs => [
                    cs.cause,
                    cs.solution,
                    cs.confirmingMethod
                ])
            ].filter(Boolean).join(' ').toLowerCase();
            
            return searchableText.includes(term);
        });
        
        if (matchingSubFaults.length > 0) {
            // Add a type indicator
            const isWarning = fault.faultRange === 'Warning' || 
                            (fault.subFaults && fault.subFaults[0]?.faultRange === 'Warning');
            results.push({ 
                fault: { ...fault, _type: isWarning ? 'warning' : 'fault' }, 
                subFaults: matchingSubFaults 
            });
        }
    }

    const totalSubs = results.reduce((acc, r) => acc + r.subFaults.length, 0);
    if (badge) badge.textContent = `${totalSubs} result${totalSubs !== 1 ? 's' : ''}`;

    if (results.length === 0) {
        container.innerHTML = `<div class="fault-no-results"><strong>No faults found</strong>Try a different search term or clear the filter.</div>`;
        return;
    }

    container.innerHTML = '';
    const autoOpen = term.length > 0 && results.length <= 3;

    for (const { fault, subFaults } of results) {
        const groupEl = document.createElement('div');
        groupEl.className = 'fault-group' + (autoOpen ? ' open' : '');
        
        // Add warning class if it's a warning
        if (fault._type === 'warning') {
            groupEl.classList.add('warning-group');
        }
        
        // Add type badge to header
        const typeBadge = fault._type === 'warning' 
            ? '<span class="type-badge warning-badge">⚠️ Warning</span>' 
            : '<span class="type-badge fault-badge">🔴 Fault</span>';
        
        groupEl.innerHTML = `
      <div class="fault-group-header" onclick="toggleFaultGroup(this.parentElement)">
        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
          <span class="fault-group-code">${hl(fault.faultCode, term)}</span>
          <span class="fault-group-name">${hl(fault.faultName, term)}</span>
          ${typeBadge}
        </div>
        <div class="fault-group-meta">
          <span class="fault-sub-count">${subFaults.length} sub-fault${subFaults.length !== 1 ? 's' : ''}</span>
          <span class="fault-chevron">▼</span>
        </div>
      </div>
      <div class="fault-sub-list"></div>`;
        container.appendChild(groupEl);
        renderSubFaults(groupEl.querySelector('.fault-sub-list'), subFaults, fault, term, autoOpen);
    }
}
function renderSubFaults(container, subFaults, fault, term, autoOpenAll) {
    for (const sf of subFaults) {
        const sfEl = document.createElement('div');
        sfEl.className = 'sub-fault-item' + (autoOpenAll ? ' open' : '');
        const rangeTag = rangeTagHtml(sf.faultRange);
        const resetTag = sf.resettable === 'Yes'
            ? `<span class="tag tag-resettable">✓ Resettable</span>`
            : `<span class="tag tag-noresettable">✕ No Reset</span>`;
        sfEl.innerHTML = `
      <div class="sub-fault-header" onclick="toggleSubFault(this.parentElement)">
        <span class="sub-fault-code">${hl(sf.subFaultCode, term)}</span>
        <span class="sub-fault-name">${hl(sf.name, term)}</span>
        <div class="sub-fault-tags">${rangeTag}${resetTag}<span class="sub-chevron">▼</span></div>
      </div>
      <div class="sub-fault-body">
        <div class="sub-fault-meta-row">
          <span class="meta-chip"><span class="ml">603F</span>${hl(sf.errorCode603Fh || '—', term)}</span>
          <span class="meta-chip"><span class="ml">203F</span>${hl(sf.auxiliaryCode203Fh || '—', term)}</span>
          <span class="meta-chip"><span class="ml">Type</span>${sf.type || '—'}</span>
          <span class="meta-chip"><span class="ml">Range</span>${sf.faultRange || '—'}</span>
        </div>
        <div>
          <div class="causes-label">Causes &amp; Solutions (${sf.causesAndSolutions.length})</div>
          <div class="cause-solution-list"></div>
        </div>
      </div>`;
        container.appendChild(sfEl);
        renderCauseSolutions(sfEl.querySelector('.cause-solution-list'), sf.causesAndSolutions, term, autoOpenAll);
    }
}

function renderCauseSolutions(container, causeSolutions, term, autoOpenAll) {
    causeSolutions.forEach((cs, i) => {
        const csEl = document.createElement('div');
        csEl.className = 'cs-item' + (autoOpenAll ? ' open' : '');
        csEl.innerHTML = `
      <div class="cs-item-header" onclick="toggleCsItem(this.parentElement)">
        <span class="cs-num">${i + 1}</span>
        <span class="cs-cause-text">${hl(cs.cause, term)}</span>
        <span class="cs-expand-icon">▼</span>
      </div>
      <div class="cs-item-body">
        ${cs.confirmingMethod ? `<div class="cs-row"><span class="cs-row-label">Confirming Method</span><div class="cs-confirm-text">${hl(cs.confirmingMethod, term)}</div></div>` : ''}
        ${cs.solution ? `<div class="cs-row"><span class="cs-row-label">Solution</span><div class="cs-solution-text">${hl(cs.solution, term)}</div></div>` : ''}
      </div>`;
        container.appendChild(csEl);
    });
}

function toggleFaultGroup(el) { el.classList.toggle('open'); }
function toggleSubFault(el) { el.classList.toggle('open'); }
function toggleCsItem(el) { el.classList.toggle('open'); }

function hl(text, term) {
    if (!text) return '';
    const str = String(text);
    if (!term) return escHtml(str);
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return str.replace(new RegExp(`(${escaped})`, 'gi'), m => `<span class="hl">${escHtml(m)}</span>`);
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function rangeTagHtml(range) {
    if (!range) return '';
    if (range.includes('Warning')) return `<span class="tag tag-warning">Warning</span>`;
    if (range.includes('Servo drive')) return `<span class="tag tag-drive">Drive</span>`;
    if (range.includes('Axis')) return `<span class="tag tag-axis">Axis</span>`;
    return `<span class="tag tag-drive">${range}</span>`;
}


// ─────────────────────────────────────────────────────────────
//  FAULT DATABASE
// ─────────────────────────────────────────────────────────────

/**
 * Load the fault/sub-fault lookup database.
 * @returns {{ faults: Array }}
 */
async function fetchFaults() {
    console.log("Fetching faults from API...");
    try {
        const data = await get('/api/fault');
        console.log("Raw fault data received:", data);
        
        // Combine faults and warnings into a single array
        const allFaults = [];
        
        // Add faults if they exist
        if (data.faults && Array.isArray(data.faults)) {
            allFaults.push(...data.faults);
            console.log(`Added ${data.faults.length} faults`);
        }
        
        // Add warnings if they exist
        if (data.warnings && Array.isArray(data.warnings)) {
            allFaults.push(...data.warnings);
            console.log(`Added ${data.warnings.length} warnings`);
        }
        
        console.log(`Total items (faults + warnings): ${allFaults.length}`);
        
        return { faults: allFaults };
    } catch (error) {
        console.error("Error fetching faults:", error);
        throw error;
    }
}
const BASE_URL = 'http://localhost:3000/error-logs'

async function get(path, { timeout } = {}) {
    console.log("Triggered get");
    //   const opts = timeout ? { signal: AbortSignal.timeout(timeout) } : {};
    const res = await fetch(`${BASE_URL}${path}`);
    const data = await res.json();

    console.log(data);

    return data;
}

async function patch(path, body) {
    const res = await fetch(`http://localhost:3000/error-logs/api/fault`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return res.json();
}

// ── MODAL HELPERS ──────────────────────────────────────────
function showModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function backdropClose(e, id) { if (e.target === e.currentTarget) closeModal(id); }

// ═══════════════════════════════════════════════════════════
//  LIVE LOG HISTORY  (/logs_topic  →  live_logs.json)
//  - Persisted history loaded from GET /error-logs/live
//  - Live updates prepended in real time (latest at the top)
//  - Toggle switch to pause/resume live updates
//  - Reload, search, limit, and clear controls
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {

    const container   = document.getElementById('live-history');
    const limitSelect = document.getElementById('live-limit-select');
    const sourceSelect = document.getElementById('live-source-select');
    const searchInput = document.getElementById('live-search');
    const countLabel  = document.getElementById('live-count');
    const reloadBtn   = document.getElementById('live-reload');
    const clearBtn    = document.getElementById('live-clear');
    const liveToggle  = document.getElementById('live-toggle-input');

    if (!container) return; // section not present

    let liveLogs = [];        // oldest -> newest
    let liveEnabled = true;   // live-update switch state
    const MAX_IN_MEMORY = 2000;

    // ---------------- helpers ----------------
    function fmtTime(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return iso || '';
        return d.toLocaleTimeString('en-US', { hour12: false });
    }

    function normalizeLevel(level) {
        const l = String(level || 'info').toLowerCase();
        return ['info', 'success', 'warn', 'failure'].includes(l) ? l : 'info';
    }

    // A log is a "BT" log when its message begins with the [bt] tag,
    // e.g. "[bt] some logs" or "[bt] [success] some logs".
    function isBtLog(log) {
        return /^\s*\[bt\]/i.test(String(log.message || ''));
    }

    function matchesSource(log) {
        const src = sourceSelect ? sourceSelect.value : 'all';
        if (src === 'bt')      return isBtLog(log);
        if (src === 'backend') return !isBtLog(log);
        return true; // 'all'
    }

    function matchesSearch(log, keyword) {
        if (!keyword) return true;
        return `${fmtTime(log.timestamp)} ${log.level} ${log.message}`
            .toLowerCase()
            .includes(keyword);
    }

    function isPinnedToTop() {
        // within 40px of the top → keep autoscrolling to newest
        return container.scrollTop < 40;
    }

    // ---------------- render ----------------
    function makeRow(log) {
        const level = normalizeLevel(log.level);
        const bt = isBtLog(log);
        const row = document.createElement('div');
        row.className = `live-row live-${level}` + (bt ? ' live-bt' : '');

        const time = document.createElement('span');
        time.className = 'live-time';
        time.textContent = fmtTime(log.timestamp);

        const badges = document.createElement('span');
        badges.className = 'live-badges';

        if (bt) {
            const btBadge = document.createElement('span');
            btBadge.className = 'live-badge live-badge-bt';
            btBadge.textContent = 'bt';
            badges.appendChild(btBadge);
        }

        const badge = document.createElement('span');
        badge.className = `live-badge live-badge-${level}`;
        badge.textContent = level;
        badges.appendChild(badge);

        const msg = document.createElement('span');
        msg.className = 'live-msg';
        // strip a leading [bt] tag from the displayed text (shown as a badge)
        msg.textContent = String(log.message || '').replace(/^\s*\[bt\]\s*/i, '');

        row.append(time, badges, msg);
        return row;
    }

    function renderAll() {
        const keyword = searchInput.value.toLowerCase();
        container.innerHTML = '';

        const filtered = liveLogs.filter(l => matchesSource(l) && matchesSearch(l, keyword));
        const frag = document.createDocumentFragment();
        // newest first: latest at the top, older below
        filtered.slice().reverse().forEach(l => frag.appendChild(makeRow(l)));
        container.appendChild(frag);

        if (!filtered.length) {
            container.innerHTML = `<div class="loading-text">No logs.</div>`;
        }

        countLabel.textContent = `Showing ${filtered.length} / ${liveLogs.length}`;
        container.scrollTop = 0; // latest at top
    }

    // Prepend a single new live entry without a full re-render.
    function appendLive(log) {
        liveLogs.push(log); // in-memory stays oldest -> newest
        if (liveLogs.length > MAX_IN_MEMORY) {
            liveLogs = liveLogs.slice(-MAX_IN_MEMORY);
        }

        const keyword = searchInput.value.toLowerCase();
        if (!matchesSource(log) || !matchesSearch(log, keyword)) {
            countLabel.textContent = `Showing (filtered) / ${liveLogs.length}`;
            return;
        }

        const pinned = isPinnedToTop();
        // drop a stale "No logs." placeholder if present
        if (container.querySelector('.loading-text')) container.innerHTML = '';
        // newest goes to the top
        container.insertBefore(makeRow(log), container.firstChild);
        if (pinned) container.scrollTop = 0;

        countLabel.textContent =
            `Showing ${container.childElementCount} / ${liveLogs.length}`;
    }

    // ---------------- fetch persisted history ----------------
    function loadLive(limit) {
        container.innerHTML = `<div class="loading-text">Loading…</div>`;
        countLabel.textContent = '';

        fetch(`/error-logs/live?limit=${limit}`)
            .then(res => res.json())
            .then(data => {
                liveLogs = Array.isArray(data.logs) ? data.logs : [];
                renderAll();
            })
            .catch(() => {
                container.innerHTML =
                    `<div class="error-text">Failed to load live logs</div>`;
            });
    }

    // ---------------- controls ----------------
    limitSelect.addEventListener('change', () => loadLive(limitSelect.value));
    if (sourceSelect) sourceSelect.addEventListener('change', renderAll);
    reloadBtn.addEventListener('click',   () => loadLive(limitSelect.value));
    searchInput.addEventListener('input', renderAll);

    liveToggle.addEventListener('change', () => {
        liveEnabled = liveToggle.checked;
    });

    // ---------------- clear (custom confirm modal) ----------------
    const clearModal   = document.getElementById('live-clear-modal');
    const lcCancelBtn  = document.getElementById('lc-cancel');
    const lcConfirmBtn = document.getElementById('lc-confirm');

    function openClearModal() {
        clearModal.classList.remove('hidden');
        lcConfirmBtn.focus();
    }

    function closeClearModal() {
        clearModal.classList.add('hidden');
    }

    clearBtn.addEventListener('click', openClearModal);
    lcCancelBtn.addEventListener('click', closeClearModal);

    // click on the backdrop (not the dialog) closes
    clearModal.addEventListener('click', (e) => {
        if (e.target === clearModal) closeClearModal();
    });

    // Esc closes
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !clearModal.classList.contains('hidden')) {
            closeClearModal();
        }
    });

    lcConfirmBtn.addEventListener('click', () => {
        lcConfirmBtn.disabled = true;
        fetch('/error-logs/live', { method: 'DELETE' })
            .then(res => res.json())
            .then(() => {
                liveLogs = [];
                renderAll();
                closeClearModal();
            })
            .catch(() => {
                container.innerHTML =
                    `<div class="error-text">Failed to clear live logs</div>`;
                closeClearModal();
            })
            .finally(() => { lcConfirmBtn.disabled = false; });
    });

    // ---------------- live feed (parent → iframe postMessage) ----------------
    window.addEventListener('message', (event) => {
        const msg = event.data;
        if (!msg || msg.type !== 'LOG_MESSAGE_INCOMING') return;
        if (!liveEnabled) return; // live updates switched off

        const raw = String(msg.payload ?? '');
        // Optional [bt] source tag, then optional [level] tag.
        // e.g. "[bt] [success] foo", "[bt] foo", "[warn] foo", "foo"
        const m = raw.match(/^\s*(\[bt\]\s*)?(?:\[(info|success|warn|failure)\]\s*)?(.*)$/is);
        const btTag = m && m[1] ? '[bt] ' : '';
        const entry = {
            level: m && m[2] ? m[2].toLowerCase() : 'info',
            message: (btTag + (m ? m[3] : raw)).trim(),
            timestamp: new Date().toISOString(),
        };
        appendLive(entry);
    });

    // ---------------- initial load ----------------
    loadLive(limitSelect.value);
});