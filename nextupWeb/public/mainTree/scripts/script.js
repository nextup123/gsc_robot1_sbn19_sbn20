// script.js 

const API_BASE = "http://localhost:3000/main-tree";

// --------------------------------------------------------------------
let selectedNode = null;
let selectedNodeUid = null;
let selectedNodeId = null;   // stable XML ID — survives _uid regeneration on move/update
let dragStartTime = null;
let customNodeModalOpen = false;

let pointsList = [];
let pointsListLoaded = false;



let lastSearchQuery = '';
let searchMatches = [];        // array of node UIDs that match
let currentMatchIndex = -1;

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}



/* -------------------------------------------------
   Custom Node Modal
   ------------------------------------------------- */
function openCustomNodeModal() {
  if (customNodeModalOpen) return;
  customNodeModalOpen = true;
  document.getElementById('custom-node-modal').style.display = 'flex';
  document.getElementById('custom-node-name').value = '';
  document.getElementById('custom-attributes-list').innerHTML = '';
  addAttributeRow();
}
function closeCustomNodeModal() {
  customNodeModalOpen = false;
  document.getElementById('custom-node-modal').style.display = 'none';
}

function addAttributeRow(key = '', value = '') {
  const list = document.getElementById('custom-attributes-list');
  const row = document.createElement('div');
  row.className = 'attr-row';
  row.innerHTML = `
    <input type="text" placeholder="attribute_name" value="${key}">
    <input type="text" placeholder="default_value (optional)" value="${value}">
    <button type="button" onclick="this.parentElement.remove()">x</button>
  `;
  list.appendChild(row);
}
document.getElementById('add-attr-btn').onclick = () => addAttributeRow();

document.getElementById('save-custom-node').onclick = async () => {
  const name = document.getElementById('custom-node-name').value.trim();
  const category = document.getElementById('custom-node-category').value;
  const isWrapper = document.querySelector('input[name="node-kind"]:checked').value === 'wrapper';

  if (!name) { showToast('Node name required!', 'warn'); return; }

  const attributes = {};
  document.querySelectorAll('#custom-attributes-list .attr-row').forEach(row => {
    const k = row.children[0].value.trim();
    const v = row.children[1].value.trim();
    if (k) attributes[k] = v;
  });

  try {
    const res = await fetch(`${API_BASE}/addCustomNode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, category, isWrapper, attributes })
    });
    if (!res.ok) throw new Error(await res.text());
    showToast('Custom node added!');
    closeCustomNodeModal();
    await loadNodeTypes();
  } catch (err) {
    console.error(err);
    showToast(`Failed: ${err.message}`, 'failure');
  }
};

/* -------------------------------------------------
   Tree conversion & rendering (with _uid support)
   ------------------------------------------------- */
function convertToTree(obj, name = 'root', path = [], type = 'BehaviorTree') {
  const attrs = obj['@attributes'] || {};
  const children = obj['@children'] || [];

  // 🔹 Extract UID safely — use ID if _uid missing (for backward compatibility)
  const uid = attrs._uid || attrs.ID || `temp_${Math.random().toString(36).slice(2)}`;

  const node = {
    // what user sees
    name: attrs.name || attrs.ID || name,
    // what backend uses
    uid,
    id: attrs.ID || null,
    attributes: attrs,
    children: [],
    path,     // inherited from parent — full ancestry of UIDs
    type
  };

  children.forEach(child => {
    const tag = child.tagName;
    const content = child.content;
    const childAttrs = content['@attributes'] || {};

    // 🔹 child UID & name fallback
    const childUid = childAttrs._uid || childAttrs.ID || `temp_${Math.random().toString(36).slice(2)}`;
    const childName = childAttrs.name || childAttrs.ID || tag;

    // 🔹 recursively build subtree
    const childNode = convertToTree(
      content,
      childName,
      [...path, childUid],   // 🔹 use UID path, not ID path
      tag
    );
    node.children.push(childNode);
  });

  return node;
}


// node coloring
const TYPE_COLOR = {
  BehaviorTree: '#007aff',
  SubTreePlus: 'rgb(214, 88, 10)',
  Sequence: '#5856d6',
  Fallback: '#ff2d55',
  Selector: '#00c4b4',
  Parallel: '#ff9500',
  WhileDoElse: '#ffcc00',
  Timeout: '#1f3801ff',
  Action: '#34c759',
  DoControl: '#3482c7',
  DIControl: '#216790',
  RunPath: '#a3654cff',
  PilzPointsPlanner: '#32f6b8',
  Condition: '#ff9500',
  __wrapper__: '#9c27b0',
  __leaf__: '#4caf50'
};

// ✅ Unified helper: determines if a node type is a wrapper - UPDATED FOR NEW STRUCTURE
function checkIsWrapper(type) {

  const wrapperTypes = ['BehaviorTree', 'Sequence', 'Fallback', 'Selector', 'Parallel', 'WhileDoElse'];

  // Standard wrapper nodes
  if (wrapperTypes.includes(type)) {
    console.log(`  ${type} is in hardcoded wrapperTypes`);
    return true;
  }

  // Check all categories in the new structure
  if (nodeDefinitions && availableCategories) {
    for (const catKey of availableCategories) {
      const category = nodeDefinitions[catKey];
      if (!category || !category.nodes) continue;

      // Check each node type (Action, Condition, Control, Decorator)
      for (const nodeType in category.nodes) {
        const nodes = category.nodes[nodeType];
        if (nodes && nodes[type]) {
          const nodeDef = nodes[type];
          console.log(`  Found ${type} in ${catKey}.${nodeType}:`, nodeDef);
          if (nodeDef.type === 'wrapper') {
            console.log(`  ${type} is wrapper (found in ${catKey})`);
            return true;
          }
        }
      }
    }
  }

  console.log(`  ${type} is NOT a wrapper`);
  return false;
}

/* -------------------------------------------------
   Helper: swap target detection - FIXED VERSION
   ------------------------------------------------- */
function findSwapTarget(x, y, currentNode, root) {
  const nodes = root.descendants();
  let closest = null;
  let minDist = Infinity;

  // Get the XML parent path of the current node (remove itself)
  const currentParentPath = currentNode.data.path.slice(0, -1);

  nodes.forEach(n => {
    if (n === currentNode) return;

    const targetParentPath = n.data.path.slice(0, -1);

    // Compare by UID path (safe)
    if (JSON.stringify(currentParentPath) !== JSON.stringify(targetParentPath)) return;

    const dx = n.x - x;
    const dy = n.y - y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < minDist && dist < 80) {
      minDist = dist;
      closest = n;
    }
  });

  return closest;
}


const POINT_ATTRIBUTES = new Set([
  "point_name",
  "pose_goal",
  "target_name",
  "start_name",
  "goal_name",
  "interim_name",
  "frame"
]);

function isPointAttribute(attrName) {
  return POINT_ATTRIBUTES.has(attrName);
}


function renderAttributeFieldHTML(key, value) {
  if (isPointAttribute(key)) {
    return `
      <label>${key}</label>
      <input class="input_field_class" type="text" name="${key}" value="${value || ''}"
             list="point-names-datalist"
             placeholder="Search point name..."
             autocomplete="off" />
    `;
  }
  return `<label>${key}</label><input type="text" name="${key}" value="${value || ''}" />`;
}
function showNodeDetails(data) {
  const info = document.getElementById('node-info');
  const edit = document.getElementById('edit-section');
  const fieldsDiv = document.getElementById('edit-fields');

  info.innerHTML = `<b>${data.name}</b>`;
  edit.style.display = 'block';
  fieldsDiv.innerHTML = '';

  // List all attributes (excluding _uid for clarity)
  for (const [k, v] of Object.entries(data.attributes)) {
    if (k === '_uid') continue;
    const field = document.createElement('div');
    fieldsDiv.appendChild(createAttributeField(k, v));
  }

  const form = document.getElementById('edit-form');
  form.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const newAttrs = {};
    fd.forEach((val, key) => (newAttrs[key] = val));

    // 🔹 Read the path from the LIVE selectedNode at submit time, not from the
    // `data` object captured in this closure when the form was built. After a
    // reload (e.g. from a previous edit/move), `data.path` here is stale even
    // though selectedNode has already been correctly re-synced — this is what
    // caused "Update Node" to fail on the second consecutive submit without
    // reselecting the node.
    if (!selectedNode) {
      showToast('Selection lost — please reselect the node.', 'warn');
      return;
    }
    const livePath = selectedNode.data.path;

    try {
      const res = await fetch(`${API_BASE}/updateNode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subtreeId: currentSubtreeId,
          nodePath: livePath.slice(1), // UID path
          newAttributes: newAttrs,
        }),
      });

      if (!res.ok) throw new Error(await res.text());
      showToast('Node updated!');
      loadSubtree(currentSubtreeId);
    } catch (err) {
      console.error('Error updating node:', err);
      showToast(`Failed to update node: ${err.message}`, 'failure');
    }
  };
}




/* ==============================================================
   NODE TYPE LOADING - NEW VERSION
   ============================================================== */
let nodeDefinitions = null; // Will store the new categories structure
let availableCategories = []; // Store list of category keys

async function loadNodeTypes() {
  try {
    const res = await fetch(`${API_BASE}/getNodeTypes`);
    if (!res.ok) throw new Error('Failed to load node types');
    const data = await res.json();

    // New structure: data.categories
    nodeDefinitions = data.categories;
    availableCategories = Object.keys(nodeDefinitions);

    console.log(`Loaded ${availableCategories.length} categories:`);
    availableCategories.forEach(cat => {
      const category = nodeDefinitions[cat];
      let nodeCount = 0;
      for (const nodeType in category.nodes) {
        nodeCount += Object.keys(category.nodes[nodeType]).length;
      }
      console.log(`  - ${cat} (${category.display_name}): ${nodeCount} nodes`);
    });

    // Populate the category dropdown (for the Add Node panel)
    populateCategoryDropdown();

    // Setup the main category selector if it exists
    const mainCatSelect = document.getElementById('node-category');
    if (mainCatSelect) {
      setupMainCategorySelector(mainCatSelect);
    }

  } catch (err) {
    console.error(err);
    showToast('Failed to load node types', 'failure');
  }
}

/* ==============================================================
   POPULATE CATEGORY DROPDOWN
   ============================================================== */
function populateCategoryDropdown() {
  const catSelect = document.getElementById('node-category');
  if (!catSelect) return;

  catSelect.innerHTML = '<option value="">Select Category</option>';

  availableCategories.forEach(catKey => {
    const category = nodeDefinitions[catKey];
    const opt = document.createElement('option');
    opt.value = catKey;
    opt.textContent = category.display_name;
    opt.title = category.description || '';
    catSelect.appendChild(opt);
  });

  // Set up the change handler
  catSelect.onchange = () => {
    const selectedCat = catSelect.value;
    const typeSelect = document.getElementById('node-type');
    typeSelect.innerHTML = '<option value="">Select Node Type</option>';
    document.getElementById('node-attributes').innerHTML = '';

    if (!selectedCat) return;

    // Populate node types based on selected category
    populateNodeTypeDropdown(selectedCat);
  };
}
/* ==============================================================
   POPULATE NODE TYPE DROPDOWN - DIRECT NODES (no Action/Condition layer)
   ============================================================== */
function populateNodeTypeDropdown(categoryKey) {
  const category = nodeDefinitions[categoryKey];
  if (!category) return;

  const typeSelect = document.getElementById('node-type');
  typeSelect.innerHTML = '<option value="">Select Node Type</option>';

  // Collect all nodes from all node types
  const allNodes = [];

  Object.keys(category.nodes).forEach(nodeType => {
    const nodes = category.nodes[nodeType];
    Object.keys(nodes).forEach(nodeName => {
      allNodes.push({
        name: nodeName,
        type: nodeType,
        definition: nodes[nodeName]
      });
    });
  });

  if (allNodes.length === 0) {
    const opt = document.createElement('option');
    opt.value = "";
    opt.textContent = "No nodes available";
    typeSelect.appendChild(opt);
    return;
  }

  // Sort nodes alphabetically
  allNodes.sort((a, b) => a.name.localeCompare(b.name));

  // Add each node as a direct option
  allNodes.forEach(node => {
    const opt = document.createElement('option');
    opt.value = `${node.type}:${node.name}`;
    opt.textContent = `${node.name} [${node.type}]`; // Show type in brackets
    opt.title = `Type: ${node.type}${node.definition.description ? `\n${node.definition.description}` : ''}`;
    typeSelect.appendChild(opt);
  });

  // Setup change handler for node type selection
  typeSelect.onchange = () => {
    const selectedValue = typeSelect.value;
    if (!selectedValue) {
      document.getElementById('node-attributes').innerHTML = '';
      return;
    }

    const [nodeType, nodeName] = selectedValue.split(':');
    loadNodeAttributes(categoryKey, nodeType, nodeName);

    // Auto-generate node name
    const nameInput = document.getElementById('new-node-name');
    if (nameInput && nodeName) {
      const now = new Date();
      const timePart = `${now.getHours()}${now.getMinutes()}${now.getSeconds()}`.slice(-6);
      const autoName = `${nodeName}_${timePart}`;
      nameInput.value = autoName;
    }
  };
}

/* ==============================================================
   LOAD NODE ATTRIBUTES
   ============================================================== */
function loadNodeAttributes(categoryKey, nodeType, nodeName) {
  const category = nodeDefinitions[categoryKey];
  if (!category || !category.nodes[nodeType] || !category.nodes[nodeType][nodeName]) {
    console.warn(`Node not found: ${categoryKey}/${nodeType}/${nodeName}`);
    return;
  }

  const nodeDef = category.nodes[nodeType][nodeName];
  const attrDiv = document.getElementById('node-attributes');
  attrDiv.innerHTML = '';

  console.log(`Selected node: ${nodeName}`, nodeDef);

  if (nodeDef.attributes && Object.keys(nodeDef.attributes).length > 0) {
    for (const [attrName, defaultValue] of Object.entries(nodeDef.attributes)) {
      attrDiv.appendChild(createAttributeField(attrName, defaultValue, true)); // true = use data-attr
    }
  }
  else {
    attrDiv.innerHTML = '<div class="attr-info">No attributes for this node</div>';
  }
}

/* ==============================================================
   SETUP MAIN CATEGORY SELECTOR (if using separate UI)
   ============================================================== */
function setupMainCategorySelector(catSelect) {
  // This function remains as before but uses the new structure
  catSelect.onchange = () => {
    const selectedCat = catSelect.value;
    const typeSelect = document.getElementById('node-type');
    typeSelect.innerHTML = '<option value="">Select Node Type</option>';
    document.getElementById('node-attributes').innerHTML = '';

    if (!selectedCat) return;

    // Populate node types based on selected category
    populateNodeTypeDropdown(selectedCat);
  };
}

/* ==============================================================
   GET NODE DEFINITION (utility function for context menu)
   ============================================================== */
function getNodeDefinition(categoryKey, nodeType, nodeName) {
  const category = nodeDefinitions[categoryKey];
  if (!category) return null;
  if (!category.nodes[nodeType]) return null;
  return category.nodes[nodeType][nodeName] || null;
}

/* ==============================================================
   GET ALL NODES FOR A SPECIFIC TYPE (e.g., all Action nodes across categories)
   ============================================================== */
function getAllNodesByType(targetNodeType) {
  const result = {};

  availableCategories.forEach(catKey => {
    const category = nodeDefinitions[catKey];
    if (category.nodes[targetNodeType]) {
      result[catKey] = {
        category: category,
        nodes: category.nodes[targetNodeType]
      };
    }
  });

  return result;
}



const tooltip = d3.select('#tooltip');
function showHoverTooltip(d) {
  const info = Object.entries(d.data.attributes || {})
    .filter(([k]) => k !== '_uid') // hide _uid
    .map(([k, v]) => `${k}: ${v}`)
    .join('<br>');
  tooltip.style('display', 'block')
    .html(`<b>${d.data.name}</b><br>${info}`);
}

function hideHoverTooltip() {
  tooltip.style('display', 'none');
}

d3.select('#tree-view').on('mousemove', e => {
  tooltip.style('left', `${e.pageX + 10}px`)
    .style('top', `${e.pageY + 10}px`);
});



function populatePointsDatalist() {
  const datalist = document.getElementById('point-names-datalist');
  if (!datalist) return;
  datalist.innerHTML = '';
  pointsList.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    datalist.appendChild(opt);
  });
}
async function loadPointsList() {
  try {
    // TODO: point this at wherever your points list actually lives
    const res = await fetch(`http://localhost:3000/point-planning/getPoints`);
    if (!res.ok) throw new Error('Failed to load points');
    const data = await res.json();

    // tolerate either ["p1","p2"] or [{name:"p1"}, ...] or {points:[...]}
    const raw = Array.isArray(data) ? data : (data.points || []);
    pointsList = raw.map(p => (typeof p === 'string' ? p : (p.name || p.point_name || p.id)))
      .filter(Boolean);

    pointsListLoaded = true;
    populatePointsDatalist();
  } catch (err) {
    console.error('Error loading points list:', err);
  }
}

window.onload = () => {
  loadNodeTypes();
  loadPointsList();   // 🔹 new

  // ── Keyboard shortcuts ──────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    // Ctrl+D — duplicate (copy) selected node
    if (e.ctrlKey && e.key === 'd') {
      // Only fire when not typing inside an input/textarea
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      e.preventDefault();
      copyNode();
    }
  });

};

/* -------------------------------------------------
   Custom searchable point-name input (replaces <datalist>
   — datalist popups get clipped inside scrollable side panels)
   ------------------------------------------------- */
function createPointNameInput(attrKey, value, useDataAttr = false) {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';

  const input = document.createElement('input');
  input.type = 'text';
  if (useDataAttr) input.dataset.attr = attrKey;
  else input.name = attrKey;
  input.value = value || '';
  input.autocomplete = 'off';
  input.placeholder = 'Search point name...';
  wrapper.appendChild(input);

  let dropdown = null;

  function closeDropdown() {
    if (dropdown) { dropdown.remove(); dropdown = null; }
    document.removeEventListener('click', outsideClick);
  }
  function outsideClick(e) {
    if (!wrapper.contains(e.target) && e.target !== dropdown) closeDropdown();
  }

  function openDropdown(showAll = false) {
    closeDropdown();
    const query = showAll ? '' : input.value.trim().toLowerCase();
    const matches = pointsList.filter(p => p.toLowerCase().includes(query));
    if (matches.length === 0) return;

    dropdown = document.createElement('div');
    dropdown.style.cssText = `
    position:fixed; background:#fff; border:1px solid #d2d2d7; border-radius:8px;
    box-shadow:0 4px 12px rgba(0,0,0,.15); max-height:220px; overflow-y:auto;
    z-index:99999; min-width:${Math.max(input.offsetWidth, 160)}px;
  `;
    const rect = input.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.left = `${rect.left}px`;

    matches.slice(0, 50).forEach(name => {
      const item = document.createElement('div');
      item.textContent = name;
      item.style.cssText = 'padding:6px 10px;font-size:13px;cursor:pointer;';
      item.onmouseenter = () => item.style.background = '#f0f0f5';
      item.onmouseleave = () => item.style.background = '';
      item.onclick = (e) => {
        e.stopPropagation();
        input.value = name;
        closeDropdown();
      };
      dropdown.appendChild(item);
    });

    document.body.appendChild(dropdown);
    setTimeout(() => document.addEventListener('click', outsideClick), 0);
  }

  input.addEventListener('focus', () => openDropdown(true));   // 🔹 show all on focus
  input.addEventListener('input', () => openDropdown(false));  // filter as you type

  input.addEventListener('keydown', e => { if (e.key === 'Escape') closeDropdown(); });

  return wrapper;
}

function createAttributeField(key, value, useDataAttr = false) {
  const field = document.createElement('div');
  const label = document.createElement('label');
  label.textContent = key;
  field.appendChild(label);

  if (isPointAttribute(key)) {
    field.appendChild(createPointNameInput(key, value, useDataAttr));
  } else {
    const input = document.createElement('input');
    input.type = 'text';
    if (useDataAttr) { input.dataset.attr = key; input.placeholder = value; }
    else input.name = key;
    input.value = value || '';
    field.appendChild(input);
  }
  return field;
}