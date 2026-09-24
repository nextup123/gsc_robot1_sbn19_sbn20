// main_tree.js

let display_main_tree_title = false;

function toggleMainTreeLegend() {
  const legend = document.getElementById('main_tree_legend');
  const toggle = legend.querySelector('.main_tree_toggle');

  const isExpanded = legend.classList.toggle('expanded');
  toggle.title = isExpanded ? 'Collapse' : 'Expand';
}



/* 🌱 Function to update title color state */
function updateMainTreeIndicator() {
  const currentTreeName = document.getElementById('current-subtree-name')?.innerText?.trim();
  const titleBox = document.getElementById('main_tree_title_box');
  if (!titleBox) {
    console.log('main_tree_title_box not found in dom');
  }

  if (currentTreeName === 'main_tree') {
    display_main_tree_title = true;
    titleBox.classList.add('active');
    titleBox.classList.remove('inactive');
  } else {
    display_main_tree_title = false;
    titleBox.classList.add('inactive');
    titleBox.classList.remove('active');
  }
}


/* 🧭 MutationObserver — auto-update title color when subtree name changes */
const currentNameElement = document.getElementById('current-subtree-name');
if (currentNameElement) {
  const subtreeObserver = new MutationObserver(() => {
    updateMainTreeIndicator();
  });
  subtreeObserver.observe(currentNameElement, { childList: true });
}




let currentTreeType = 'mainTree';

const mainTreeXMLModal = document.getElementById('main_tree_xml_modal');
const mainTreeXMLOutput = document.getElementById('main_tree_xml_output');

let mainTreeFontSize = 11;

async function openMainTreeXMLModal(treeType) {
  currentTreeType = treeType;

  const modal = document.getElementById('main_tree_xml_modal');
  const output = document.getElementById('main_tree_xml_output');

  modal.style.display = 'flex';
  output.textContent = 'Loading XML...';

  await loadTreeXML();
}

function closeMainTreeXMLModal() {
  mainTreeXMLModal.style.display = 'none';
}

async function reloadMainTreeXML() {
  await loadTreeXML();
}


async function loadTreeXML() {
  const output = document.getElementById('main_tree_xml_output');

  try {
    const res = await fetch(`${API_BASE}/getTreeXML`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ treeType: currentTreeType })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to load XML');

    output.textContent = data.xml;
  } catch (err) {
    output.textContent = `Error: ${err.message}`;
  }
}


function copyMainTreeXML() {
  navigator.clipboard.writeText(mainTreeXMLOutput.textContent);
}

function mainTreeChangeFontSize(delta) {
  mainTreeFontSize = Math.min(24, Math.max(7, mainTreeFontSize + delta));
  mainTreeXMLOutput.style.fontSize = mainTreeFontSize + 'px';
}
