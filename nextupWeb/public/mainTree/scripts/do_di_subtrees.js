// do_di_subtree.js

let doDiSubtrees = [];

/* -------------------------------------------------
   Load DO/DI subtrees
   ------------------------------------------------- */
async function loadDoDiSubtrees(force=false) {
  try {
    const url = force? `${API_BASE}/getDoDiSubtrees?force_xml2js_parse=true` : `${API_BASE}/getDoDiSubtrees`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load DO/DI subtrees');
    doDiSubtrees = await res.json();
    renderDoDiSubtrees();
  } catch (err) {
    console.error('Error loading DO/DI subtrees:', err);
    document.getElementById('dodi-subtree-list').innerHTML =
      '<p style="color: #ff3b30; font-size: 12px; padding: 8px;">Failed to load DO/DI subtrees</p>';
  }
}
function reloadDoDiSubtrees() {
  // forceParseDoDiXml()
  setTimeout(() => {
    loadDoDiSubtrees(true);
  }, 100);
  showToast('loaded DoDi Subtrees');
}

function renderDoDiSubtrees() {
  const list = document.getElementById('dodi-subtree-list');
  list.innerHTML = '';
  if (doDiSubtrees.length === 0) {
    list.innerHTML = '<p style="color: #8e8e93; font-size: 12px; padding: 8px; text-align: center;">No DO/DI subtrees found</p>';
    return;
  }

  doDiSubtrees.forEach(subtree => {
    const div = document.createElement('div');
    div.className = 'template-item';
    div.innerHTML = `
      <span style="cursor: default;">${subtree.id}</span>
      <i class="fas fa-plus-circle" title="Add as Child" onclick="openDoDiModal('${subtree.id}')"></i>
      <i class="fas fa-eye" title="Preview" onclick="previewSubtree('${subtree.id}', true)"></i>
      <i class="fas fa-trash" title="Delete" style="visibility: hidden;"></i>
    `;
    list.appendChild(div);

  });
}

/* -------------------------------------------------
   DO/DI Add Subtree Modal
   ------------------------------------------------- */
let dodiSelectedChild = null;

function openDoDiModal(childSubtreeId) {

  if (!selectedNode) {
    showToast('Select a parent node first!', 'warn');
    return;
  }

  if (!checkIsWrapper(selectedNode.data.type)) {
    showToast('DO/DI subtrees can only be added under wrapper nodes!', 'warn');
    return;
  }

  dodiSelectedChild = childSubtreeId;
  const modal = document.getElementById('dodi-modal');
  modal.style.display = 'flex';
  document.getElementById('dodi-subtree-name').textContent = `Subtree: ${childSubtreeId}`;

  // Reset defaults
  document.querySelector('input[name="dodi-mode"][value="full"]').checked = true;
  document.getElementById('dodi-extra-attrs').style.display = 'none';
}

function closeDoDiModal() {
  document.getElementById('dodi-modal').style.display = 'none';
  dodiSelectedChild = null;
}

// When mode changes, show/hide attribute section
document.querySelectorAll('input[name="dodi-mode"]').forEach(radio => {
  radio.addEventListener('change', e => {
    const extra = document.getElementById('dodi-extra-attrs');
    if (e.target.value === 'reference') {
      // Detect DO vs DI automatically
      const attrLabel = document.getElementById('dodi-attr-label');
      const isDO = dodiSelectedChild.toLowerCase().includes('grip') || dodiSelectedChild.toLowerCase().includes('do');
      console.log(dodiSelectedChild);
      
      console.log(isDO);
      
      attrLabel.textContent = isDO ? 'expected_action:' : 'expected_status:';
      extra.style.display = 'block';
    } else {
      extra.style.display = 'none';
    }
  });
});

// Confirm button
document.getElementById('dodi-confirm-btn').addEventListener('click', async () => {
  if (!dodiSelectedChild || !selectedNode || !currentSubtreeId) {
    closeDoDiModal();
    return;
  }

  const mode = document.querySelector('input[name="dodi-mode"]:checked').value;
  const isReference = mode === 'reference';
  const isDO = dodiSelectedChild.toLowerCase().includes('grip') || dodiSelectedChild.toLowerCase().includes('do');
  const attributeName = isDO ? 'expected_action' : 'expected_status';
  const attributeValue = document.querySelector('input[name="dodi-value"]:checked').value;

  console.log(isReference);

  try {
    const res = await fetch(`${API_BASE}/addDoDiSubtreeAsChild`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subtreeId: currentSubtreeId,
        parentPath: selectedNode.data.path.slice(1),
        childSubtreeId: dodiSelectedChild,
        mode,
        attributes: isReference ? { [attributeName]: attributeValue } : {}
      })
    });

    if (!res.ok) throw new Error(await res.text());
    showToast(`Subtree added as ${isReference ? '<SubTreePlus>' : 'Full copy'}`);
    loadSubtree(currentSubtreeId);
  } catch (err) {
    console.error('Error adding DO/DI subtree:', err);
    showToast(`Failed: ${err.message}`, 'failure');
  } finally {
    closeDoDiModal();
  }
});

async function forceParseDoDiXml() {
  try {
    const url = "http://localhost:3011/getDoDiSubtrees?force_xml2js_parse=true";
    console.log(`🚀 Forcing fresh XML parse via: ${url}`);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);

    const data = await res.json();
    console.log("✅ Force-parse result:", data);
    return data;
  } catch (err) {
    console.error("❌ Error forcing XML parse:", err);
  }
}
// Cancel button
document.getElementById('dodi-cancel-btn').addEventListener('click', closeDoDiModal);

window.addEventListener("load", () => {
  loadDoDiSubtrees();

});