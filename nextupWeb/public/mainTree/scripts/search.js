//search.js

/* -------------------------------------------------
   Node Search  — plugs into existing renderTree
   ------------------------------------------------- */
const searchInput = document.getElementById('search-input');

searchInput.addEventListener('input', debounce(() => {
  lastSearchQuery = searchInput.value.trim().toLowerCase();
  currentMatchIndex = 0;
  applySearchHighlight();
}, 200));

/* ---- HELPER: Check if any attribute value matches the search query ---- */
function nodeAttributesMatch(node, searchQuery) {
  if (!searchQuery) return false;
  
  const attributes = node.attributes || {};
  for (const [key, value] of Object.entries(attributes)) {
    // Skip internal _uid from attribute search (it's not user-facing)
    if (key === '_uid') continue;
    
    const stringValue = String(value).toLowerCase();
    if (stringValue.includes(searchQuery)) {
      return true;
    }
  }
  return false;
}

function applySearchHighlight() {
  if (currentView === 'tree') {
    applySearchHighlightTree();
  } else {
    applySearchHighlightNested();
  }
}

/* ---- tree view (updated to search names, types, AND attributes) ---- */

function applySearchHighlightTree() {
  if (!lastRenderedTreeData) return;

  searchMatches = [];
  d3.selectAll('#tree-view .node').each(function (d) {
    const name = (d.data.name || d.data.type || '').toLowerCase();
    const uid = d.data.attributes?._uid;
    
    // ✅ Check name, type, OR any attribute value
    const matchesNameOrType = lastSearchQuery && name.includes(lastSearchQuery);
    const matchesAttribute = nodeAttributesMatch(d.data, lastSearchQuery);
    
    if ((matchesNameOrType || matchesAttribute) && uid) {
      searchMatches.push(uid);
    }
  });

  // ✅ Reset ALL nodes to base state first
  d3.selectAll('#tree-view .node circle')
    .attr('stroke', null)
    .attr('stroke-width', 1)
    .attr('r', 10)
    .style('filter', 'none');

  if (!lastSearchQuery) {
    document.getElementById('search-counter').textContent = '';
    return;
  }

  // ✅ Paint all matches orange
  d3.selectAll('#tree-view .node').each(function (d) {
    if (searchMatches.includes(d.data.attributes?._uid)) {
      d3.select(this).select('circle')
        .attr('stroke', '#ff9500')
        .attr('stroke-width', 2.5)
        .attr('r', 13);
    }
  });

  // ✅ Then paint ONLY the focused match red (on top of orange pass)
  _paintFocusedTreeNode(currentMatchIndex);
  updateSearchCounter();
}

// Separated so navigateMatch can call it without re-running the full highlight pass
function _paintFocusedTreeNode(index) {
  if (searchMatches.length === 0) return;
  currentMatchIndex = ((index % searchMatches.length) + searchMatches.length) % searchMatches.length;
  const uid = searchMatches[currentMatchIndex];

  d3.selectAll('#tree-view .node').each(function (d) {
    if (d.data.attributes?._uid === uid) {
      d3.select(this).select('circle')
        .attr('stroke', '#ff2d55')
        .attr('stroke-width', 3)
        .attr('r', 15)
        .style('filter', 'none')
        .style('filter', 'drop-shadow(0 0 5px rgba(255, 8, 0, 0.9))');

      // Pan to node
      const svg = d3.select('#tree-view svg');
      const gNode = d3.select('#tree-view g');
      const container = document.getElementById('tree-view');
      const w = container.offsetWidth, h = container.offsetHeight;
      const zoom = d3.zoom().scaleExtent([0.5, 3])
        .on('zoom', ev => gNode.attr('transform', ev.transform));
      svg.call(zoom);
      const cur = d3.zoomTransform(svg.node());
      svg.transition().duration(350).call(
        zoom.transform,
        d3.zoomIdentity
          .translate(w / 2 - cur.k * d.x, h / 2 - cur.k * d.y)
          .scale(cur.k)
      );
    }
  });
}

function focusMatch(index) {
  if (currentView === 'nested') { focusMatchNested(index); return; }
  _paintFocusedTreeNode(index);
}

function navigateMatch(direction) {
  if (searchMatches.length === 0) return;

  if (currentView === 'nested') {
    focusMatchNested(currentMatchIndex + direction);
    return;
  }

  // ✅ Advance the index FIRST
  currentMatchIndex = ((currentMatchIndex + direction) % searchMatches.length + searchMatches.length) % searchMatches.length;

  // ✅ Reset all to base, repaint orange, then red — single pass, no double state
  d3.selectAll('#tree-view .node circle')
    .attr('stroke', null).attr('stroke-width', 1).attr('r', 10).style('filter', 'none');

  d3.selectAll('#tree-view .node').each(function (d) {
    if (searchMatches.includes(d.data.attributes?._uid)) {
      d3.select(this).select('circle')
        .attr('stroke', '#ff9500').attr('stroke-width', 2.5).attr('r', 13);
    }
  });

  // ✅ Only NOW paint the single focused node red
  const uid = searchMatches[currentMatchIndex];
  d3.selectAll('#tree-view .node').each(function (d) {
    if (d.data.attributes?._uid === uid) {
      d3.select(this).select('circle')
        .attr('stroke', '#ff2d55').attr('stroke-width', 3).attr('r', 15)
        .style('filter', 'drop-shadow(0 0 6px rgba(255,45,85,0.8))');

      const svg = d3.select('#tree-view svg');
      const gNode = d3.select('#tree-view g');
      const container = document.getElementById('tree-view');
      const w = container.offsetWidth, h = container.offsetHeight;
      const zoom = d3.zoom().scaleExtent([0.5, 3])
        .on('zoom', ev => gNode.attr('transform', ev.transform));
      svg.call(zoom);
      const cur = d3.zoomTransform(svg.node());
      svg.transition().duration(350).call(
        zoom.transform,
        d3.zoomIdentity.translate(w / 2 - cur.k * d.x, h / 2 - cur.k * d.y).scale(cur.k)
      );
    }
  });

  updateSearchCounter();
}

/* ---- nested view (updated to search names, types, AND attributes) ---- */
function applySearchHighlightNested() {
  if (!lastRenderedTreeData) return;

  searchMatches = [];
  function walkForMatches(node) {
    const name = (node.name || node.type || '').toLowerCase();
    const uid = node.attributes?._uid || node.uid;
    
    // ✅ Check name, type, OR any attribute value
    const matchesNameOrType = lastSearchQuery && name.includes(lastSearchQuery);
    const matchesAttribute = nodeAttributesMatch(node, lastSearchQuery);
    
    if ((matchesNameOrType || matchesAttribute) && uid) {
      searchMatches.push(uid);
    }
    
    (node.children || []).forEach(walkForMatches);
  }
  walkForMatches(lastRenderedTreeData);

  // Clear all highlights
  document.querySelectorAll('#nested-view .nested-node-header').forEach(el => {
    el.classList.remove('nested-search-match', 'nested-search-focus');
    el.style.border = '';
    el.style.backgroundColor = '';
  });

  if (!lastSearchQuery) { document.getElementById('search-counter').textContent = ''; return; }

  // Expand ancestors so focused match is visible
  searchMatches.forEach(uid => expandAncestors(uid));

  renderNestedView();
  focusMatchNested(currentMatchIndex);  // only focus, no bulk highlight
  updateSearchCounter();
}

function focusMatchNested(index) {
  if (searchMatches.length === 0) return;
  currentMatchIndex = ((index % searchMatches.length) + searchMatches.length) % searchMatches.length;

  // Clear all first
  document.querySelectorAll('#nested-view .nested-node-header').forEach(el => {
    el.classList.remove('nested-search-match', 'nested-search-focus');
    el.style.border = '';
    el.style.backgroundColor = '';
  });

  // Highlight ONLY the current focused match
  const uid = searchMatches[currentMatchIndex];
  const el = document.querySelector(`#nested-view .nested-node-header[data-uid="${uid}"]`);
  if (el) {
    el.classList.add('nested-search-focus');
    el.style.border = '3px solid #ff2d55';
    el.style.backgroundColor = 'rgba(255, 45, 85, 0.1)';
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  updateSearchCounter();
}

/* Expand all collapsed ancestors of a given uid */
function expandAncestors(uid) {
  function findAncestors(node, target, path) {
    const nodeUid = node.attributes?._uid || node.uid;
    if (nodeUid === target) return path;
    for (const child of (node.children || [])) {
      const found = findAncestors(child, target, [...path, nodeUid]);
      if (found) return found;
    }
    return null;
  }
  const ancestors = findAncestors(lastRenderedTreeData, uid, []);
  if (ancestors) ancestors.forEach(a => nestedCollapsed.delete(a));
}

function clearSearch() {
  searchInput.value = '';
  lastSearchQuery = '';
  searchMatches = [];
  currentMatchIndex = -1;
  document.getElementById('search-counter').textContent = '';

  // tree view
  d3.selectAll('#tree-view .node circle')
    .attr('stroke', null).attr('stroke-width', 1).attr('r', 10).style('filter', 'none');

  // nested view — clear classes AND inline styles
  document.querySelectorAll('#nested-view .nested-node-header').forEach(el => {
    el.classList.remove('nested-search-match', 'nested-search-focus');
    el.style.border = '';
    el.style.backgroundColor = '';
  });
}

function updateSearchCounter() {
  const el = document.getElementById('search-counter');
  if (!lastSearchQuery || searchMatches.length === 0) {
    el.textContent = searchMatches.length === 0 && lastSearchQuery ? '0 found' : '';
  } else {
    el.textContent = `${currentMatchIndex + 1}/${searchMatches.length}`;
  }
}


function highlightFailedNodes(failedNode, traceNodes) {
  if (!failedNode && traceNodes.length === 0) return;

  const failedLower = failedNode?.toLowerCase();
  const traceLower = traceNodes.map(n => n.toLowerCase());

  // ---- TREE VIEW ----
  if (currentView === 'tree') {
    // Reset all nodes
    d3.selectAll('#tree-view .node')
      .classed('failed-node', false)
      .classed('trace-node', false);

    let failedD = null;

    d3.selectAll('#tree-view .node').each(function (d) {
      const name = (d.data.name || d.data.type || '').toLowerCase();

      if (name === failedLower) {
        d3.select(this).classed('failed-node', true);
        failedD = d;

      } else if (traceLower.includes(name)) {
        d3.select(this).classed('trace-node', true);
      }
    });

    // Pan to failed node
    if (failedD) {
      const svg = d3.select('#tree-view svg');
      const gNode = d3.select('#tree-view g');
      const container = document.getElementById('tree-view');
      const w = container.offsetWidth, h = container.offsetHeight;

      const zoom = d3.zoom().scaleExtent([0.5, 3])
        .on('zoom', ev => gNode.attr('transform', ev.transform));

      svg.call(zoom);

      const cur = d3.zoomTransform(svg.node());

      svg.transition().duration(350).call(
        zoom.transform,
        d3.zoomIdentity
          .translate(w / 2 - cur.k * failedD.x, h / 2 - cur.k * failedD.y)
          .scale(cur.k)
      );
    }
  }

  // ---- NESTED VIEW ----
  if (currentView === 'nested') {
    document.querySelectorAll('#nested-view .nested-node-header').forEach(el => {
      el.classList.remove('nested-trace-node', 'nested-failed-node');
    });

    function findUidByName(node, targetName) {
      const name = (node.name || node.type || '').toLowerCase();
      const uid = node.attributes?._uid || node.uid;

      if (name === targetName && uid) return uid;

      for (const child of (node.children || [])) {
        const found = findUidByName(child, targetName);
        if (found) return found;
      }
      return null;
    }

    // Expand trace nodes
    traceLower.forEach(traceName => {
      const uid = findUidByName(lastRenderedTreeData, traceName);
      if (uid) expandAncestors(uid);
    });

    renderNestedView();

    // Apply trace styles
    traceLower.forEach(traceName => {
      const uid = findUidByName(lastRenderedTreeData, traceName);
      if (!uid) return;

      const el = document.querySelector(
        `#nested-view .nested-node-header[data-uid="${uid}"]`
      );

      if (el) {
        el.classList.add('nested-trace-node');

        if (!el.querySelector('.trace-indicator')) {
          const indicator = document.createElement('span');
          indicator.textContent = '⚠️ ';
          indicator.className = 'trace-indicator';
          el.prepend(indicator);
        }
      }
    });

    // Apply failed node styles
    if (failedLower) {
      const uid = findUidByName(lastRenderedTreeData, failedLower);

      if (uid) {
        const el = document.querySelector(
          `#nested-view .nested-node-header[data-uid="${uid}"]`
        );

        if (el) {
          el.classList.remove('nested-trace-node');
          el.classList.add('nested-failed-node');

          if (!el.querySelector('.failed-indicator')) {
            const indicator = document.createElement('span');
            indicator.textContent = '❌ ';
            indicator.className = 'failed-indicator';
            el.prepend(indicator);
          }

          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
  }
}

let failedNodeName = null;
let failedTraceNodes = [];

window.addEventListener("message", (event) => {
  if (event.origin !== "http://localhost:3000") return;

  if (event.data?.type === "FAILED_NODE") {
    failedNodeName = event.data.value;
    failedTraceNodes = event.data.traceNodes || [];

    highlightFailedNodes(failedNodeName, failedTraceNodes);

    if (failedNodeName) {
      showToast(`Failed At Node: ${failedNodeName}`, 'failure');
    }
  }
});

function clearHighlights() {
  // ---- TREE VIEW ----
  d3.selectAll('#tree-view .node')
    .classed('failed-node', false)
    .classed('trace-node', false);

  // ---- NESTED VIEW ----
  document.querySelectorAll('#nested-view .nested-node-header').forEach(el => {
    el.classList.remove('nested-trace-node', 'nested-failed-node');

    // Remove indicators
    const traceIcon = el.querySelector('.trace-indicator');
    const failedIcon = el.querySelector('.failed-indicator');

    if (traceIcon) traceIcon.remove();
    if (failedIcon) failedIcon.remove();
  });
}

// Auto clear after 3 seconds (adjust as needed)