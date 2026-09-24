// DOM elements for YAML modal
const yamlOutput = document.getElementById('yamlOutput');
const yamlModal = document.getElementById('yamlModal');
let currentFontSize = 11; // Default font size in pixels
let yamlContent = '';
// Open YAML modal
function openYAMLModal() {
    reloadYAML();
    yamlOutput.textContent = yamlContent || 'No YAML available';
    yamlModal.style.display = 'flex';
}

// Close YAML modal
function closeYAMLModal() {
    yamlModal.style.display = 'none';
}

// Change font size
function changeFontSize(delta) {
    currentFontSize += delta;
    if (currentFontSize < 7) currentFontSize = 7; // Minimum font size
    if (currentFontSize > 24) currentFontSize = 24; // Maximum font size
    yamlOutput.style.fontSize = currentFontSize + 'px';
}

// Copy YAML to clipboard
function copyYAML() {
    navigator.clipboard.writeText(yamlOutput.textContent)
        .then(() => showStatus('YAML copied to clipboard', 'success', 2000))
        .catch(() => showStatus('Failed to copy YAML', 'error', 3000));
}

// Reload YAML content
async function reloadYAML() {
    try {
        const res = await fetch(`${API_BASE}/getPoints`);

        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const points = await res.json();
        // Convert points array to YAML format
        yamlContent = jsyaml.dump({ points: points });
        yamlOutput.textContent = yamlContent || 'No YAML available';
        showStatus('YAML reloaded', 'success', 1500);
    } catch (err) {
        yamlOutput.textContent = 'Failed to load YAML';
        showStatus(`Failed to reload YAML: ${err.message}`, 'error', 2000);
        console.error(err);
    }
}

const USER_MODE_CHANGE_LOCK_MS = 1000;
let userModeLock = false;


const UPDATE_INTERVAL_MS = 500;   // 2 Hz
let lastUpdateTime = 0;
 