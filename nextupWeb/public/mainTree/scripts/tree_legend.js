// Which node types show names by default
//tree_legend.js

let visibleLabelTypes = new Set(['Sequence', 'Fallback', 'BehaviorTree', 'SubTreePlus']);

let legendCollapsed = true;

let lastRenderedTreeData = null;

let treeSpacingX = 20; // horizontal (siblings)
let treeSpacingY = 90; // vertical (depth)

let lastTreeTransform = null;


function computeSubtreeSpan(node) {
    if (!node.children || node.children.length === 0) return 1;

    return node.children.reduce(
        (sum, child) => sum + computeSubtreeSpan(child),
        0
    );
}


const spacingXSlider = document.getElementById('spacing-x-slider');
const spacingYSlider = document.getElementById('spacing-y-slider');

if (spacingXSlider) {
    spacingXSlider.addEventListener('input', e => {
        treeSpacingX = Number(e.target.value);
        if (currentSubtreeId) loadSubtree(currentSubtreeId);
    });
}

if (spacingYSlider) {
    spacingYSlider.addEventListener('input', e => {
        treeSpacingY = Number(e.target.value);
        if (currentSubtreeId) loadSubtree(currentSubtreeId);
    });
}


function renderTree(data, containerId = 'tree-view') {
    try {
        lastRenderedTreeData = data;
        // Preserve current zoom & pan before re-render
        const oldSvg = d3.select(`#${containerId}`).select('svg');
        if (!oldSvg.empty()) {
            lastTreeTransform = d3.zoomTransform(oldSvg.node());
        }

        d3.select(`#${containerId}`).selectAll('svg').remove();
        const container = document.getElementById(containerId);
        const width = container.offsetWidth || 800;
        const height = Math.max(container.offsetHeight - 50, 100);

        const svg = d3.select(`#${containerId}`)
            .append('svg')
            .attr('width', width)
            .attr('height', height)
            .style('display', 'block');

        const g = svg.append('g');
        const zoom = d3.zoom().scaleExtent([0.5, 3]).on('zoom', (event) => {
            g.attr('transform', event.transform);
        });
        svg.call(zoom);

        // const root = d3.hierarchy(data);
        // const treeLayout = d3.tree().size([width + 200, height - 100]);
        // treeLayout(root);
        const root = d3.hierarchy(data);

        // ---------------- SPACING (MANUAL + SAFE) ----------------

        // D3 semantics:
        // x → siblings (horizontal)
        // y → depth (vertical)

        const MIN_X_SPACING = 6;   // safety, prevents total overlap
        const MIN_Y_SPACING = 20;

        const NODE_X_SPACING = Math.max(treeSpacingX, MIN_X_SPACING);
        const NODE_Y_SPACING = Math.max(treeSpacingY, MIN_Y_SPACING);

        const treeLayout = d3.tree()
            .nodeSize([NODE_X_SPACING, NODE_Y_SPACING]);

        treeLayout(root);

        // ---------------------------------------------------------

        // draw links
        g.selectAll('.link')
            .data(root.links())
            .enter()
            .append('path')
            .attr('class', 'link')
            .attr('d', d3.linkVertical().x(d => d.x).y(d => d.y));

        // draw nodes
        const node = g.selectAll('.node')
            .data(root.descendants())
            .enter()
            .append('g')
            .attr('class', 'node')
            .attr('transform', d => `translate(${d.x},${d.y})`)
            .call(d3.drag()
                .on('start', function (event, d) {
                    dragStartTime = Date.now();
                    d3.select(this).classed('dragging', true);
                })
                .on('drag', function (event, d) {
                    if (Date.now() - dragStartTime < 1000) return;
                    d3.select(this).attr('transform', `translate(${event.x},${event.y})`);
                    const target = findSwapTarget(event.x, event.y, d, root);
                    d3.selectAll('.node').classed('swap-target', false);
                    if (target && target !== d && target.parent === d.parent) {
                        d3.select(`#${containerId} .node`).filter(n => n === target).classed('swap-target', true);
                    }
                })
                .on('end', async function (event, d) {
                    d3.select(this).classed('dragging', false);
                    d3.selectAll('.node').classed('swap-target', false);

                    // 🧩 Ignore short clicks (not a drag)
                    if (Date.now() - dragStartTime < 200) return;

                    const target = findSwapTarget(event.x, event.y, d, root);

                    // 🧠 Same-parent check and valid drop
                    if (target && target !== d && target.parent === d.parent) {
                        try {
                            const res = await fetch(`${API_BASE}/moveNodeAfter`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    subtreeId: currentSubtreeId,
                                    sourcePath: d.data.path.slice(1),     // dragged node UID path
                                    targetPath: target.data.path.slice(1) // drop target UID path
                                })
                            });

                            if (!res.ok) throw new Error(await res.text());

                            showToast(`Moved "${d.data.name}" after "${target.data.name}"`, 'process');

                            // 🔹 Dragging never runs the click handler (short-click guard above
                            // skips it), so selectedNode/selectedNodeUid/selectedNodeId are never
                            // pointed at the dragged node. Anchor selection to the node that was
                            // just moved so renderTree()'s restore-selection logic re-selects it
                            // after the reload instead of falling back to stale/no selection.
                            selectedNode    = d;
                            selectedNodeUid = d.data.attributes?._uid || null;
                            selectedNodeId  = d.data.attributes?.ID || d.data.id || null;

                            await loadSubtree(currentSubtreeId);
                        } catch (err) {
                            console.error('Error moving node:', err);
                            showToast(`Failed to move node: ${err.message}`, 'failure');
                        }
                    } else {
                        showToast('Invalid drop location', 'warn');
                    }
                    d3.select(this).attr('transform', `translate(${d.x},${d.y})`);
                })

            );

        // click events (selection, wrapper toggles)
        if (containerId === 'tree-view') {
            node.on('click', function (_, d) {
                // 1️⃣ Remove any previous selection highlight
                d3.selectAll('.node circle')
                    .attr('stroke', null)
                    .attr('stroke-width', 1)
                    .attr('r', 10)
                    .style('filter', 'none');

                // Highlight selected node
                selectedNode = d;
                selectedNodeUid = d.data.attributes?._uid;
                selectedNodeId = d.data.attributes?.ID || d.data.id || null;


                const circle = d3.select(this).select('circle');

                circle
                    .attr('stroke', '#131313ff')
                    .attr('stroke-width', 2)
                    .transition().duration(150)
                    .attr('r', 14);

                // Optional: subtle glow using filter
                circle
                    .style('filter', 'drop-shadow(0 0 6px rgba(255, 40, 40, 0.9))');

                showNodeDetails(d.data);

                // 4️⃣ Update button enable/disable logic (existing)
                const wrapperTypes = [
                    'BehaviorTree', 'Sequence', 'Fallback', 'Selector', 'Parallel', 'WhileDoElse', 'Repeat'
                ];


                const isWrapper = wrapperTypes.includes(d.data.type) ||
                    (nodeDefinitions.custom && Object.values(nodeDefinitions.custom)
                        .flatMap(Object.keys)
                        .includes(d.data.type) &&
                        nodeDefinitions.custom?.[Object.keys(nodeDefinitions.custom)
                            .find(c => nodeDefinitions.custom[c][d.data.type])]
                            ?.[d.data.type]?.type === 'wrapper');

                const isNotRoot = d.data.type !== 'BehaviorTree';
                const parentIsWrapper = d.parent && (wrapperTypes.includes(d.parent.data.type) ||
                    (nodeDefinitions.custom && Object.values(nodeDefinitions.custom)
                        .flatMap(Object.keys)
                        .includes(d.parent.data.type) &&
                        nodeDefinitions.custom?.[Object.keys(nodeDefinitions.custom)
                            .find(c => nodeDefinitions.custom[c][d.parent.data.type])]
                            ?.[d.parent.data.type]?.type === 'wrapper'));

                document.getElementById('add-node-btn').disabled = !isWrapper;
                document.getElementById('delete-node-btn').disabled = !isNotRoot;

                document.getElementById('delete-wrapper-btn').disabled = !(isWrapper && parentIsWrapper);
                document.getElementById('add-wrapper-btn').disabled = !(isWrapper && parentIsWrapper);
                const addAfterBtn = document.getElementById('add-node-after-btn');
                if (addAfterBtn) addAfterBtn.disabled = !isNotRoot;
            })
                .on('mouseover', (_, d) => showHoverTooltip(d))
                .on('mouseout', hideHoverTooltip);

        }



        function getNodeColor(type) {
            if (TYPE_COLOR[type]) return TYPE_COLOR[type];

            // Check if it's a wrapper using the proper function
            const isWrapper = checkIsWrapper(type);
            return isWrapper ? TYPE_COLOR.__wrapper__ : TYPE_COLOR.__leaf__;
        }
        node.append('circle')
            .attr('r', 10)
            .attr('fill', d => getNodeColor(d.data.type));

        // Node labels (only for selected visible types)
        node.append('text')
            .attr('dy', -18)
            .attr('text-anchor', 'middle')
            .style('font-size', '10px')
            .style('fill', '#333')
            .text(d => visibleLabelTypes.has(d.data.type) ? (d.data.name || d.data.type) : '');



        // Restore previous zoom & pan if available
        if (lastTreeTransform) {
            svg.call(zoom.transform, lastTreeTransform);
        } else {
            // First render only
            const initialTransform = d3.zoomIdentity
                .translate(width / 2 - root.x, 50)
                .scale(1);

            svg.call(zoom.transform, initialTransform);
        }

        // 🔁 Restore selection after re-render
        // The backend may regenerate a node's _uid on write (e.g. after move/update),
        // so _uid alone isn't reliable across reloads. Fall back to the node's stable
        // XML ID (which the backend does not change on move/update) before giving up.
        // Restricted to the main tree-view: selectedNode/selectedNodeUid and the sidebar
        // belong to the editor, not to whatever subtree happens to be open in the preview modal.
        if (containerId === 'tree-view' && (selectedNodeUid || selectedNodeId)) {
            let matchedNode = null;

            g.selectAll('.node').each(function (d) {
                if (matchedNode) return; // already found, skip rest
                const uid = d.data.attributes?._uid;
                const id = d.data.attributes?.ID || d.data.id;
                if (selectedNodeUid && uid === selectedNodeUid) {
                    matchedNode = { el: this, d };
                } else if (!matchedNode && selectedNodeId && id === selectedNodeId) {
                    matchedNode = { el: this, d };
                }
            });

            if (matchedNode) {
                selectedNode = matchedNode.d;
                // Re-adopt whatever identifiers the fresh data actually has,
                // so the NEXT move/update always sends a path the backend recognizes.
                selectedNodeUid = matchedNode.d.data.attributes?._uid || null;
                selectedNodeId = matchedNode.d.data.attributes?.ID || matchedNode.d.data.id || null;

                const circle = d3.select(matchedNode.el).select('circle');
                circle
                    .attr('stroke', '#131313ff')
                    .attr('stroke-width', 2)
                    .attr('r', 14)
                    .style('filter', 'drop-shadow(0 0 6px rgba(255, 40, 40, 0.9))');

                // Keep the sidebar (Edit Node fields + submit handler closure)
                // in sync with the freshly loaded node, not whatever was shown
                // before this reload.
                if (typeof showNodeDetails === 'function') {
                    showNodeDetails(matchedNode.d.data);
                }
            } else {
                // Node genuinely no longer exists (e.g. it was deleted) — only then clear.
                selectedNode = null;
                selectedNodeUid = null;
                selectedNodeId = null;
                const editSection = document.getElementById('edit-section');
                const nodeInfo = document.getElementById('node-info');
                if (editSection) editSection.style.display = 'none';
                if (nodeInfo) nodeInfo.innerHTML = 'Select a node to view details';
                ['add-node-btn', 'delete-node-btn', 'delete-wrapper-btn', 'add-wrapper-btn', 'add-node-after-btn']
                    .forEach(id => {
                        const btn = document.getElementById(id);
                        if (btn) btn.disabled = true;
                    });
            }
        }


        if (lastSearchQuery) applySearchHighlight();
    } catch (err) {
        console.error(`Error rendering tree in ${containerId}:`, err);
        throw err;
    }
}


let rightCtrlPressed = false;

document.addEventListener('keydown', (e) => {
    if (e.code === 'ControlRight') {
        rightCtrlPressed = true;
    }
});

document.addEventListener('keyup', (e) => {
    if (e.code === 'ControlRight') {
        rightCtrlPressed = false;
    }
});

document.addEventListener('keydown', async (e) => {
    if (!rightCtrlPressed) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (!selectedNode || !selectedNode.parent) return;

    e.preventDefault();

    const nodeUid = selectedNode.data.attributes?._uid;
    const nodeId = selectedNode.data.attributes?.ID || selectedNode.data.id || null;

    const siblings = selectedNode.parent.children;

    // ✅ FIX: use UID-based lookup instead of reference equality
    const currentUid = selectedNode.data.attributes?._uid;
    const index = siblings.findIndex(s => (s.data.attributes?._uid) === currentUid);

    if (index === -1) return;

    let targetIndex;

    if (e.key === 'ArrowRight') {
        if (index === siblings.length - 1) {
            showToast('Already last node', 'warn');
            return;
        }
        targetIndex = index + 1;
    } else {
        if (index === 0) {
            showToast('Already first node', 'warn');
            return;
        }
        targetIndex = index - 2;
        if (targetIndex < 0) {
            targetIndex = null;
        }
    }

    const sourcePath = selectedNode.data.path.slice(1);
    let targetPath;
    if (targetIndex === null) {
        targetPath = null;
    } else {
        targetPath = siblings[targetIndex].data.path.slice(1);
    }

    try {
        const res = await fetch(`${API_BASE}/moveNodeAfter`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subtreeId: currentSubtreeId,
                sourcePath,
                targetPath
            })
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(errorText);
        }

        showToast(
            `Moved "${selectedNode.data.name}" ${e.key === 'ArrowLeft' ? 'left' : 'right'}`,
            'process'
        );

        selectedNodeUid = nodeUid;   // preserve across re-render (may go stale if backend regenerates _uid)
        selectedNodeId = nodeId;     // stable fallback — backend does not change ID on move
        await loadSubtree(currentSubtreeId);

    } catch (err) {
        console.error(err);
        showToast(`Move failed: ${err.message}`, 'failure');
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// SELECTION NAVIGATION  —  Shift + Arrow keys
//
//  Shift + ArrowLeft   → previous sibling
//  Shift + ArrowRight  → next sibling
//  Shift + ArrowUp     → parent node
//  Shift + ArrowDown   → first child
//
// Deliberately uses ONLY Shift (no Ctrl/Alt/Meta) to distinguish it from
// the Right-Ctrl + Arrow "move node" shortcut above.
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
    if (!e.shiftKey) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;                        // let Ctrl+Shift / Alt+Shift pass
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
    if (['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (!selectedNode) return;

    e.preventDefault();

    let target = null;

    if (e.key === 'ArrowUp') {
        // Go to parent (stop at BehaviorTree root)
        if (selectedNode.parent && selectedNode.parent.data.type !== 'BehaviorTree') {
            target = selectedNode.parent;
        } else if (selectedNode.parent) {
            showToast('Already at root', 'warn');
        }

    } else if (e.key === 'ArrowDown') {
        // Go to first child
        const kids = selectedNode.children;
        if (kids && kids.length > 0) {
            target = kids[0];
        } else {
            showToast('No children', 'warn');
        }

    } else {
        // Left / Right within siblings
        if (!selectedNode.parent) return;
        const siblings  = selectedNode.parent.children || [];
        const currentUid = selectedNode.data.attributes?._uid;
        const idx = siblings.findIndex(s => s.data.attributes?._uid === currentUid);
        if (idx === -1) return;

        if (e.key === 'ArrowLeft') {
            if (idx === 0) { showToast('Already first sibling', 'warn'); return; }
            target = siblings[idx - 1];
        } else {
            if (idx === siblings.length - 1) { showToast('Already last sibling', 'warn'); return; }
            target = siblings[idx + 1];
        }
    }

    if (!target) return;

    // Simulate a click on the target D3 node to trigger the full selection flow
    // (highlights circle, updates sidebar, enables buttons).
    // We dispatch a synthetic click on the matching SVG <circle> element.
    const targetUid = target.data.attributes?._uid;
    let found = false;
    d3.selectAll('#tree-view .node').each(function(d) {
        if (found) return;
        if (d.data.attributes?._uid === targetUid) {
            found = true;
            // Trigger click on the group element — tree_legend's click handler is on the group
            this.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE key shortcut — triggers deleteNode() (which shows the confirm modal).
// Enter = confirm, Esc = cancel (handled in showConfirm in show_toast.js).
// Ignored while typing in inputs.
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Delete') return;
    if (['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    if (!selectedNode || selectedNode.data.type === 'BehaviorTree') return;
    // deleteNode is defined in node_editor.js (same scope via shared globals)
    if (typeof deleteNode === 'function') deleteNode();
});

function renderColorLegend() {
    const legendContainer = document.getElementById('tree-legend');
    legendContainer.innerHTML = `
    <div id="legend-header" style="display:flex; align-items:center; justify-content:space-between; cursor:pointer; user-select:none;">
      <b style="font-size:12px;">Node Types</b>
      <i id="legend-toggle-icon" class="fa fa-chevron-up" style="font-size:12px; color:#333;"></i>
    </div>
    <div id="legend-body" style="margin-top:8px;"></div>
  `;

    const header = legendContainer.querySelector('#legend-header');
    const body = legendContainer.querySelector('#legend-body');
    const toggleIcon = legendContainer.querySelector('#legend-toggle-icon');

    header.onclick = () => {
        legendCollapsed = !legendCollapsed;
        body.style.maxHeight = legendCollapsed ? '0' : '600px';
        body.style.opacity = legendCollapsed ? '0' : '1';
        toggleIcon.classList.toggle('fa-chevron-down', legendCollapsed);
        toggleIcon.classList.toggle('fa-chevron-up', !legendCollapsed);
    };

    // ✅ Apply initial collapsed state
    body.style.transition = 'max-height 0.3s ease, opacity 0.3s ease';
    body.style.overflow = 'hidden';
    body.style.maxHeight = legendCollapsed ? '0' : '600px';
    body.style.opacity = legendCollapsed ? '0' : '1';
    toggleIcon.classList.toggle('fa-chevron-down', legendCollapsed);
    toggleIcon.classList.toggle('fa-chevron-up', !legendCollapsed);

    if (!nodeDefinitions || !nodeDefinitions.default) {
        body.innerHTML = '<p style="font-size:12px; color:#999;">No node types loaded</p>';
        return;
    }

    // 🔹 Helper to build group sections
    const makeGroup = (title, nodes, colorType) => {
        if (!nodes || Object.keys(nodes).length === 0) return;
        const groupDiv = document.createElement('div');
        groupDiv.className = 'legend-category';
        groupDiv.innerHTML = `<b style="font-size:11px; color:#555;">${title}</b>`;
        body.appendChild(groupDiv);

        Object.entries(nodes).forEach(([name, def]) => {
            const color = TYPE_COLOR[name] || TYPE_COLOR[colorType] || '#000';
            const isVisible = visibleLabelTypes.has(name);
            const iconClass = isVisible ? 'fa-eye' : 'fa-eye-slash';
            const iconColor = isVisible ? '#007aff' : '#999';

            const itemDiv = document.createElement('div');
            itemDiv.className = 'legend-item';
            itemDiv.innerHTML = `
        <div class="legend-color" style="background:${color};"></div>
        <span style="flex:1;">${name}</span>
        <i class="fa ${iconClass}"
           style="cursor:pointer; color:${iconColor}; font-size:13px;"
           title="${isVisible ? 'Hide labels' : 'Show labels'}"
           onclick="toggleLabelVisibility('${name}', this)">
        </i>
      `;
            groupDiv.appendChild(itemDiv);

            // Track types globally for group toggles
            if (def.type === 'wrapper') {
                if (!window.customWrappers) window.customWrappers = [];
                window.customWrappers.push(name);
            } else if (def.type === 'leaf') {
                if (!window.customLeafs) window.customLeafs = [];
                window.customLeafs.push(name);
            }
        });
    };

    // 🔹 1. Default Control
    makeGroup('Control', nodeDefinitions.default?.Control, 'Sequence');

    // 🔹 2. Default Decorators
    makeGroup('Decorator', nodeDefinitions.default?.Decorator, 'WhileDoElse');

    // 🔹 3. Default Actions
    makeGroup('Action', nodeDefinitions.default?.Action, 'Action');

    // 🔹 4. Custom Wrappers
    const customWrappers = {};
    const customLeafs = {};
    for (const [cat, defs] of Object.entries(nodeDefinitions.custom || {})) {
        for (const [name, def] of Object.entries(defs)) {
            if (def.type === 'wrapper') customWrappers[name] = def;
            else if (def.type === 'leaf') customLeafs[name] = def;
        }
    }

    makeGroup('Custom Wrapper', customWrappers, '__wrapper__');
    makeGroup('Custom Leaf', customLeafs, '__leaf__');

    // 🔹 Quick Toggles
    const globalDiv = document.createElement('div');
    globalDiv.className = 'legend-category';
    globalDiv.style.marginTop = '12px';
    globalDiv.innerHTML = `<b style="font-size:11px; color:#555;">Quick Toggles</b>`;
    globalDiv.innerHTML += `
    <div class="legend-item">
      <div class="legend-color" style="background:${TYPE_COLOR.__wrapper__};"></div>
      <span style="flex:1;">All Wrappers</span>
      <i class="fa fa-eye" style="cursor:pointer; color:#007aff;"
         onclick="toggleGroupVisibility('wrapper', this)"></i>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background:${TYPE_COLOR.__leaf__};"></div>
      <span style="flex:1;">All Leafs</span>
      <i class="fa fa-eye" style="cursor:pointer; color:#007aff;"
         onclick="toggleGroupVisibility('leaf', this)"></i>
    </div>
  `;
    body.appendChild(globalDiv);
}

function toggleLabelVisibility(type, iconElement) {
    if (visibleLabelTypes.has(type)) {
        visibleLabelTypes.delete(type);
        iconElement.classList.replace('fa-eye', 'fa-eye-slash');
        iconElement.style.color = '#999';
        iconElement.title = 'Show labels';
    } else {
        visibleLabelTypes.add(type);
        iconElement.classList.replace('fa-eye-slash', 'fa-eye');
        iconElement.style.color = '#007aff';
        iconElement.title = 'Hide labels';
    }

    // ✅ Re-render the current tree with updated label visibility
    if (lastRenderedTreeData) {
        renderTree(lastRenderedTreeData);
    }
}

function toggleGroupVisibility(groupType, iconElement) {
    const isCurrentlyVisible = iconElement.classList.contains('fa-eye');
    const groupList = groupType === 'wrapper' ? window.customWrappers || [] : window.customLeafs || [];

    if (isCurrentlyVisible) {
        // hide group
        groupList.forEach(t => visibleLabelTypes.delete(t));
        iconElement.classList.replace('fa-eye', 'fa-eye-slash');
        iconElement.style.color = '#999';
    } else {
        // show group
        groupList.forEach(t => visibleLabelTypes.add(t));
        iconElement.classList.replace('fa-eye-slash', 'fa-eye');
        iconElement.style.color = '#007aff';
    }

    if (lastRenderedTreeData) renderTree(lastRenderedTreeData);
}

window.addEventListener("load", () => {
    setTimeout(() => {
        renderColorLegend();
    }, 400);
});