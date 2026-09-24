/* ============================================================
   PROJECT MANAGER — app.js
   Fixes applied:
   - Removed duplicate SSE logic (uses api.connectSessionStream)
   - Fixed confirmModal references (single modal used everywhere)
   - Fixed inputModal desc field show/hide
   - Save As now activates the new project
   - showDirtySwitchConfirm properly resets button labels
   - Search filter connected and working
   New features:
   - View toggle (grid / list)
   - Search with live filter
   - Version history modal
   - Rename project
   - SSE connection status indicator
   ============================================================ */

// =========================
// DOM REFS
// =========================
const projectDetailsEl = document.getElementById("projectDetails");
const projectListEl = document.getElementById("projectList");
const projectCount = document.getElementById("projectCount");
const sseStatusDot = document.querySelector(".status-dot");
const searchInput = document.getElementById("searchInput");
const searchClear = document.getElementById("searchClear");
const defaultNewProject = document.querySelector(".default-project-btn");
const blankProjectBtn = document.querySelector(".blank-project-btn");

// View toggle
const viewGridBtn = document.getElementById("viewGrid");
const viewListBtn = document.getElementById("viewList");

// =========================
// STATE
// =========================
const projectStates = {}; // { [projectName]: { state, reason } }

const state = {
  projects: [],
  activeProject: null,
  sortBy: "name",
  viewMode: "grid",   // "grid" | "list"
  searchQuery: "",
};

// =========================
// INIT
// =========================
init();

async function init() {
  await loadActiveProject();
  await loadProjects();

  // Ensure active project badge is seeded
  const active = state.activeProject?.name;
  if (active) {
    projectStates[active] = projectStates[active] || {
      project: active,
      state: state.activeProject.is_dirty ? "DIRTY" : "Active",
      reason: state.activeProject.is_dirty ? "unsaved_changes" : "manual_save",
    };
  }

  initSortControls();
  initViewToggle();
  initSearch();
  renderProjectList();
  startSSE();
}

// =========================
// SSE
// =========================
function startSSE() {
  const evtSource = api.connectSessionStream((parsed) => {
    // CHECKPOINT 4 — confirm the browser is actually receiving the
    // session:update event over SSE. If checkpoints 1-3 in
    // mutationWatcher.js all fired correctly (dirty was triggered
    // server-side) but nothing logs here, the break is in the
    // eventBus emit → SSE stream → EventSource path, not dirty tracking.
    
    if (parsed.project) {
      projectStates[parsed.project] = parsed;
      renderProjectList();
    }
  });

  // track connection state
  evtSource.onopen = () => setSseDot("connected");
  evtSource.onerror = () => setSseDot("error");
}

function setSseDot(status) {
  if (!sseStatusDot) return;
  sseStatusDot.className = "status-dot";
  if (status === "connected") sseStatusDot.classList.add("connected");
  if (status === "error") sseStatusDot.classList.add("error");
}

// =========================
// SORT
// =========================
function initSortControls() {
  document.querySelectorAll(".sort-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".sort-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.sortBy = btn.dataset.sort;
      renderProjectList();
    });
  });
}

// =========================
// VIEW TOGGLE
// =========================
function initViewToggle() {
  viewGridBtn?.addEventListener("click", () => {
    state.viewMode = "grid";
    viewGridBtn.classList.add("active");
    viewListBtn.classList.remove("active");
    projectListEl.classList.remove("list-view");
    renderProjectList();
  });

  viewListBtn?.addEventListener("click", () => {
    state.viewMode = "list";
    viewListBtn.classList.add("active");
    viewGridBtn.classList.remove("active");
    projectListEl.classList.add("list-view");
    renderProjectList();
  });
}

// =========================
// SEARCH
// =========================
function initSearch() {
  searchInput?.addEventListener("input", (e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    searchClear?.classList.toggle("hidden", !state.searchQuery);
    renderProjectList();
  });

  searchClear?.addEventListener("click", () => {
    searchInput.value = "";
    state.searchQuery = "";
    searchClear.classList.add("hidden");
    searchInput.focus();
    renderProjectList();
  });
}

// =========================
// LOAD ACTIVE PROJECT
// =========================
async function loadActiveProject() {
  try {
    const res = await api.readActiveProjectName();

    if (!res.ok || !res.data?.active_project) {
      state.activeProject = null;
      renderProject(null);
      return;
    }

    const activeName = res.data.active_project;
    const activeProjectData = await api.loadActive(activeName);

    if (!activeProjectData.ok) throw new Error("Failed to load active project data");

    state.activeProject = activeProjectData.data;
    renderProject(state.activeProject);
  } catch (err) {
    console.error("Failed to load active project:", err);
    state.activeProject = null;
    renderProject(null);
  }
}

// =========================
// LOAD PROJECT LIST
// =========================
async function loadProjects() {
  try {
    const res = await api.list();
    state.projects = res.projects || res || [];
    projectCount.innerText = `${state.projects.length} project${state.projects.length !== 1 ? "s" : ""}`;
  } catch (err) {
    console.error("Failed to load projects:", err);
    state.projects = [];
  }
}

// =========================
// RENDER ACTIVE PROJECT
// =========================
function renderProject(project) {
  if (!project) {
    projectDetailsEl.innerHTML = `<div class="no-project-msg">No active project selected</div>`;
    return;
  }

  const fields = [
    ["Name", project.name],
    ["Owner", project.owner],
    ["Type", project.project_type],
    ["Created", formatDate(project.created_at)],
    ["Modified", formatDate(project.last_modified)],
    // ["Status",   project.is_dirty ? "● Unsaved" : "● Saved"],
  ];

  projectDetailsEl.innerHTML = `
    <div class="project-details-inline">
      ${fields.map(([label, value]) => `
        <div class="field">
          <div class="label">${label}</div>
          <div class="value" title="${escapeHtml(String(value || "—"))}">${escapeHtml(String(value || "—"))}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatStructuredDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d)) return "—";
  return d.toLocaleString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

// =========================
// RENDER PROJECT LIST
// =========================
function renderProjectList() {
  projectListEl.innerHTML = "";

  // Apply list-view class based on state
  projectListEl.classList.toggle("list-view", state.viewMode === "list");

  // Filter
  let filtered = state.projects;
  if (state.searchQuery) {
    filtered = filtered.filter((p) => {
      const q = state.searchQuery;
      return (
        (p.name || "").toLowerCase().includes(q) ||
        (p.owner || "").toLowerCase().includes(q) ||
        (p.project_type || "").toLowerCase().includes(q) ||
        (p.description || "").toLowerCase().includes(q)
      );
    });
  }

  if (!filtered.length) {
    projectListEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${state.searchQuery ? "🔍" : "📭"}</div>
        <p>${state.searchQuery ? "No matches found" : "No projects yet"}</p>
        <span>${state.searchQuery ? `No projects match "${escapeHtml(state.searchQuery)}"` : 'Click "New Project" to get started'}</span>
      </div>
    `;
    return;
  }

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    switch (state.sortBy) {
      case "name": return (a.name || "").localeCompare(b.name || "");
      case "date": return new Date(b.last_modified || 0) - new Date(a.last_modified || 0);
      case "created": return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      default: return 0;
    }
  });

  sorted.forEach((proj) => {
    const isActive = state.activeProject && proj.name === state.activeProject.name;
    const card = document.createElement("div");
    card.className = "project-card" + (isActive ? " active" : "");

    const name = proj.name || "Untitled";
    const owner = proj.owner || "Unknown";
    const type = proj.project_type || "Default";
    const modified = formatStructuredDate(proj.last_modified);

    let badgeHTML = "";
    if (projectStates[proj.name]?.state === "DIRTY") {
      badgeHTML = `<span class="active-badge dirty">● Unsaved</span>`;
    } else if (isActive) {
      badgeHTML = `<span class="active-badge active">● Active</span>`;
    }

    card.innerHTML = `
      <div class="card-inner">
        <div class="card-header">
          <div class="project-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
          ${badgeHTML}
        </div>
        <div class="project-metadata">
          <span title="Owner">👤 ${escapeHtml(owner)}</span>
          <span title="Type">📦 ${escapeHtml(type)}</span>
        </div>
        <div class="date-section" title="Last modified">${modified}</div>
        <div class="card-actions">
          <button class="action-btn primary set-default-btn"   ${isActive ? 'disabled title="Already active"' : ''}>Load</button>
          <button class="action-btn rename-btn">Rename</button>
          <button class="action-btn copy-btn">Copy</button>
          <button class="action-btn version-btn" style="display:none;">History</button>
          <button class="action-btn danger delete-btn"         ${isActive ? 'disabled title="Cannot delete the active project"' : ''}>Delete</button>
          </div>
          </div>
          `;

    // ---- Load ----
    card.querySelector(".set-default-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      const activeName = state.activeProject?.name;
      const isDirty = activeName && projectStates[activeName]?.state === "DIRTY";

      if (isDirty) {
        const choice = await showDirtySwitchConfirm(proj.name);
        if (!choice) return;

        if (choice === "save") {
          await api.save();
          await setAsDefaultProject(proj.name);
        } else {
          // discard
          await api.overwrite(proj.name);
          await loadActiveProject();
          await loadProjects();
          renderProjectList();
        }
      } else {
        const ok = await showConfirm({
          title: "Set Active Project",
          message: `Make "${proj.name}" the active project?`,
        });
        if (!ok) return;
        await setAsDefaultProject(proj.name);
      }
    });

    // ---- Copy ----
    card.querySelector(".copy-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      openCopyProjectModal(proj);
    });

    // ---- Version History ----
    card.querySelector(".version-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      openVersionModal(proj.name);
    });

    // ---- Rename ----
    card.querySelector(".rename-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      openRenameModal(proj);
    });

    // ---- Delete ----
    card.querySelector(".delete-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (isActive) return;

      const ok = await showConfirm({
        title: "Delete Project",
        message: `Delete "${proj.name}" permanently? This cannot be undone.`,
      });
      if (!ok) return;

      try {
        await api.deleteProject(proj.name);
        showNotification(`"${proj.name}" deleted`);
        delete projectStates[proj.name];
        await loadProjects();
        renderProjectList();
      } catch (err) {
        console.error(err);
        showNotification("Delete failed", "error");
      }
    });

    projectListEl.appendChild(card);
  });
}

// =========================
// SET AS DEFAULT
// =========================
async function setAsDefaultProject(projectName) {
  try {
    const res = await api.load(projectName);
    if (!res.ok) throw new Error();

    showNotification(`"${projectName}" is now active`);

    // ── Notify the parent shell to reload all data pages ──────────
    // Uses postMessage so it works regardless of same/cross origin.
    window.parent.postMessage(
      { type: "projectLoaded", name: projectName },
      "*"
    );

    await loadActiveProject();
    await loadProjects();
    renderProjectList();
  } catch {
    showNotification("Failed to set active project", "error");
  }
}



// =========================
// COPY PROJECT
// =========================

async function copyProject(sourceProject, newName, owner, description) {
  try {
    // ── Call the REAL copy endpoint ──────────────────────────────
    // This physically duplicates the source project's files on disk,
    // strips .session.yaml, and writes a fresh project.yaml.
    const res = await api.copy(sourceProject.name, {
      name: newName,
      owner: owner || sourceProject.owner || "Anonymous",
      description: description || `Copy of ${sourceProject.name}`,
    });

    if (!res.ok || res.data?.success === false) {
      // Surface a meaningful error if the name already exists
      const msg = res.data?.error || "Copy failed";
      throw new Error(msg);
    }

    showNotification(`"${newName}" created as a copy of "${sourceProject.name}"`);
    await loadProjects();
    renderProjectList();

  } catch (err) {
    console.error("[copyProject]", err);
    // Give the user a specific message for the most common failure
    const msg = err.message?.includes("already exists")
      ? `A project named "${newName}" already exists`
      : "Copy failed — please try again";
    showNotification(msg, "error");
  }
}

async function openCopyProjectModal(project) {
  const result = await showInput({
    title: `Duplicate "${project.name}"`,
    defaultValue: `${project.name} (copy)`,
    placeholder: "Enter new project name",
    defaultOwner: project.owner || "",
    showDesc: true,
  });

  if (!result || !result.name) return;

  // Guard: don't allow copying onto itself
  if (result.name.trim() === project.name) {
    showNotification("New name must be different from the source", "error");
    return;
  }

  copyProject(project, result.name.trim(), result.owner, result.description);
}

// =========================
// RENAME
// =========================
async function openRenameModal(project) {
  const modal = document.getElementById("renameModal");
  const field = document.getElementById("renameField");
  const okBtn = document.getElementById("renameOk");
  const cancelBtn = document.getElementById("renameCancel");
  const closeBtn = document.getElementById("renameModalClose");

  field.value = project.name;
  modal.classList.add("active");
  setTimeout(() => { field.focus(); field.select(); }, 50);

  return new Promise((resolve) => {
    function cleanup(result) {
      modal.classList.remove("active");
      okBtn.removeEventListener("click", okHandler);
      cancelBtn.removeEventListener("click", cancelHandler);
      closeBtn.removeEventListener("click", cancelHandler);
      modal.removeEventListener("click", outsideHandler);
      resolve(result);
    }

    function outsideHandler(e) {
      if (e.target === modal) cleanup(null);
    }

    async function okHandler() {
      const newName = field.value.trim();

      if (!newName) { field.focus(); return; }
      if (newName === project.name) { cleanup(null); return; }

      okBtn.disabled = true;
      okBtn.textContent = "Renaming…";

      try {
        const res = await api.rename(project.name, newName);

        if (!res.ok) {
          const msg = res.data?.error || "Rename failed";
          showNotification(msg, "error");
          return;
        }

        // Keep projectStates in sync
        if (projectStates[project.name]) {
          projectStates[newName] = { ...projectStates[project.name], project: newName };
          delete projectStates[project.name];
        }

        // If renamed project was active, reload under new name
        const wasActive = state.activeProject?.name === project.name;
        if (wasActive) await setAsDefaultProject(newName);

        showNotification(`Renamed to "${newName}"`);
        await loadProjects();
        await loadActiveProject();
        renderProjectList();
        cleanup(newName);

      } catch (err) {
        console.error("[openRenameModal]", err);
        showNotification("Rename failed", "error");
      } finally {
        okBtn.disabled = false;
        okBtn.textContent = "Rename";
      }
    }

    function cancelHandler() { cleanup(null); }

    okBtn.addEventListener("click", okHandler);
    cancelBtn.addEventListener("click", cancelHandler);
    closeBtn.addEventListener("click", cancelHandler);
    modal.addEventListener("click", outsideHandler);
  });
}

// =========================
// VERSION HISTORY
// =========================
async function openVersionModal(projectName) {
  const modal = document.getElementById("versionModal");
  const listEl = document.getElementById("versionList");
  const labelEl = document.getElementById("versionProjectLabel");
  const closeBtn = document.getElementById("versionModalClose");

  labelEl.innerText = projectName;
  listEl.innerHTML = `<div class="version-loading">Loading versions…</div>`;
  modal.classList.add("active");

  // Close handler
  const closeHandler = () => {
    modal.classList.remove("active");
    closeBtn.removeEventListener("click", closeHandler);
  };
  closeBtn.addEventListener("click", closeHandler);

  // Outside click
  const outsideHandler = (e) => {
    if (e.target === modal) {
      modal.classList.remove("active");
      modal.removeEventListener("click", outsideHandler);
    }
  };
  modal.addEventListener("click", outsideHandler);

  try {
    const res = await api.listVersions(projectName);

    if (!res.ok || !res.data || !res.data.length) {
      listEl.innerHTML = `<div class="version-empty">No version history available for this project.</div>`;
      return;
    }

    const versions = res.data;
    listEl.innerHTML = "";

    versions.forEach((v) => {
      const item = document.createElement("div");
      item.className = "version-item";
      item.innerHTML = `
        <div class="version-meta">
          <span class="version-id">${escapeHtml(v.versionId || v.id || "—")}</span>
          <span class="version-date">${formatDate(v.timestamp || v.created_at)}</span>
        </div>
        <button class="version-restore-btn">Restore</button>
      `;

      item.querySelector(".version-restore-btn").addEventListener("click", async () => {
        const ok = await showConfirm({
          title: "Restore Version",
          message: `Restore "${projectName}" to version ${v.versionId || v.id}? Unsaved changes will be lost.`,
        });
        if (!ok) return;

        try {
          const r = await api.restoreVersion(projectName, v.versionId || v.id);
          if (!r.ok) throw new Error();
          showNotification(`Version restored`);
          modal.classList.remove("active");
          await loadActiveProject();
          await loadProjects();
          renderProjectList();
        } catch {
          showNotification("Restore failed", "error");
        }
      });

      listEl.appendChild(item);
    });
  } catch (err) {
    console.error(err);
    listEl.innerHTML = `<div class="version-empty">Failed to load version history.</div>`;
  }
}

// =========================
// NOTIFICATION
// =========================
function showNotification(message, type = "success") {
  const existing = document.querySelector(".global-toast");
  existing?.remove();

  const toast = document.createElement("div");
  toast.className = `global-toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 2800);
}

// =========================
// ESCAPE HTML
// =========================
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// =========================
// UNIVERSAL CONFIRM MODAL
// =========================
function showConfirm({ title, message }) {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirmDefaultModal");
    const titleEl = document.getElementById("confirmTitle");
    const msgEl = document.getElementById("confirmMessage");
    const okBtn = document.getElementById("confirmOk");
    const cancelBtn = document.getElementById("confirmCancel");

    titleEl.innerText = title;
    msgEl.innerText = message;
    okBtn.innerText = "Confirm";
    cancelBtn.innerText = "Cancel";

    modal.classList.add("active");

    function cleanup(result) {
      modal.classList.remove("active");
      okBtn.removeEventListener("click", okHandler);
      cancelBtn.removeEventListener("click", cancelHandler);
      resolve(result);
    }

    function okHandler() { cleanup(true); }
    function cancelHandler() { cleanup(false); }

    okBtn.addEventListener("click", okHandler);
    cancelBtn.addEventListener("click", cancelHandler);
  });
}

// =========================
// DIRTY SWITCH CONFIRM
// =========================
function showDirtySwitchConfirm(targetName) {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirmDefaultModal");
    const titleEl = document.getElementById("confirmTitle");
    const msgEl = document.getElementById("confirmMessage");
    const okBtn = document.getElementById("confirmOk");
    const cancelBtn = document.getElementById("confirmCancel");
    const actionsEl = document.getElementById("confirmActions");

    titleEl.innerText = "Unsaved Changes";
    msgEl.innerText = `You have unsaved changes. What would you like to do before switching to "${targetName}"?`;
    okBtn.innerText = "Save & Load";
    cancelBtn.innerText = "Discard & Load";

    // Add a true Cancel button
    const trueCancel = document.createElement("button");
    trueCancel.innerText = "Cancel";
    trueCancel.className = "btn-cancel";
    actionsEl.prepend(trueCancel);

    modal.classList.add("active");

    function cleanup(result) {
      modal.classList.remove("active");
      okBtn.innerText = "Confirm";
      cancelBtn.innerText = "Cancel";
      okBtn.removeEventListener("click", saveHandler);
      cancelBtn.removeEventListener("click", discardHandler);
      trueCancel.removeEventListener("click", cancelHandler);
      trueCancel.remove();
      resolve(result);
    }

    function saveHandler() { cleanup("save"); }
    function discardHandler() { cleanup("discard"); }
    function cancelHandler() { cleanup(null); }

    okBtn.addEventListener("click", saveHandler);
    cancelBtn.addEventListener("click", discardHandler);
    trueCancel.addEventListener("click", cancelHandler);
  });
}

// =========================
// INPUT MODAL
// =========================
const inputModal = document.getElementById("inputModal");
const inputTitle = document.getElementById("inputTitle");
const inputField = document.getElementById("inputField");
const inputOk = document.getElementById("inputOk");
const inputCancel = document.getElementById("inputCancel");
const inputOwnerField = document.getElementById("inputOwnerField");
const inputDescField = document.getElementById("inputDescField");
const inputDescGroup = document.getElementById("inputDescGroup");
const inputModalClose = document.getElementById("inputModalClose");

function showInput({ title = "Enter value", defaultValue = "", placeholder = "", defaultOwner = "", showDesc = false }) {
  return new Promise((resolve) => {
    inputTitle.innerText = title;
    inputField.value = defaultValue;
    inputField.placeholder = placeholder || "Enter name…";
    inputOwnerField.value = defaultOwner;
    inputDescGroup.style.display = showDesc ? "flex" : "none";
    inputDescField.value = "";

    inputModal.classList.add("active");
    setTimeout(() => { inputField.focus(); inputField.select(); }, 50);

    function cleanup(result) {
      inputModal.classList.remove("active");
      inputOk.removeEventListener("click", okHandler);
      inputCancel.removeEventListener("click", cancelHandler);
      inputModalClose?.removeEventListener("click", cancelHandler);
      resolve(result);
    }

    function okHandler() {
      const name = inputField.value.trim();
      if (!name) { inputField.focus(); return; }
      cleanup({
        name,
        owner: inputOwnerField.value.trim(),
        description: inputDescField.value.trim(),
      });
    }

    function cancelHandler() { cleanup(null); }

    inputOk.addEventListener("click", okHandler);
    inputCancel.addEventListener("click", cancelHandler);
    inputModalClose?.addEventListener("click", cancelHandler);
  });
}

// =========================
// CREATE PROJECT MODAL
// =========================
(function () {
  const modal = document.getElementById("createProjectModal");
  const openBtn = document.querySelector(".create-project-btn");
  const form = document.getElementById("createProjectForm");
  const cancelBtn = document.getElementById("closeModal");
  const cancelBtn2 = document.getElementById("closeModalCancel");
  const nameInput = document.getElementById("projectName");
  const ownerInput = document.getElementById("projectOwner");
  const descInput = document.getElementById("projectDescription");
  const typeInput = document.getElementById("projectType");

  if (!modal) return;

  const open = () => modal.classList.add("active");
  const close = () => { modal.classList.remove("active"); form.reset(); };

  openBtn?.addEventListener("click", open);
  cancelBtn?.addEventListener("click", close);
  cancelBtn2?.addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }

    try {
      const payload = {
        name,
        owner: ownerInput.value.trim() || "Anonymous",
        description: descInput.value.trim(),
        project_type: typeInput.value,
        created_at: new Date().toISOString(),
        last_modified: new Date().toISOString(),
      };

      const res = await api.create(payload);
      if (!res || res.success === false) throw new Error();

      close();
      showNotification(`"${name}" created`);
      await loadProjects();
      renderProjectList();
    } catch (err) {
      console.error(err);
      showNotification("Failed to create project", "error");
    }
  });
})();

// =========================
// SAVE PROJECT
// =========================
document.querySelector(".save-project-btn")?.addEventListener("click", async (e) => {
  e.stopPropagation();

  if (!state.activeProject) {
    showNotification("No active project to save", "error");
    return;
  }

  const ok = await showConfirm({
    title: "Save Project",
    message: `Save changes to "${state.activeProject.name}"?`,
  });
  if (!ok) return;

  try {
    await api.save();
    if (state.activeProject?.name) {
      projectStates[state.activeProject.name] = { project: state.activeProject.name, state: "Active", reason: "manual_save" };
    }
    showNotification("Project saved");
    await loadActiveProject();
    await loadProjects();
    renderProjectList();
  } catch (err) {
    console.error(err);
    showNotification("Save failed", "error");
  }
});

// =========================
// SAVE AS
// =========================
document.querySelector(".save-as-btn")?.addEventListener("click", async () => {
  const result = await showInput({
    title: "Save As New Project",
    defaultValue: state.activeProject?.name ? `${state.activeProject.name}_copy` : "",
    placeholder: "Enter project name…",
    defaultOwner: state.activeProject?.owner || "Nextup",
    showDesc: true,
  });

  if (!result || !result.name) return;

  try {
    const payload = {
      name: result.name,
      owner: result.owner || state.activeProject?.owner || "Nextup",
      description: result.description || state.activeProject?.description || "",
      project_type: state.activeProject?.project_type || "standard",
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    };

    const res = await api.create(payload);
    if (!res || res.success === false) throw new Error();

    // Activate the new project
    await setAsDefaultProject(result.name);
    showNotification(`"${result.name}" saved and activated`);
  } catch (err) {
    console.error(err);
    showNotification("Save As failed", "error");
  }
});

// =========================
// DEFAULT PROJECT
// =========================
defaultNewProject?.addEventListener("click", async () => {
  const ok = await showConfirm({
    title: "Create Default Project",
    message: "Create a new project with default settings and set it as active?",
  });
  if (!ok) return;
  createDefaultProject();
});

async function createDefaultProject() {
  try {
    const name = `Default ${Date.now().toString().slice(-4)}`;
    const payload = {
      name,
      owner: "Nextup",
      description: "Default template project",
      project_type: "standard",
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    };

    const res = await api.create(payload);
    if (!res || res.success === false) throw new Error();

    await api.load(name);
    showNotification(`"${name}" created and activated`);
    await loadProjects();
    await loadActiveProject();
    renderProjectList();
    await setAsDefaultProject(name);
  } catch (err) {
    console.error(err);
    showNotification("Default project creation failed", "error");
  }
}

// =========================
// BLANK PROJECT
// =========================
blankProjectBtn?.addEventListener("click", async () => {
  const ok = await showConfirm({
    title: "Create Blank Project",
    message: "Create an empty project with no defaults?",
  });
  if (!ok) return;
  createBlankProject();
});

async function createBlankProject() {
  try {
    const name = generateBlankName();
    const payload = {
      name,
      owner: "Nextup",
      description: "Blank project",
      project_type: "blank",
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    };

    const res = await api.create(payload);
    if (!res || res.success === false) throw new Error();

    await api.load(name);
    showNotification(`"${name}" created and activated`);
    await loadProjects();
    await loadActiveProject();
    renderProjectList();
  } catch (err) {
    console.error(err);
    showNotification("Blank project creation failed", "error");
  }
}

function generateBlankName() {
  let i = 1;
  let name;
  do { name = `Blank ${i}`; i++; }
  while (state.projects.some((p) => p.name === name));
  return name;
}

let isSaving = false;
setInterval(async () => {
  const activeName = state.activeProject?.name;
  const isDirty = activeName && projectStates[activeName]?.state === "DIRTY";

  // console.log("Is Dirty:",isDirty,"isSaving:",isSaving,"Active Project:",!state.activeProject);
  // Only autosave when there's actually something dirty to save — without
  // this check, api.save() (and the backup folder it creates) fired every
  // 10s regardless of state, which is what was flooding .project_backups.
  if (!state.activeProject || isSaving || !isDirty) return;
  isSaving = true;
  try {

    await api.save(true);

    if (state.activeProject?.name) {
      projectStates[state.activeProject.name] = { project: state.activeProject.name, state: "Active", reason: "auto_save", };
    } // optional: keep silent or very subtle

    showNotification("Auto Saved Project", "success");
  } catch (err) {
    console.error(err);
    showNotification("Auto Save failed", "error");
  } finally {
    isSaving = false;

  }
}, 10000);