//context_menu.js

let contextMenu = null;
let activeSubmenu = null; // Track currently open submenu
let activeCategorySubmenus = []; // Track all open category submenus

document.addEventListener("contextmenu", (e) => {
  const nodeElem = e.target.closest(".node");
  const nestedHeader = e.target.closest(".nested-node-header");

  if (!nodeElem && !nestedHeader) return; // not a node in either view

  e.preventDefault();

  if (nestedHeader) {
    // ── Nested view: build selectedNode from raw tree data ──
    const uid = nestedHeader.dataset.uid;
    if (!uid) return;

    const rawNode = findNodeByUid(lastRenderedTreeData, uid);
    if (!rawNode) return;

    const parentRaw = findParentByUid(lastRenderedTreeData, uid);
    selectedNodeUid = uid;
    selectedNodeId  = rawNode.attributes?.ID || rawNode.id || null;
    selectedNode = {
      data: rawNode,
      parent: parentRaw ? {
        data: parentRaw,
        children: parentRaw.children?.map(c => ({ data: c, parent: null })) ?? []
      } : null
    };

    showNodeDetails(rawNode);
    updateButtonStates(rawNode);
    renderNestedView();  // update selection highlight

  } else {
    // ── Tree view: use d3 datum as before ──
    const nodeData = d3.select(nodeElem).datum();
    selectedNode = nodeData;
    // 🔹 Right-click doesn't go through the left-click handler in tree_legend.js,
    // so these must be set here too — otherwise renderTree()'s post-reload
    // "restore selection" logic (which keys off selectedNodeUid/selectedNodeId,
    // not selectedNode) has nothing to match against and drops the selection
    // as soon as an Add/Add-After/Add-Wrapper fired from this context menu reloads the tree.
    selectedNodeUid = nodeData.data.attributes?._uid || null;
    selectedNodeId  = nodeData.data.attributes?.ID || nodeData.data.id || null;
  }

  // Remove any existing menus
  closeAllMenus();

  // Create context menu container
  contextMenu = document.createElement("div");
  contextMenu.className = "context-menu";
  contextMenu.style.top = `${e.pageY}px`;
  contextMenu.style.left = `${e.pageX}px`;

  // Build items dynamically
  addContextItem("➕ Add Node ▸", createNodeSubmenu, contextMenu);
  addContextItem("➕ Add Node After ▸", createNodeAfterSubmenu, contextMenu);
  addContextItem("⤴️ Add Wrapper ▸", createWrapperSubmenu, contextMenu);

  addSeparator(contextMenu);
  addSimpleItem("📋 Copy Node  [Ctrl+D]", copyNode, contextMenu);
  addSimpleItem("❌ Delete Node", deleteNode, contextMenu);
  addSimpleItem("🗑️ Delete Wrapper", deleteWrapperOnly, contextMenu);

  document.body.appendChild(contextMenu);

  // Close when clicking outside
  setTimeout(() => {
    document.addEventListener("click", closeAllMenus, { once: true });
  }, 0);
});

function closeAllMenus() {
  if (contextMenu) contextMenu.remove();
  if (activeSubmenu) activeSubmenu.remove();

  // Close all category submenus
  activeCategorySubmenus.forEach(submenu => {
    if (submenu && submenu.remove) submenu.remove();
  });
  activeCategorySubmenus = [];

  contextMenu = null;
  activeSubmenu = null;
}

// Also close menus on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAllMenus();
  }
});

// 🔹 Utility to create standard items
function addSimpleItem(label, handler, container) {
  const item = document.createElement("div");
  item.className = "context-menu-item";
  item.textContent = label;
  item.onclick = (e) => {
    e.stopPropagation();
    handler();
    closeAllMenus();
  };
  container.appendChild(item);
}

// 🔹 Utility for parent items with submenu (CLICK-BASED)
function addContextItem(label, submenuCreator, container) {
  const item = document.createElement("div");
  item.className = "context-menu-item has-submenu";
  item.style.position = "relative";
  item.style.cursor = "pointer";

  // Create a label span
  const labelSpan = document.createElement("span");
  labelSpan.textContent = label;
  item.appendChild(labelSpan);

  // Right arrow icon
  const arrow = document.createElement("span");
  arrow.textContent = "›";
  arrow.style.marginLeft = "auto";
  arrow.style.color = "#999";
  item.appendChild(arrow);

  // Click handler to open/close submenu
  let submenu = null;

  item.onclick = (e) => {
    e.stopPropagation();

    // Close any other open submenu
    if (activeSubmenu && activeSubmenu !== submenu) {
      activeSubmenu.remove();
      activeSubmenu = null;
    }

    // Toggle this submenu
    if (submenu && activeSubmenu === submenu) {
      // Close if already open
      submenu.remove();
      activeSubmenu = null;
    } else {
      // Remove existing if any
      if (submenu) submenu.remove();

      // Create new submenu
      submenu = submenuCreator();
      if (submenu) {
        submenu.classList.add("active-submenu");
        // Position the submenu
        const rect = item.getBoundingClientRect();
        submenu.style.position = "fixed";
        submenu.style.top = `${rect.top}px`;
        submenu.style.left = `${rect.right}px`;
        document.body.appendChild(submenu);
        activeSubmenu = submenu;

        // Store reference to close later
        submenu.setAttribute('data-parent-item', label);

        // Close submenu if clicking outside
        const closeHandler = (e) => {
          if (!submenu.contains(e.target) && !item.contains(e.target)) {
            if (submenu && submenu.remove) submenu.remove();
            if (activeSubmenu === submenu) activeSubmenu = null;
            document.removeEventListener("click", closeHandler);
          }
        };
        setTimeout(() => {
          document.addEventListener("click", closeHandler);
        }, 0);
      }
    }
  };

  container.appendChild(item);
}

// 🔹 Separator line
function addSeparator(container) {
  const sep = document.createElement("div");
  sep.className = "context-menu-separator";
  container.appendChild(sep);
}

/* ---------------------------------------------------------
   Submenu Builders (return DOM elements)
   --------------------------------------------------------- */
function createNodeSubmenu() {
  const submenu = document.createElement("div");
  submenu.className = "submenu click-submenu";
  submenu.style.zIndex = "10000";
  submenu.style.minWidth = "200px";
  submenu.style.maxHeight = "260px";
  submenu.style.overflowY = "auto";

  if (!nodeDefinitions || !availableCategories) {
    submenu.textContent = "Loading...";
    return submenu;
  }

  // Create menu items for each category
  availableCategories.forEach(catKey => {
    const category = nodeDefinitions[catKey];
    if (!category) return;

    const catItem = document.createElement("div");
    catItem.className = "context-menu-item has-submenu";
    catItem.textContent = category.display_name;
    catItem.style.position = "relative";

    // Add right arrow
    const arrow = document.createElement("span");
    arrow.textContent = "›";
    arrow.style.marginLeft = "auto";
    arrow.style.color = "#999";
    catItem.appendChild(arrow);

    // Store submenu for this category
    let nodesSubmenu = null;

    catItem.onclick = (e) => {
      e.stopPropagation();

      // Close any other open category submenus
      activeCategorySubmenus.forEach(menu => {
        if (menu !== nodesSubmenu && menu.remove) menu.remove();
      });
      activeCategorySubmenus = activeCategorySubmenus.filter(menu => menu === nodesSubmenu);

      // Toggle this category's submenu
      if (nodesSubmenu && document.body.contains(nodesSubmenu)) {
        nodesSubmenu.remove();
        nodesSubmenu = null;
        // Remove from tracking
        activeCategorySubmenus = activeCategorySubmenus.filter(menu => menu !== nodesSubmenu);
      } else {
        // Create nodes list for this category
        nodesSubmenu = document.createElement("div");
        nodesSubmenu.className = "submenu click-submenu";
        nodesSubmenu.style.position = "fixed";
        nodesSubmenu.style.zIndex = "10001";
        nodesSubmenu.style.minWidth = "200px";
        nodesSubmenu.style.maxHeight = "260px";
        nodesSubmenu.style.overflowY = "auto";

        // Collect all nodes
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
          const emptyMsg = document.createElement("div");
          emptyMsg.className = "context-menu-item";
          emptyMsg.textContent = "No nodes available";
          emptyMsg.style.opacity = "0.5";
          emptyMsg.style.cursor = "default";
          nodesSubmenu.appendChild(emptyMsg);
        } else {
          allNodes.sort((a, b) => a.name.localeCompare(b.name));

          allNodes.forEach(node => {
            const nodeItem = document.createElement("div");
            nodeItem.className = "context-menu-item";

            // Add type indicator
            const typeIndicator = document.createElement("span");
            typeIndicator.className = "node-type-indicator";





            // Better type abbreviations
            let typeShort = "";
            switch (node.type) {
              case "Action":
                typeShort = "ACT";
                break;
              case "Condition":
                typeShort = "CON";
                break;
              case "Control":
                typeShort = "CTRL";
                break;
              case "Decorator":
                typeShort = "DEC";
                break;
              default:
                typeShort = node.type.substring(0, 3).toUpperCase();
            }


            typeIndicator.textContent = typeShort;
            typeIndicator.style.fontSize = "10px";
            typeIndicator.style.opacity = "0.6";
            typeIndicator.style.marginRight = "8px";

            const nodeNameSpan = document.createElement("span");
            nodeNameSpan.textContent = node.name;

            nodeItem.appendChild(nodeNameSpan);
            nodeItem.appendChild(typeIndicator);


            nodeItem.onclick = (e) => {
              e.stopPropagation();
              console.log(`[Add Node] Category: ${catKey}, Node: ${node.name} (${node.type})`);
              autoAddNode(catKey, node.type, node.name);
              closeAllMenus(); // Close everything after adding
            };
            nodesSubmenu.appendChild(nodeItem);
          });
        }

        // Position the submenu
        const rect = catItem.getBoundingClientRect();
        nodesSubmenu.style.top = `${rect.top}px`;
        nodesSubmenu.style.left = `${rect.right}px`;
        document.body.appendChild(nodesSubmenu);

        // Track this submenu
        activeCategorySubmenus.push(nodesSubmenu);

        // Close this submenu if clicking outside
        const closeSubmenuHandler = (e) => {
          if (!nodesSubmenu.contains(e.target) && !catItem.contains(e.target)) {
            if (nodesSubmenu && nodesSubmenu.remove) nodesSubmenu.remove();
            activeCategorySubmenus = activeCategorySubmenus.filter(menu => menu !== nodesSubmenu);
            document.removeEventListener("click", closeSubmenuHandler);
          }
        };
        setTimeout(() => {
          document.addEventListener("click", closeSubmenuHandler);
        }, 0);
      }
    };

    submenu.appendChild(catItem);
  });

  return submenu;
}

// ──────────────────────────────────────────────────────────────────────────
// "Add Node After" context-menu submenu — same category/node structure as
// createNodeSubmenu but the leaf action calls /addNodeAfter (siblingPath)
// instead of /addNode (parentPath).
// ──────────────────────────────────────────────────────────────────────────
function createNodeAfterSubmenu() {
  return _buildNodePickerSubmenu((catKey, nodeType, nodeName) => {
    autoAddNodeAfter(catKey, nodeType, nodeName);
  });
}

// Shared submenu builder used by both "Add Node" and "Add Node After"
function _buildNodePickerSubmenu(onPick) {
  const submenu = document.createElement("div");
  submenu.className = "submenu click-submenu";
  submenu.style.zIndex = "10000";
  submenu.style.minWidth = "200px";
  submenu.style.maxHeight = "260px";
  submenu.style.overflowY = "auto";

  if (!nodeDefinitions || !availableCategories) {
    submenu.textContent = "Loading...";
    return submenu;
  }

  availableCategories.forEach(catKey => {
    const category = nodeDefinitions[catKey];
    if (!category) return;

    const catItem = document.createElement("div");
    catItem.className = "context-menu-item has-submenu";
    catItem.textContent = category.display_name;
    catItem.style.position = "relative";

    const arrow = document.createElement("span");
    arrow.textContent = "›";
    arrow.style.marginLeft = "auto";
    arrow.style.color = "#999";
    catItem.appendChild(arrow);

    let nodesSubmenu = null;

    catItem.onclick = (e) => {
      e.stopPropagation();

      activeCategorySubmenus.forEach(menu => {
        if (menu !== nodesSubmenu && menu.remove) menu.remove();
      });
      activeCategorySubmenus = activeCategorySubmenus.filter(m => m === nodesSubmenu);

      if (nodesSubmenu && document.body.contains(nodesSubmenu)) {
        nodesSubmenu.remove();
        nodesSubmenu = null;
      } else {
        nodesSubmenu = document.createElement("div");
        nodesSubmenu.className = "submenu click-submenu";
        nodesSubmenu.style.cssText = "position:fixed;z-index:10001;min-width:200px;max-height:260px;overflow-y:auto;";

        const allNodes = [];
        Object.keys(category.nodes).forEach(ntKey => {
          const nodes = category.nodes[ntKey];
          Object.keys(nodes).forEach(nm => allNodes.push({ name: nm, type: ntKey, definition: nodes[nm] }));
        });

        if (allNodes.length === 0) {
          const em = document.createElement("div");
          em.className = "context-menu-item";
          em.textContent = "No nodes available";
          em.style.opacity = "0.5";
          em.style.cursor = "default";
          nodesSubmenu.appendChild(em);
        } else {
          allNodes.sort((a, b) => a.name.localeCompare(b.name));
          allNodes.forEach(node => {
            const nodeItem = document.createElement("div");
            nodeItem.className = "context-menu-item";

            const typeShort = { Action:"ACT", Condition:"CON", Control:"CTRL", Decorator:"DEC" }[node.type]
              || node.type.substring(0,3).toUpperCase();

            const nameSpan = document.createElement("span");
            nameSpan.textContent = node.name;

            const typeSpan = document.createElement("span");
            typeSpan.textContent = typeShort;
            typeSpan.style.cssText = "font-size:10px;opacity:.6;margin-left:8px;";

            nodeItem.appendChild(nameSpan);
            nodeItem.appendChild(typeSpan);
            nodeItem.onclick = (e) => {
              e.stopPropagation();
              onPick(catKey, node.type, node.name);
              closeAllMenus();
            };
            nodesSubmenu.appendChild(nodeItem);
          });
        }

        const rect = catItem.getBoundingClientRect();
        nodesSubmenu.style.top  = `${rect.top}px`;
        nodesSubmenu.style.left = `${rect.right}px`;
        document.body.appendChild(nodesSubmenu);
        activeCategorySubmenus.push(nodesSubmenu);

        const closeH = (e) => {
          if (!nodesSubmenu?.contains(e.target) && !catItem.contains(e.target)) {
            nodesSubmenu?.remove();
            activeCategorySubmenus = activeCategorySubmenus.filter(m => m !== nodesSubmenu);
            document.removeEventListener("click", closeH);
          }
        };
        setTimeout(() => document.addEventListener("click", closeH), 0);
      }
    };

    submenu.appendChild(catItem);
  });

  return submenu;
}

// Fire the /addNodeAfter API using the currently selected node as the sibling
function autoAddNodeAfter(catKey, nodeType, nodeName) {
  if (!selectedNode || !currentSubtreeId) {
    showToast("Select a node first!");
    closeAllMenus();
    return;
  }
  if (selectedNode.data.type === 'BehaviorTree') {
    showToast("Cannot add after the root node!");
    closeAllMenus();
    return;
  }

  const nodeDef = getNodeDefinition(catKey, nodeType, nodeName);
  const now = new Date();
  const timePart = `${now.getHours()}${now.getMinutes()}${now.getSeconds()}`.slice(-6);
  const uniqueName = `${nodeName}_${timePart}`;

  const attributes = {};
  if (nodeDef?.attributes) {
    for (const [k, v] of Object.entries(nodeDef.attributes)) {
      attributes[k] = v || "";
    }
  }

  fetch(`${API_BASE}/addNodeAfter`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subtreeId: currentSubtreeId,
      siblingPath: selectedNode.data.path.slice(1),
      nodeType: nodeName,
      nodeName: uniqueName,
      attributes,
    }),
  })
    .then(res => {
      if (!res.ok) throw new Error("Failed to add node after");
      showToast(`Added ${nodeName} after "${selectedNode.data.name}"`, "success");
      closeAllMenus();
      loadSubtree(currentSubtreeId);
    })
    .catch(err => {
      showToast(err.message);
      closeAllMenus();
    });
}

function createWrapperSubmenu() {
  const submenu = document.createElement("div");
  submenu.className = "submenu click-submenu";
  submenu.style.zIndex = "10000";
  submenu.style.minWidth = "180px";

  const wrappers = ["Sequence", "Fallback", "Selector", "Parallel", "WhileDoElse"];

  wrappers.forEach((type) => {
    const item = document.createElement("div");
    item.className = "context-menu-item";
    item.textContent = type;
    item.onclick = (e) => {
      e.stopPropagation();
      console.log(`[Add Wrapper] Type: ${type}`);
      document.getElementById("new-wrapper-type").value = type;
      addWrapper();
      closeAllMenus(); // Close everything after adding
    };
    submenu.appendChild(item);
  });

  return submenu;
}

/* ---------------------------------------------------------
   Add Node (auto name) - UPDATED to close menus
   --------------------------------------------------------- */
function autoAddNode(catKey, nodeType, nodeName) {
  if (!selectedNode || !currentSubtreeId) {
    showToast("Select a parent node first!");
    closeAllMenus();
    return;
  }

  // Get the node definition to check if it's a wrapper
  const nodeDef = getNodeDefinition(catKey, nodeType, nodeName);
  const isWrapper = nodeDef && nodeDef.type === 'wrapper';

  // For wrapper nodes, we can add them anywhere
  // For leaf nodes, they must be under a wrapper
  if (!isWrapper && !checkIsWrapper(selectedNode.data.type)) {
    showToast("Leaf nodes can only be added under wrapper nodes!");
    closeAllMenus();
    return;
  }

  const now = new Date();
  const timePart = `${now.getHours()}${now.getMinutes()}${now.getSeconds()}`.slice(-6);
  const uniqueName = `${nodeName}_${timePart}`;

  // Get attributes from node definition
  const attributes = {};

  if (nodeDef?.attributes) {
    for (const [k, v] of Object.entries(nodeDef.attributes)) {
      attributes[k] = v || "";
    }
  }

  console.log(`[Add Node] Adding: ${nodeName} (${isWrapper ? 'wrapper' : 'leaf'}) under ${selectedNode.data.name}`);

  fetch(`${API_BASE}/addNode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subtreeId: currentSubtreeId,
      parentPath: selectedNode.data.path.slice(1),
      nodeType: nodeName,
      nodeName: uniqueName,
      attributes: attributes,
    }),
  })
    .then((res) => {
      if (!res.ok) throw new Error("Failed to add node");
      console.log(`✅ Added node: ${uniqueName}`);
      showToast(`Added ${nodeName}`, "success");
      closeAllMenus(); // Close menus after successful add
      loadSubtree(currentSubtreeId);
    })
    .catch((err) => {
      showToast(err.message);
      closeAllMenus(); // Also close on error
    });
}