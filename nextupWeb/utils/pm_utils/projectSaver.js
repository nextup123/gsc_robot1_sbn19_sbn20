//projectSaver.js

import fs from "fs-extra";
import path from "node:path";
import yaml from "js-yaml";

import { markClean, readSession } from "./dirtyTracker.js";
import { resetDirtyFlag } from "./mutationWatcher.js";

import {
  PROJECTS_ROOT,
  ACTIVE_RUNTIME_PATH,
  USER_CONFIG_ROOT,
  PROJECT_BACKUP_ROOT,
} from "./paths.js";

const ACTIVE_PROJECT_FILE = path.join(
  USER_CONFIG_ROOT,
  "active_project.yaml"
);

const SESSION_FILE = ".session.yaml";

// ---------- Helpers ----------

async function readYamlSafe(filePath) {
  try {
    if (!(await fs.pathExists(filePath))) return null;
    return yaml.load(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function bumpPatchVersion(version = "1.0.0") {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

// ---------- Main Save Logic ----------

async function saveProject({ skipIfClean = false } = {}) {
  // 1️⃣ Identify active project
  const activeData = await readYamlSafe(ACTIVE_PROJECT_FILE);
  const projectName = activeData?.active_project;

  if (!projectName) {
    throw new Error("No active project to save");
  }

  // Backend-side safety net: if the caller explicitly opts in (e.g. the
  // autosave endpoint), skip the whole backup+copy when nothing is dirty.
  // This protects against future frontend regressions re-introducing the
  // "backup folder every 10s" bug, without changing behavior for manual
  // saves (which always save regardless of dirty state).
  if (skipIfClean) {
    const currentSession = await readSession();
    if (!currentSession?.dirty) {
      return { success: true, skipped: true, reason: "not_dirty" };
    }
  }

  const projectPath = path.join(PROJECTS_ROOT, projectName);
  const projectYamlPath = path.join(projectPath, "project.yaml");

  if (!(await fs.pathExists(projectPath))) {
    throw new Error("Active project does not exist");
  }

  if (!(await fs.pathExists(ACTIVE_RUNTIME_PATH))) {
    throw new Error("Active runtime does not exist");
  }

  // 2️⃣ Read project metadata FIRST
  const projectMeta = (await readYamlSafe(projectYamlPath)) || {};

  const oldVersion = projectMeta.project_version || "1.0.0";
  const newVersion = bumpPatchVersion(oldVersion);

  // 3️⃣ Create backup (OUTSIDE project dir)
  const backupPath = path.join(
    PROJECT_BACKUP_ROOT,
    projectName,
    timestamp()
  );

  await fs.ensureDir(backupPath);

  // 4️⃣ Copy project → backup
  await fs.copy(projectPath, backupPath);

  // 5️⃣ Write backup metadata
  const backupMeta = {
    project_name: projectName,
    project_version: newVersion,
    saved_at: new Date().toISOString(),
    saved_by: projectMeta.owner || "unknown",
    reason: "manual_save",
  };

  await fs.writeFile(
    path.join(backupPath, "backup_meta.yaml"),
    yaml.dump(backupMeta),
    "utf8"
  );

  // 6️⃣ Copy runtime → project (exclude session)
  await fs.copy(ACTIVE_RUNTIME_PATH, projectPath, {
    overwrite: true,
    filter: (src) => !src.endsWith(SESSION_FILE),
  });

  // 7️⃣ Update project.yaml
  projectMeta.project_version = newVersion;
  projectMeta.last_modified = new Date().toISOString();

  await fs.writeFile(projectYamlPath, yaml.dump(projectMeta), "utf8");

  // 8️⃣ Mark runtime CLEAN
  const sessionPath = path.join(ACTIVE_RUNTIME_PATH, SESSION_FILE);
  const session = (await readYamlSafe(sessionPath)) || {};

  session.dirty = false;
  session.last_manual_save = new Date().toISOString();

  await fs.writeFile(sessionPath, yaml.dump(session), "utf8");

  await markClean("manual_save");

  resetDirtyFlag();

  return {
    success: true,
    project: projectName,
    new_version: newVersion,
    backup: backupPath,
  };
}

export { saveProject };