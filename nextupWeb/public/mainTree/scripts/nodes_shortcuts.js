// nodes_shortcuts.js
//
// Two families of keyboard shortcuts for the Main Tree editor:
//
//   Shift + key   →  Add Node as CHILD of selected node  (existing behaviour)
//   Alt   + key   →  Add Node AFTER selected node        (new)
//
// ──────────────────────────────────────────────────────────────────────
// HOW TO ADD A NEW SHORTCUT
// ──────────────────────────────────────────────────────────────────────
// Add ONE entry to NODE_SHORTCUTS below. Both Shift+key (add-child) and
// Alt+key (add-after) are generated automatically from the same table.
//
//   key:         letter pressed with Shift or Alt (case-insensitive)
//   nodeName:    exact name as it appears in nodes.json
//   label:       friendly name shown in toasts / help modal
//   attributes:  (optional) default attribute overrides
//
// Example — Shift+T / Alt+T → Timeout:
//   { key: 't', nodeName: 'Timeout', label: 'Timeout' },
// ──────────────────────────────────────────────────────────────────────

const NODE_SHORTCUTS = [
    { key: 'o', nodeName: 'PilzPointsPlanner',       label: 'PilzPointsPlanner' },
    { key: 's', nodeName: 'Sequence',            label: 'Sequence'              },
    { key: 'f', nodeName: 'Fallback',            label: 'Fallback'              },
    { key: 'l', nodeName: 'Sleep',           label: 'Sleep'                 },
    { key: 'm', nodeName: 'MsgLogger',           label: 'Message Logger'        },
    { key: 'p', nodeName: 'MsgPopup',            label: 'Message Popup'         },
    { key: 'd', nodeName: 'Delay',               label: 'Delay'                 },
    { key: 'i', nodeName: 'Inverter',            label: 'Inverter'              },
    { key: 'z', nodeName: 'AlwaysFailure',       label: 'Always Failure'        },
    { key: 'r', nodeName: 'RetryUntilSuccessful',label: 'Retry Until Successful'},
    { key: 'a', nodeName: 'AlwaysSuccess',       label: 'Always Success'        },
];

// ──────────────────────────────────────────────────────────────────────
// Implementation — nothing below needs to change when you add shortcuts.
// ──────────────────────────────────────────────────────────────────────

let _shortcutLookup = new Map();   // key → entry  (used by both Shift and Alt handlers)

function _rebuildShortcutLookup() {
    _shortcutLookup = new Map();
    for (const entry of NODE_SHORTCUTS) {
        const k = entry.key.toLowerCase();
        if (_shortcutLookup.has(k)) {
            console.warn(`[nodes_shortcuts] Duplicate key "${k}" — "${_shortcutLookup.get(k).nodeName}" overridden by "${entry.nodeName}"`);
        }
        _shortcutLookup.set(k, entry);
    }
}
_rebuildShortcutLookup();

/** Register a shortcut at runtime (e.g. from a settings panel). */
function registerNodeShortcut(entry) {
    if (!entry || !entry.key || !entry.nodeName) {
        console.warn('[nodes_shortcuts] registerNodeShortcut requires { key, nodeName }');
        return;
    }
    NODE_SHORTCUTS.push(entry);
    _rebuildShortcutLookup();
}

// ── Shared helpers ────────────────────────────────────────────────────

function _findNodeRegistration(nodeName) {
    if (!nodeDefinitions || !availableCategories) return null;
    for (const catKey of availableCategories) {
        const cat = nodeDefinitions[catKey];
        if (!cat?.nodes) continue;
        for (const nodeTypeKey in cat.nodes) {
            const nodes = cat.nodes[nodeTypeKey];
            if (nodes?.[nodeName]) {
                return { catKey, nodeTypeKey, nodeDef: nodes[nodeName] };
            }
        }
    }
    return null;
}

function _generateUniqueNodeName(nodeName) {
    const now = new Date();
    const t = `${now.getHours()}${now.getMinutes()}${now.getSeconds()}`.slice(-6);
    return `${nodeName}_${t}`;
}

function _buildAttributes(nodeDef, entryOverrides) {
    const attributes = {};
    if (nodeDef?.attributes) {
        for (const [k, v] of Object.entries(nodeDef.attributes)) attributes[k] = v || '';
    }
    if (entryOverrides) Object.assign(attributes, entryOverrides);
    return attributes;
}

// ── Shift + key  →  Add as CHILD ─────────────────────────────────────

async function _addNodeViaShortcut(entry) {
    if (!selectedNode || !currentSubtreeId) {
        showToast('Select a parent node first!', 'warn');
        return;
    }

    const reg = _findNodeRegistration(entry.nodeName);
    if (!reg) {
        showToast(`Shortcut error: "${entry.nodeName}" not in registry`, 'failure');
        return;
    }

    const { nodeDef } = reg;
    const isWrapper = nodeDef.type === 'wrapper';

    if (!isWrapper && !checkIsWrapper(selectedNode.data.type)) {
        showToast('Leaf nodes can only be added under wrapper nodes!', 'warn');
        return;
    }

    const label     = entry.label || entry.nodeName;
    const nodeName  = _generateUniqueNodeName(entry.nodeName);
    const attributes = _buildAttributes(nodeDef, entry.attributes);

    try {
        const res = await fetch(`${API_BASE}/addNode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subtreeId:  currentSubtreeId,
                parentPath: selectedNode.data.path.slice(1),
                nodeType:   entry.nodeName,
                nodeName,
                attributes,
            }),
        });
        if (!res.ok) throw new Error(await res.text());
        showToast(`Added ${label}`, 'success');
        await loadSubtree(currentSubtreeId);
    } catch (err) {
        showToast(`Failed to add ${label}: ${err.message}`, 'failure');
    }
}

// ── Alt + key  →  Add AFTER selected node ────────────────────────────

async function _addNodeAfterViaShortcut(entry) {
    if (!selectedNode || !currentSubtreeId) {
        showToast('Select a node first!', 'warn');
        return;
    }
    if (selectedNode.data.type === 'BehaviorTree') {
        showToast('Cannot add after the root node', 'warn');
        return;
    }

    const reg = _findNodeRegistration(entry.nodeName);
    if (!reg) {
        showToast(`Shortcut error: "${entry.nodeName}" not in registry`, 'failure');
        return;
    }

    const label      = entry.label || entry.nodeName;
    const nodeName   = _generateUniqueNodeName(entry.nodeName);
    const attributes = _buildAttributes(reg.nodeDef, entry.attributes);

    try {
        const res = await fetch(`${API_BASE}/addNodeAfter`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subtreeId:   currentSubtreeId,
                siblingPath: selectedNode.data.path.slice(1),
                nodeType:    entry.nodeName,
                nodeName,
                attributes,
            }),
        });
        if (!res.ok) throw new Error(await res.text());
        showToast(`Added ${label} after "${selectedNode.data.name}"`, 'success');
        await loadSubtree(currentSubtreeId);
    } catch (err) {
        showToast(`Failed to add ${label} after: ${err.message}`, 'failure');
    }
}

// ── Keydown listeners ─────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (e.ctrlKey || e.metaKey) return;

    const key   = e.key.toLowerCase();
    const entry = _shortcutLookup.get(key);
    if (!entry) return;

    if (e.shiftKey && !e.altKey) {
        // Shift+key — but skip if it's an arrow (those are for selection nav)
        if (['arrowleft','arrowright','arrowup','arrowdown'].includes(key)) return;
        e.preventDefault();
        _addNodeViaShortcut(entry);
        return;
    }

    if (e.altKey && !e.shiftKey) {
        // Alt+key — add after
        e.preventDefault();
        _addNodeAfterViaShortcut(entry);
        return;
    }
});

// ──────────────────────────────────────────────────────────────────────
// Help modal  (Ctrl+S to toggle)
// Shows BOTH shortcut families in two columns side by side.
// Rebuilt from NODE_SHORTCUTS every open so it's always in sync.
// ──────────────────────────────────────────────────────────────────────

const SHORTCUTS_MODAL_ID = 'node-shortcuts-help-modal';
let _shortcutsModalOpen  = false;

function _formatKey(key) {
    return key.length === 1 ? key.toUpperCase() : key;
}

function _buildShortcutsModal() {
    const overlay = document.createElement('div');
    overlay.id        = SHORTCUTS_MODAL_ID;
    overlay.className = 'ns-modal-overlay';
    overlay.style.display = 'none';

    const addChildRows  = NODE_SHORTCUTS.map(e => `
        <div class="ns-row">
            <span class="ns-keycap">Shift</span>
            <span class="ns-plus">+</span>
            <span class="ns-keycap">${_formatKey(e.key)}</span>
            <span class="ns-desc">${e.label || e.nodeName}</span>
        </div>`).join('');

    const addAfterRows  = NODE_SHORTCUTS.map(e => `
        <div class="ns-row">
            <span class="ns-keycap">Alt</span>
            <span class="ns-plus">+</span>
            <span class="ns-keycap">${_formatKey(e.key)}</span>
            <span class="ns-desc">${e.label || e.nodeName}</span>
        </div>`).join('');

    overlay.innerHTML = `
        <div class="ns-modal-content" style="width:680px;max-width:94vw;">
            <div class="ns-modal-header">
                <span><b>Node Shortcuts</b></span>
                <button type="button" class="ns-close-btn" title="Close (Ctrl+S)">&times;</button>
            </div>

            <!-- two-column section headers -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border-bottom:1px solid #ececee;">
                <div style="padding:7px 14px;font-size:11px;font-weight:600;color:#6e6e73;
                            border-right:1px solid #ececee;background:#fafafa;">
                    ADD AS CHILD &nbsp;<span style="font-weight:400;">(of selected node)</span>
                </div>
                <div style="padding:7px 14px;font-size:11px;font-weight:600;color:#6e6e73;background:#fafafa;">
                    ADD AFTER &nbsp;<span style="font-weight:400;">(same level, next position)</span>
                </div>
            </div>

            <!-- two-column rows -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;overflow-y:auto;max-height:55vh;">
                <div class="ns-modal-body" style="border-right:1px solid #ececee;border-radius:0;">
                    ${addChildRows || '<div class="ns-empty">None</div>'}
                </div>
                <div class="ns-modal-body" style="border-radius:0;">
                    ${addAfterRows || '<div class="ns-empty">None</div>'}
                </div>
            </div>

            <!-- navigation shortcuts section -->
            <div style="border-top:1px solid #ececee;padding:10px 14px;background:#fafafa;">
                <div style="font-size:11px;font-weight:600;color:#6e6e73;margin-bottom:6px;">NAVIGATION &amp; ACTIONS</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 0;">
                    <div class="ns-row" style="border:none;padding:4px 0;">
                        <span class="ns-keycap">Shift</span><span class="ns-plus">+</span><span class="ns-keycap">←</span>
                        <span class="ns-desc">Select previous sibling</span>
                    </div>
                    <div class="ns-row" style="border:none;padding:4px 0;">
                        <span class="ns-keycap">Shift</span><span class="ns-plus">+</span><span class="ns-keycap">→</span>
                        <span class="ns-desc">Select next sibling</span>
                    </div>
                    <div class="ns-row" style="border:none;padding:4px 0;">
                        <span class="ns-keycap">Shift</span><span class="ns-plus">+</span><span class="ns-keycap">↑</span>
                        <span class="ns-desc">Select parent node</span>
                    </div>
                    <div class="ns-row" style="border:none;padding:4px 0;">
                        <span class="ns-keycap">Shift</span><span class="ns-plus">+</span><span class="ns-keycap">↓</span>
                        <span class="ns-desc">Select first child</span>
                    </div>
                    <div class="ns-row" style="border:none;padding:4px 0;">
                        <span class="ns-keycap">Delete</span>
                        <span class="ns-desc">Delete selected node</span>
                    </div>
                    <div class="ns-row" style="border:none;padding:4px 0;">
                        <span class="ns-keycap">Enter</span><span class="ns-plus">/</span><span class="ns-keycap">Esc</span>
                        <span class="ns-desc">Confirm / cancel dialog</span>
                    </div>
                    <div class="ns-row" style="border:none;padding:4px 0;">
                        <span class="ns-keycap">Ctrl</span><span class="ns-plus">+</span><span class="ns-keycap">←</span><span class="ns-plus">/</span><span class="ns-keycap">→</span>
                        <span class="ns-desc">Move node left / right</span>
                    </div>
                    <div class="ns-row" style="border:none;padding:4px 0;">
                        <span class="ns-keycap">Ctrl</span><span class="ns-plus">+</span><span class="ns-keycap">D</span>
                        <span class="ns-desc">Copy selected node</span>
                    </div>
                </div>
            </div>

            <div class="ns-modal-footer">
                <span class="ns-keycap">Ctrl</span><span class="ns-plus">+</span><span class="ns-keycap">S</span>
                <span class="ns-desc">Toggle this window</span>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelector('.ns-close-btn').addEventListener('click', closeShortcutsModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeShortcutsModal(); });
    return overlay;
}

function openShortcutsModal() {
    const existing = document.getElementById(SHORTCUTS_MODAL_ID);
    if (existing) existing.remove();
    const modal = _buildShortcutsModal();
    modal.style.display = 'flex';
    _shortcutsModalOpen = true;
}

function closeShortcutsModal() {
    const modal = document.getElementById(SHORTCUTS_MODAL_ID);
    if (modal) modal.style.display = 'none';
    _shortcutsModalOpen = false;
}

function toggleShortcutsModal() {
    _shortcutsModalOpen ? closeShortcutsModal() : openShortcutsModal();
}

document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.key.toLowerCase() !== 's') return;
    if (e.shiftKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    toggleShortcutsModal();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _shortcutsModalOpen) closeShortcutsModal();
});