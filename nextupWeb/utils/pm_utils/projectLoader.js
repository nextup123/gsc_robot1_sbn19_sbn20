//projectLoader.js


import fs from "fs-extra";
import path from "node:path";
import yaml from "js-yaml";

import {
  PROJECTS_ROOT,
  ACTIVE_RUNTIME_PATH,
  USER_CONFIG_ROOT,
} from "./paths.js";

import { initSession, readSession } from "./dirtyTracker.js";
import {
  startMutationWatcher,
  stopMutationWatcher,
} from "./mutationWatcher.js";

import eventBus from "./eventBus.js";

const ACTIVE_PROJECT_FILE = path.join(
  USER_CONFIG_ROOT,
  "active_project.yaml"
);

const SESSION_FILE = ".session.yaml";

async function readYamlSafe(filePath) {
  try {
    if (!(await fs.pathExists(filePath))) return null;
    return yaml.load(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function loadProject(projectName, { force = false } = {}) {
  const projectPath = path.join(PROJECTS_ROOT, projectName);

  // 1️⃣ Validate project exists
  if (!(await fs.pathExists(projectPath))) {
    throw new Error("Project does not exist");
  }

  const projectYamlPath = path.join(projectPath, "project.yaml");
  const projectMeta = await readYamlSafe(projectYamlPath);

  if (!projectMeta) {
    throw new Error("Invalid project (missing project.yaml)");
  }

  // 2️⃣ Dirty check
  const sessionPath = path.join(ACTIVE_RUNTIME_PATH, SESSION_FILE);
  const currentSession = await readYamlSafe(sessionPath);

  if (currentSession?.dirty && !force) {
    throw new Error("Active project has unsaved changes");
  }

  await stopMutationWatcher();
  await new Promise(resolve => setTimeout(resolve, 300)); // drain chokidar event queue

  // 4️⃣ Prepare temp directory
  const tempPath = `${ACTIVE_RUNTIME_PATH}__tmp`;
  await fs.remove(tempPath);
  await fs.copy(projectPath, tempPath);

  // 5️⃣ Atomic replace runtime
  await fs.remove(ACTIVE_RUNTIME_PATH);
  await fs.move(tempPath, ACTIVE_RUNTIME_PATH, { overwrite: true });

  // 6️⃣ Update active_project.yaml
  await fs.writeFile(ACTIVE_PROJECT_FILE, yaml.dump({ active_project: projectName }), "utf8");

  // 7️⃣ Initialize clean session — now safe, no dirty writes pending
  await initSession(projectName);

  // 8️⃣ Restart watcher
  await startMutationWatcher();

  return { success: true, project: projectName, forced: force };
}

// Read active project name
async function readActiveProjectName() {
  try {
    if (!(await fs.pathExists(ACTIVE_PROJECT_FILE))) {
      return null;
    }

    const data = await fs.readFile(ACTIVE_PROJECT_FILE, "utf-8");
    return yaml.load(data) || {};
  } catch (err) {
    console.error("Failed to read active project:", err);
    throw err;
  }
}

// Read active project data
async function readActiveProjectData(projectName) {
  try {
    const projectDataPath = path.join(PROJECTS_ROOT, projectName);
    const projectFilePath = path.join(projectDataPath, "project.yaml");

    if (!(await fs.pathExists(projectFilePath))) {
      return null;
    }

    const projectData = await fs.readFile(projectFilePath, "utf-8");

    return yaml.load(projectData) || {};
  } catch (error) {
    console.error("Failed to read active project:", error);
    throw error;
  }
}

export {
  loadProject,
  readActiveProjectName,
  readActiveProjectData,
};