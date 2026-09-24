//node_editor.js


    async function deleteNode() {
        if (!selectedNode || !currentSubtreeId || selectedNode.data.type === 'BehaviorTree') {
            showToast('Select a valid node to delete!', 'warn');
            return;
        }
        if (!(await showConfirm('Delete this node?'))) return;

        // ── Snapshot sibling context BEFORE the delete so we can
        //    auto-select the right node afterwards ──────────────────
        const siblings   = selectedNode.parent ? [...(selectedNode.parent.children || [])] : [];
        const currentIdx = siblings.findIndex(s => s.data.attributes?._uid === selectedNode.data.attributes?._uid);
        const parentUid  = selectedNode.parent?.data?.attributes?._uid || null;
        const parentId   = selectedNode.parent?.data?.attributes?.ID   || null;

        // Candidate after delete (priority: next sibling → prev sibling → parent)
        let nextUid = null, nextId = null;
        if (currentIdx !== -1) {
            const afterNode  = siblings[currentIdx + 1]; // next
            const beforeNode = siblings[currentIdx - 1]; // prev
            if (afterNode) {
                nextUid = afterNode.data.attributes?._uid;
                nextId  = afterNode.data.attributes?.ID || afterNode.data.id;
            } else if (beforeNode) {
                nextUid = beforeNode.data.attributes?._uid;
                nextId  = beforeNode.data.attributes?.ID || beforeNode.data.id;
            } else {
                // No siblings left → select parent
                nextUid = parentUid;
                nextId  = parentId;
            }
        }

        try {
            const res = await fetch(`${API_BASE}/deleteNode`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subtreeId: currentSubtreeId,
                    nodePath: selectedNode.data.path.slice(1),
                }),
            });

            if (!res.ok) throw new Error(await res.text());
            showToast('Node deleted!');

            // Point selection at the candidate node so renderTree's
            // restore-selection block picks it up after reload.
            if (nextUid || nextId) {
                selectedNodeUid = nextUid;
                selectedNodeId  = nextId;
                selectedNode    = null;  // stale — will be re-resolved by renderTree
            } else {
                selectedNode    = null;
                selectedNodeUid = null;
                selectedNodeId  = null;
                ['add-node-btn', 'delete-node-btn', 'delete-wrapper-btn', 'add-wrapper-btn', 'add-node-after-btn']
                    .forEach(id => (document.getElementById(id).disabled = true));
                document.getElementById('edit-section').style.display = 'none';
            }

            loadSubtree(currentSubtreeId);
        } catch (err) {
            console.error('Error deleting node:', err);
            showToast(`Failed: ${err.message}`, 'failure');
        }
    }

    async function addNode() {
        if (!selectedNode || !currentSubtreeId) {
            showToast('Select a parent node first!', 'warn');
            return;
        }

        console.log(`=== addNode() called ===`);
        console.log(`Selected node type: ${selectedNode.data.type}`);
        console.log(`Selected node data:`, selectedNode.data);

        // Dynamically check if the selected node can be a parent
        const canBeParent = checkIsWrapper(selectedNode.data.type);

        console.log(`checkIsWrapper("${selectedNode.data.type}") = ${canBeParent}`);
        console.log(`Node definitions available:`, nodeDefinitions);

        if (!canBeParent) {
            showToast('Can only add under wrapper nodes!', 'warn');
            return;
        }

        const name = document.getElementById('new-node-name').value.trim();
        const type = document.getElementById('node-type').value;
        if (!name || !type) {
            showToast('Name and type required!', 'warn');
            return;
        }

        console.log(`Adding node type: ${type}, name: ${name}`);

        const attributes = {};
        document.querySelectorAll('#node-attributes input[data-attr]').forEach(inp => {
            const v = inp.value.trim();
            if (v) attributes[inp.dataset.attr] = v;
        });

        try {
            const res = await fetch(`${API_BASE}/addNode`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subtreeId: currentSubtreeId,
                    parentPath: selectedNode.data.path.slice(1), // 🔹 use _uid path
                    nodeType: type,
                    nodeName: name,
                    attributes
                })
            });

            const responseText = await res.text();
            console.log(`Backend response status: ${res.status}`);
            console.log(`Backend response:`, responseText);

            if (!res.ok) throw new Error(responseText);

            // reset UI
            document.getElementById('new-node-name').value = '';
            document.getElementById('node-category').value = '';
            document.getElementById('node-type').innerHTML = '<option value="">Select Node Type</option>';
            document.getElementById('node-attributes').innerHTML = '';

            showToast('Node added!', 'warn');
            loadSubtree(currentSubtreeId);
        } catch (err) {
            console.error(err);
            showToast(`Failed: ${err.message}`, 'failure');
        }
    }
    async function deleteWrapperOnly() {
        if (!selectedNode || !currentSubtreeId) {
            showToast('Select a wrapper node!', 'warn');
            return;
        }
        const wrapperTypes = ['Sequence', 'Fallback', 'Selector'];
        if (
            !checkIsWrapper(selectedNode.data.type) ||
            !selectedNode.parent ||
            !checkIsWrapper(selectedNode.parent.data.type)
        ) {
            showToast('Select a wrapper node with a wrapper parent!', 'warn');
            return;
        }
        if (!(await showConfirm('Delete wrapper only (children move to parent)?'))) return;


        try {
            const res = await fetch(`${API_BASE}/deleteWrapperOnly`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subtreeId: currentSubtreeId,
                    nodePath: selectedNode.data.path.slice(1) // 🔹 use _uid path
                })
            });
            if (!res.ok) throw new Error(await res.text());
            showToast('Wrapper deleted, children moved!');
            selectedNode = null;
            ['add-node-btn', 'delete-node-btn', 'delete-wrapper-btn', 'add-wrapper-btn', 'add-node-after-btn']
                .forEach(id => document.getElementById(id).disabled = true);
            document.getElementById('edit-section').style.display = 'none';
            loadSubtree(currentSubtreeId);
        } catch (err) {
            console.error('Error deleting wrapper:', err);
            showToast(`Failed: ${err.message}`, 'failure');
        }
    }

    async function copyNode() {
        if (!selectedNode || !currentSubtreeId) {
            showToast('Select a node to copy!', 'warn');
            return;
        }
        if (selectedNode.data.type === 'BehaviorTree') {
            showToast('Cannot copy the root BehaviorTree node!', 'warn');
            return;
        }

        // Block copying any node that is — or contains, at any depth — a
        // subtree element. Duplicating subtree references produces ambiguous
        // trees, so warn instead of copying.
        const SUBTREE_TAGS = ['SubTree', 'SubTreePlus'];
        function hasSubtree(node) {
            if (!node) return false;
            if (SUBTREE_TAGS.includes(node.type)) return true;
            return (node.children || []).some(hasSubtree);
        }
        if (hasSubtree(selectedNode.data)) {
            showToast("cant copy a node with a subtree", 'warn');
            return;
        }

        try {
            const res = await fetch(`${API_BASE}/copyNode`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subtreeId: currentSubtreeId,
                    nodePath: selectedNode.data.path.slice(1), // UID path, exclude subtree root
                }),
            });

            if (!res.ok) throw new Error(await res.text());
            showToast('Node copied!', 'success');
            loadSubtree(currentSubtreeId);
        } catch (err) {
            console.error('Error copying node:', err);
            showToast(`Failed to copy: ${err.message}`, 'failure');
        }
    }

    async function addWrapper() {
        if (!selectedNode || !currentSubtreeId) {
            showToast('Select a wrapper node!', 'warn');
            return;
        }
        const wrapperTypes = ['Sequence', 'Fallback', 'Selector'];
        if (
            !wrapperTypes.includes(selectedNode.data.type) ||
            !selectedNode.parent ||
            !wrapperTypes.concat(['BehaviorTree']).includes(selectedNode.parent.data.type)
        ) {
            showToast('Select a wrapper node with a wrapper parent!', 'warn');
            return;
        }

        const wrapperType = document.getElementById('new-wrapper-type').value;
        if (!wrapperType) {
            showToast('Select a wrapper type!', 'warn');
            return;
        }

        try {
            const res = await fetch(`${API_BASE}/addWrapper`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subtreeId: currentSubtreeId,
                    nodePath: selectedNode.data.path.slice(1), // 🔹 use _uid path
                    wrapperType
                })
            });
            if (!res.ok) throw new Error(await res.text());
            showToast('Wrapper added!');
            loadSubtree(currentSubtreeId);
        } catch (err) {
            console.error('Error adding wrapper:', err);
            showToast(`Failed: ${err.message}`, 'failure');
        }
    }

// ─────────────────────────────────────────────────────────────────
// ADD NODE AFTER  — drops a node immediately after the selected one
// ─────────────────────────────────────────────────────────────────

function openAddNodeAfterModal() {
    if (!selectedNode || !currentSubtreeId) {
        showToast('Select a node first!', 'warn');
        return;
    }
    if (selectedNode.data.type === 'BehaviorTree') {
        showToast('Cannot add after the root node', 'warn');
        return;
    }

    // Remove any stale instance
    const old = document.getElementById('add-after-modal');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'add-after-modal';
    overlay.style.cssText = `
        position:fixed;inset:0;background:rgba(0,0,0,.5);
        display:flex;align-items:center;justify-content:center;z-index:3000;
    `;

    overlay.innerHTML = `
        <div style="background:#fff;border-radius:12px;width:360px;max-height:80vh;
                    display:flex;flex-direction:column;box-shadow:0 8px 24px rgba(0,0,0,.2);
                    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            <div style="padding:14px 18px;background:#f5f5f7;border-radius:12px 12px 0 0;
                        border-bottom:1px solid #d2d2d7;display:flex;justify-content:space-between;align-items:center;">
                <b style="font-size:14px;color:#1d1d1f;" id="aan-title">Add Node After</b>
                <button id="aan-close" style="background:none;border:none;font-size:20px;cursor:pointer;color:#6e6e73;line-height:1;">&times;</button>
            </div>
            <div style="padding:12px 14px;display:flex;gap:8px;border-bottom:1px solid #ececee;">
                <select id="aan-cat" style="flex:1;padding:6px 8px;border:1px solid #d2d2d7;border-radius:8px;font-size:13px;">
                    <option value="">Select Category</option>
                </select>
                <select id="aan-type" style="flex:1;padding:6px 8px;border:1px solid #d2d2d7;border-radius:8px;font-size:13px;" disabled>
                    <option value="">Select Node Type</option>
                </select>
            </div>
            <div style="padding:14px;border-bottom:1px solid #ececee;">
                <input id="aan-name" type="text" placeholder="Node Name (auto-generated if blank)"
                    style="width:100%;padding:7px 10px;border:1px solid #d2d2d7;border-radius:8px;font-size:13px;box-sizing:border-box;">
            </div>
            <div style="padding:12px 14px;display:flex;justify-content:flex-end;gap:8px;">
                <button id="aan-cancel" style="padding:7px 16px;border:1px solid #d2d2d7;border-radius:8px;
                    background:#fff;cursor:pointer;font-size:13px;">Cancel</button>
                <button id="aan-confirm" disabled style="padding:7px 16px;border:none;border-radius:8px;
                    background:#007aff;color:#fff;cursor:pointer;font-size:13px;font-weight:600;">
                    Add After &#x279C;
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const catSel     = overlay.querySelector('#aan-cat');
    const typeSel    = overlay.querySelector('#aan-type');
    const nameInp    = overlay.querySelector('#aan-name');
    const confirmBtn = overlay.querySelector('#aan-confirm');
    const titleEl    = overlay.querySelector('#aan-title');

    if (selectedNode?.data?.name) {
        titleEl.textContent = `Add Node After "${selectedNode.data.name}"`;
    }

    const close = () => overlay.remove();
    overlay.querySelector('#aan-close').addEventListener('click', close);
    overlay.querySelector('#aan-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    // Populate categories from nodeDefinitions (same global as the Add Node panel)
    if (nodeDefinitions && availableCategories) {
        for (const catKey of availableCategories) {
            const catDef = nodeDefinitions[catKey];
            if (!catDef) continue;
            const opt = document.createElement('option');
            opt.value = catKey;
            opt.textContent = catDef.display_name || catKey;
            catSel.appendChild(opt);
        }
    }

    catSel.addEventListener('change', () => {
        typeSel.innerHTML = '<option value="">Select Node Type</option>';
        typeSel.disabled = true;
        confirmBtn.disabled = true;

        const catKey = catSel.value;
        if (!catKey || !nodeDefinitions[catKey]) return;

        const catDef = nodeDefinitions[catKey];
        for (const nodeTypeGroup in catDef.nodes) {
            for (const nodeName in catDef.nodes[nodeTypeGroup]) {
                const opt = document.createElement('option');
                opt.value = nodeName;
                opt.textContent = nodeName;
                typeSel.appendChild(opt);
            }
        }
        typeSel.disabled = false;
    });

    typeSel.addEventListener('change', () => {
        confirmBtn.disabled = !typeSel.value;
    });

    confirmBtn.addEventListener('click', async () => {
        const nodeType = typeSel.value;
        if (!nodeType) return;

        const now = new Date();
        const timePart = `${now.getHours()}${now.getMinutes()}${now.getSeconds()}`.slice(-6);
        const nodeName = nameInp.value.trim() || `${nodeType}_${timePart}`;

        // Pull default attributes from the catalog
        const catKey  = catSel.value;
        const typeGroups = nodeDefinitions[catKey]?.nodes || {};
        const groupKey = Object.keys(typeGroups).find(g => typeGroups[g]?.[nodeType]);
        const nodeDef  = groupKey ? typeGroups[groupKey][nodeType] : null;

        const attributes = {};
        if (nodeDef?.attributes) {
            for (const [k, v] of Object.entries(nodeDef.attributes)) {
                attributes[k] = v || '';
            }
        }

        try {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Adding…';

            const res = await fetch(`${API_BASE}/addNodeAfter`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subtreeId: currentSubtreeId,
                    // siblingPath = the _uid path of the currently selected node
                    siblingPath: selectedNode.data.path.slice(1),
                    nodeType,
                    nodeName,
                    attributes,
                }),
            });

            if (!res.ok) throw new Error(await res.text());

            close();
            showToast(`Added ${nodeType} after "${selectedNode.data.name}"`, 'success');
            await loadSubtree(currentSubtreeId);
        } catch (err) {
            console.error('addNodeAfter error:', err);
            showToast(`Failed: ${err.message}`, 'failure');
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Add After ➜';
        }
    });

    setTimeout(() => nameInp.focus(), 50);
}