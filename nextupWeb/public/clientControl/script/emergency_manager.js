// ─── ADD THIS BLOCK to public/clientControl/script/script.js ──────────────
// Place anywhere after the DOM is ready (e.g. at the bottom of the file)

(function emergencyManagerUI() {
  const btn = document.getElementById('emergency-config-btn');
  const overlay = document.getElementById('emergency-modal-overlay');
  const closeBtn = document.getElementById('emergency-modal-close');
  const cancelBtn = document.getElementById('emergency-modal-cancel');
  const saveBtn = document.getElementById('emergency-modal-save');
  const addTopicBtn = document.getElementById('em-add-topic');
  const topicsList = document.getElementById('em-topics-list');
  const limitMsg = document.getElementById('em-topics-limit');
  const statusEl = document.getElementById('em-status');
  const driverSel = document.getElementById('em-driver');
  const diSel = document.getElementById('em-di');

  const MAX_TOPICS = 5;

  function addTopicRow(value = '') {
    const rows = topicsList.querySelectorAll('.em-topic-row');
    if (rows.length >= MAX_TOPICS) {
      limitMsg.style.display = 'block';
      return;
    }
    const row = document.createElement('div');
    row.className = 'em-topic-row';
    row.style.cssText = 'display:flex; gap:8px; align-items:center;';
    row.innerHTML = `
      <input type="text" value="${value}" placeholder="/your_bool_topic" style="
        flex:1; background:#313244; border:1px solid #45475a; border-radius:8px;
        color:#cdd6f4; padding:7px 10px; font-size:13px; outline:none;
      ">
      <button class="em-remove-topic" style="
        background:#f38ba8; border:none; border-radius:6px; color:#1e1e2e;
        width:28px; height:28px; cursor:pointer; font-size:14px; font-weight:700;
      ">×</button>
    `;
    row.querySelector('.em-remove-topic').onclick = () => {
      row.remove();
      limitMsg.style.display = 'none';
    };
    topicsList.appendChild(row);
    limitMsg.style.display = topicsList.querySelectorAll('.em-topic-row').length >= MAX_TOPICS ? 'block' : 'none';
  }

  async function loadConfig() {
    try {
      const res = await fetch('/ros/emergency-manager-yaml');
      const data = await res.json();
      if (data.success && data.config) {
        const { emergency_di, bool_topics } = data.config;
        if (emergency_di) {
          driverSel.value = String(emergency_di.driver || 2);
          diSel.value = String(emergency_di.di || 2);
        }
        topicsList.innerHTML = '';
        if (Array.isArray(bool_topics)) {
          bool_topics.forEach(t => addTopicRow(t));
        }
      }
    } catch (e) {
      console.error('Failed to load emergency config:', e);
    }
  }

  btn.onclick = () => {
    overlay.style.display = 'flex';
    statusEl.textContent = '';
    loadConfig();
  };

  function closeModal() { overlay.style.display = 'none'; }
  closeBtn.onclick = closeModal;
  cancelBtn.onclick = closeModal;
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

  addTopicBtn.onclick = () => addTopicRow();

  saveBtn.onclick = async () => {
    const driver = parseInt(driverSel.value);
    const di = parseInt(diSel.value);
    const bool_topics = [...topicsList.querySelectorAll('.em-topic-row input')]
      .map(i => i.value.trim())
      .filter(Boolean);

    saveBtn.disabled = true;
    statusEl.style.color = '#cdd6f4';
    statusEl.textContent = 'Saving...';

    try {
      const res = await fetch('/ros/emergency-manager-yaml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver, di, bool_topics })
      });
      const data = await res.json();
      if (data.success) {
        statusEl.style.color = '#a6e3a1';
        statusEl.textContent = '✓ Saved! Reloading node in 500ms...';
        setTimeout(closeModal, 1500);
      } else {
        statusEl.style.color = '#f38ba8';
        statusEl.textContent = 'Error: ' + (data.message || 'Unknown error');
      }
    } catch (e) {
      statusEl.style.color = '#f38ba8';
      statusEl.textContent = 'Network error';
    } finally {
      saveBtn.disabled = false;
    }
  };
})();