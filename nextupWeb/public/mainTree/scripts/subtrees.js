//subtree.js

let currentSubtreeId = null;
let currentPreviewSubtreeId = null;
let subtrees = [];
let isLoadingSubtree = false;


/* -------------------------------------------------
   Load normal subtrees (templates.xml)
   ------------------------------------------------- */
async function loadSubtrees() {
    try {
        const res = await fetch(`${API_BASE}/getSubtrees`);
        if (!res.ok) throw new Error('Failed to load subtrees');

        const data = await res.json();

        if (Array.isArray(data)) {
            subtrees = data;
        } else if (data.subtrees && Array.isArray(data.subtrees)) {
            subtrees = data.subtrees;
            if (data.message) console.warn(data.message);
        } else {
            subtrees = [];
            console.warn('No subtrees found in response');
        }

        if (subtrees.length === 0) {
            const templateList = document.getElementById('template-list');
            templateList.innerHTML =
                '<p style="color: #888; text-align:center; padding:6px;">No subtrees found</p>';
            return;
        }

        renderSubtrees();
        console.log('Subtrees loaded from XML');
    } catch (err) {
        console.error('Error loading subtrees:', err);
        showToast('Failed to load subtrees', 'failure');
    }
}

function renderSubtrees() {
    const templateList = document.getElementById('template-list');
    templateList.innerHTML = '';
    subtrees.forEach(subtree => {
        if (subtree.id === 'main_tree') {
            console.log('main tree found — not rendered in subtrees section');
            return; // skip rendering this one
        }

        const div = document.createElement('div');
        div.className = 'template-item';
        div.innerHTML = `
            <span onclick="loadSubtree('${subtree.id}')" style="cursor: pointer; flex: 1;">${subtree.id}</span>
            <i class="fas fa-plus-circle"
                title="Add as Child"
                onclick="openTemplateModal('${subtree.id}')"></i>

            <i class="fas fa-eye" title="Preview" onclick="previewSubtree('${subtree.id}')"></i>
            <i class="fas fa-trash" title="Delete" onclick="deleteSubtree('${subtree.id}')"></i>
        `;
        templateList.appendChild(div);
    });
}


let templateSelectedChild = null;

function openTemplateModal(childSubtreeId) {
    if (!selectedNode) {
        showToast('Select a parent node first!', 'warn');
        return;
    }

    if (!checkIsWrapper(selectedNode.data.type)) {
        showToast('Subtrees can only be added under wrapper nodes!', 'warn');
        return;
    }

    templateSelectedChild = childSubtreeId;
    document.getElementById('template-subtree-name').textContent =
        `Subtree: ${childSubtreeId}`;

    document.getElementById('template-modal').style.display = 'flex';
}

function closeTemplateModal() {
    document.getElementById('template-modal').style.display = 'none';
    templateSelectedChild = null;
}

document.getElementById('template-cancel-btn')
    .onclick = closeTemplateModal;

document.getElementById('template-full-btn')
    .onclick = () => handleTemplateAdd('full');

document.getElementById('template-ref-btn')
    .onclick = () => handleTemplateAdd('reference');

async function handleTemplateAdd(mode) {
    if (!templateSelectedChild || !selectedNode || !currentSubtreeId) {
        closeTemplateModal();
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/addSubtreeAsChild`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subtreeId: currentSubtreeId,
                parentPath: selectedNode.data.path.slice(1),
                childSubtreeId: templateSelectedChild,
                mode
            })
        });

        if (!res.ok) throw new Error(await res.text());

        showToast(
            mode === 'reference'
                ? 'Subtree added as <SubTreePlus>'
                : 'Subtree added as full copy'
        );

        loadSubtree(currentSubtreeId);
    } catch (err) {
        console.error(err);
        showToast(err.message, 'failure');
    } finally {
        closeTemplateModal();
    }
}


/* -------------------------------------------------
   Load RunPath subtrees
   ------------------------------------------------- */
let runPathSubtrees = [];

document.getElementById('runpath-ref-btn').addEventListener('click', () => {
    document.getElementById('runpath-extra-attrs').style.display = 'block';
});

document.getElementById('runpath-full-btn').addEventListener('click', () => {
    document.getElementById('runpath-extra-attrs').style.display = 'none';
});


async function loadRunPathSubtrees() {
    try {
        const res = await fetch(`${API_BASE}/getRunPathSubtrees`);
        if (!res.ok) throw new Error('Failed to load Run Path subtrees');
        runPathSubtrees = await res.json();
        renderRunPathSubtrees();
    } catch (err) {
        console.error('Error loading Run Path subtrees:', err);
        document.getElementById('runpath-subtree-list').innerHTML =
            '<p style="color:#ff3b30; font-size:12px; padding:8px;">Failed to load Run Path subtrees</p>';
    }
}

function renderRunPathSubtrees() {
    const list = document.getElementById('runpath-subtree-list');
    list.innerHTML = '';

    if (!Array.isArray(runPathSubtrees) || runPathSubtrees.length === 0) {
        list.innerHTML = '<p style="color:#8e8e93; font-size:12px; padding:8px; text-align:center;">No Run Path subtrees found</p>';
        return;
    }

    runPathSubtrees.forEach(subtree => {
        const div = document.createElement('div');
        div.className = 'template-item';
        div.innerHTML = `
      <span style="cursor: default;">${subtree.id}</span>
      <i class="fas fa-plus-circle" title="Add as Child" onclick="openRunPathModal('${subtree.id}')"></i>
      <i class="fas fa-eye" title="Preview" onclick="previewRunPathSubtree('${subtree.id}')"></i>
      <i class="fas fa-trash" title="Delete" style="visibility:hidden;"></i>
    `;
        list.appendChild(div);
    });
}

/* -------------------------------------------------
   Preview RunPath Subtree
   ------------------------------------------------- */
async function previewRunPathSubtree(subtreeId) {
    try {
        currentPreviewSubtreeId = subtreeId;
        document.getElementById('preview-subtree-name').textContent = `Preview: ${subtreeId} (Run Path)`;
        document.getElementById('preview-modal').style.display = 'flex';
        d3.select('#preview-tree-view').selectAll('svg').remove();

        const res = await fetch(`${API_BASE}/getRunPathSubtree/${subtreeId}`);
        if (!res.ok) throw new Error('Failed to load Run Path subtree');
        const data = await res.json();

        const subtree = data.root['@children'].find(c => c.tagName === 'BehaviorTree');
        const treeData = convertToTree(
            subtree.content,
            subtree.content['@attributes'].ID,
            [subtree.content['@attributes']._uid || subtree.content['@attributes'].ID],
            subtree.tagName
        );

        requestAnimationFrame(() => renderTree(treeData, 'preview-tree-view'));
    } catch (err) {
        console.error('Preview RunPath error:', err);
        showToast(`Failed to preview RunPath: ${err.message}`, 'failure');
    }
}

/* -------------------------------------------------
   Run Path Modal (modern UI)
   ------------------------------------------------- */
let runPathSelectedChild = null;

function openRunPathModal(childSubtreeId) {

    if (!selectedNode) {
        showToast('Select a parent node first!', 'warn');
        return;
    }

    if (!checkIsWrapper(selectedNode.data.type)) {
        showToast('DO/DI subtrees can only be added under wrapper nodes!', 'warn');
        return;
    }

    runPathSelectedChild = childSubtreeId;
    const modal = document.getElementById('runpath-modal');
    modal.style.display = 'flex';
    document.getElementById('runpath-subtree-name').textContent = `Subtree: ${childSubtreeId}`;
}

function closeRunPathModal() {
    const modal = document.getElementById('runpath-modal');
    modal.style.display = 'none';
    runPathSelectedChild = null;
}

document.getElementById('runpath-cancel-btn').onclick = closeRunPathModal;

document.getElementById('runpath-full-btn').onclick = async () => {
    await handleRunPathAdd('full');
};

document.getElementById('runpath-ref-btn').onclick = async () => {
    await handleRunPathAdd('reference');
};

async function handleRunPathAdd(mode) {
    if (!runPathSelectedChild || !selectedNode || !currentSubtreeId) {
        showToast('Select a valid parent node!', 'warn');
        closeRunPathModal();
        return;
    }

    let attributes = {};

    if (mode === 'reference') {
        const speedInput = document.getElementById('runpath-speed-input');
        let speed = parseFloat(speedInput.value);

        if (isNaN(speed) || speed < 0.10 || speed > 2.00) {
            showToast('desired_speed must be between 0.10 and 2.00', 'warn');
            return;
        }

        attributes.desired_speed = speed.toFixed(2);
    }

    try {
        const res = await fetch(`${API_BASE}/addRunPathSubtreeAsChild`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subtreeId: currentSubtreeId,
                parentPath: selectedNode.data.path.slice(1),
                childSubtreeId: runPathSelectedChild,
                mode,
                attributes
            })
        });

        if (!res.ok) throw new Error(await res.text());

        showToast(
            mode === 'reference'
                ? 'Run Path added as <SubTreePlus> with desired_speed'
                : 'Run Path added as full copy'
        );

        loadSubtree(currentSubtreeId);
    } catch (err) {
        console.error(err);
        showToast(err.message, 'failure');
    } finally {
        closeRunPathModal();
    }
}


// Optional: click outside to close
window.addEventListener('click', e => {
    if (e.target === document.getElementById('runpath-modal')) closeRunPathModal();
});


/* -------------------------------------------------
   Load a single subtree (normal or DO/DI)
   ------------------------------------------------- */
async function loadSubtree(subtreeId) {
    if (isLoadingSubtree) return;
    isLoadingSubtree = true;

    const loadingIndicator = document.createElement('div');
    loadingIndicator.textContent = 'Loading...';
    loadingIndicator.style.position = 'absolute';
    loadingIndicator.style.top = '50%';
    loadingIndicator.style.left = '50%';
    loadingIndicator.style.transform = 'translate(-50%, -50%)';
    document.getElementById('tree-view').appendChild(loadingIndicator);

    try {
        const res = await fetch(`${API_BASE}/getSubtree/${subtreeId}`);
        if (!res.ok) throw new Error('Failed to load subtree');
        const data = await res.json();

        currentSubtreeId = subtreeId;
        document.getElementById('current-subtree-name').textContent = subtreeId;

        const subtree = data.root['@children'].find(c => c.tagName === 'BehaviorTree');
        const treeData = convertToTree(
            subtree.content,
            subtree.content['@attributes'].ID,
            [subtree.content['@attributes']._uid || subtree.content['@attributes'].ID],
            subtree.tagName
        );
        renderTree(treeData);
        // Selection restore (by _uid, falling back to stable ID) now happens
        // inside renderTree() itself, including button-state + highlight repaint,
        // so no separate resync is needed here.
        highlightFailedNodes(failedNodeName, failedTraceNodes);

    } catch (err) {
        showToast(`Failed to load subtree: ${err.message}`, 'failure');
    } finally {
        isLoadingSubtree = false;
        loadingIndicator.remove();
    }
}


/* -------------------------------------------------
   CRUD: Add Subtree (no change)
   ------------------------------------------------- */
   async function addSubtree() {
    const name = document.getElementById('new-subtree-name').value.trim();
    if (!name) {
        showToast('Please provide a subtree name!', 'warn');
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/addSubtree`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        if (!res.ok) throw new Error(await res.text());
        showToast('Subtree added!');
        await loadSubtrees();
        loadSubtree(name);
        document.getElementById("new-subtree-name").value = "";

    } catch (err) {
        console.error('Error adding subtree:', err);
        showToast(`Failed to add subtree: ${err.message}`, 'failure');
    }
}
/* -------------------------------------------------
   DELETE SUBTREE (no _uid needed; based on name)
   ------------------------------------------------- */
async function deleteSubtree(subtreeId) {
    if (!(await showConfirm(`Delete subtree "${subtreeId}"?`))) return;
    try {
        const res = await fetch(`${API_BASE}/deleteSubtree`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subtreeId })
        });
        if (!res.ok) throw new Error(await res.text());
        showToast('Subtree deleted!');

        if (currentSubtreeId === subtreeId) {
            currentSubtreeId = null;
            selectedNode = null;
            d3.select('#tree-view').selectAll('svg').remove();
            document.getElementById('edit-section').style.display = 'none';
            document.getElementById('node-info').innerHTML = 'Select a node to view details';
            ['add-node-btn', 'delete-node-btn', 'delete-wrapper-btn', 'add-wrapper-btn']
                .forEach(id => document.getElementById(id).disabled = true);
            document.getElementById('current-subtree-name').textContent = 'No Subtree Selected';
        }
        if (currentPreviewSubtreeId === subtreeId) closePreviewModal();
        await loadSubtrees();
    } catch (err) {
        console.error('Error deleting subtree:', err);
        showToast(`Failed: ${err.message}`, 'failure');
    }
}

/* -------------------------------------------------
   ADD SUBTREE (normal or DO/DI) AS CHILD
   ------------------------------------------------- */
async function addSubtreeAsChild(childSubtreeId, isDoDi = false) {
    if (!selectedNode || !currentSubtreeId) return showToast('Select a node first!', 'warn');

    if (!['BehaviorTree', 'Sequence', 'Fallback', 'Selector', 'Parallel'].includes(selectedNode.data.type))
        return showToast('Subtrees can only be added under wrapper nodes!', 'warn');

    if (!isDoDi && currentSubtreeId === childSubtreeId)
        return showToast('Cannot add a subtree to itself!', 'warn');

    let mode = 'full';
    if (isDoDi) {
        const confirmResult = await showConfirm(
            `Add DO/DI subtree "${childSubtreeId}" as:\n\n` +
            'OK → <SubTreePlus> reference\nCancel → Full copy'
        );
        mode = confirmResult ? 'reference' : 'full';
    }


    try {
        const endpoint = isDoDi
            ? `${API_BASE}/addDoDiSubtreeAsChild`
            : `${API_BASE}/addSubtreeAsChild`;

        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subtreeId: currentSubtreeId,
                parentPath: selectedNode.data.path.slice(1),
                childSubtreeId,
                mode
            })
        });

        if (!res.ok) throw new Error(await res.text());
        showToast(`Subtree added as ${mode === 'reference' ? '<SubTreePlus>' : 'full copy'}!`);
        loadSubtree(currentSubtreeId);
    } catch (err) {
        console.error('Error adding child subtree:', err);
        showToast(`Failed: ${err.message}`, 'failure');
    }
}


/* -------------------------------------------------
   PREVIEW (normal or DO/DI) – includes _uid path handling
   ------------------------------------------------- */
async function previewSubtree(subtreeId, isDoDi = false) {
    try {
        currentPreviewSubtreeId = subtreeId;
        document.getElementById('preview-subtree-name').textContent =
            `Preview: ${subtreeId}${isDoDi ? ' (DO/DI)' : ''}`;
        document.getElementById('preview-modal').style.display = 'flex';
        d3.select('#preview-tree-view').selectAll('svg').remove();

        const endpoint = isDoDi
            ? `${API_BASE}/getDoDiSubtree/${subtreeId}`
            : `${API_BASE}/getSubtree/${subtreeId}`;
        const res = await fetch(endpoint);
        if (!res.ok) throw new Error('Failed to load subtree');
        const data = await res.json();

        const subtree = data.root['@children'].find(c => c.tagName === 'BehaviorTree');

        const treeData = convertToTree(
            subtree.content,
            subtree.content['@attributes'].name || subtree.content['@attributes'].ID,
            [subtree.content['@attributes']._uid || subtree.content['@attributes'].ID],
            subtree.tagName
        );

        requestAnimationFrame(() => {
            try {
                renderTree(treeData, 'preview-tree-view');
            } catch (err) {
                console.error('Render error:', err);
                showToast(`Render error: ${err.message}`, 'failure');
            }
        });
    } catch (err) {
        console.error('Preview error:', err);
        showToast(`Failed to preview: ${err.message}`, 'failure');
    }
}
function closePreviewModal() {
    document.getElementById('preview-modal').style.display = 'none';
    d3.select('#preview-tree-view').selectAll('svg').remove();
    currentPreviewSubtreeId = null;
}

window.addEventListener('click', e => {
    if (e.target === document.getElementById('preview-modal')) closePreviewModal();
});

function reloadRunPathSubtrees() {
    loadRunPathSubtrees();
    showToast('loaded RunPath Subtrees');

}
function reloadSubtrees() {
    loadSubtrees();
    showToast('loaded templates Subtrees');

}

const reloadAllTrees = document.getElementById('reload-all-trees');
reloadAllTrees.addEventListener("click", async () => {
    reloadRunPathSubtrees();
    reloadSubtrees();
    reloadDoDiSubtrees();
    loadPointsList()      // <-- reload points list

    await new Promise(resolve => setTimeout(resolve, 1000));

    loadSubtree("main_tree");
})

window.addEventListener("load", () => {
    loadDoDiSubtrees();
    loadSubtrees();
    loadRunPathSubtrees();
});