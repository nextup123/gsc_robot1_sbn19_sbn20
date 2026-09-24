async function refreshActiveProjectName() {
  try {
    const res = await fetch('/api/projects/active');
    const data = await res.json();
    const name = data.active_project || '—';
    document.getElementById('navActiveProjectName').textContent = name;
  } catch {
    document.getElementById('navActiveProjectName').textContent = '—';
  }
}

window.addEventListener("activeProjectChanged", (e) => {
  document.getElementById("navActiveProjectName").textContent = e.detail?.name || "—";
});

// auto-fetch on page load
refreshActiveProjectName();