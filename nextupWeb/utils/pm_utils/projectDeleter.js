import fs from "fs-extra";
import path from "node:path";

import {
  PROJECTS_ROOT,
  USER_CONFIG_ROOT,
} from "./paths.js";

import { readActiveProjectName } from "./projectLoader.js";

// define missing constant (this was dangling in your snippet)
const ACTIVE_PROJECT_FILE = path.join(
  USER_CONFIG_ROOT,
  "active_project.yaml"
);

async function deleteProject(name) {
  if (!name) throw new Error("Project name required");

  const projectPath = path.join(PROJECTS_ROOT, name);

  if (!(await fs.pathExists(projectPath))) {
    throw new Error("Project does not exist");
  }

  // 🚨 Check if active
  const active = await readActiveProjectName();

  if (active?.active_project === name) {
    // Reset active project
    await fs.writeFile(
      ACTIVE_PROJECT_FILE,
      "active_project: null\n",
      "utf-8"
    );
  }

  // 🗑️ Delete project folder
  await fs.remove(projectPath);

  return { success: true, deleted: name };
}

export { deleteProject }; 