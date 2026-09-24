//projectSaver.js

import fs from "fs-extra";
import path from "node:path";
import yaml from "js-yaml";

import {
  PROJECTS_ROOT,
  USER_CONFIG_ROOT,
  ACTIVE_RUNTIME_PATH,
} from "./paths.js";

const ACTIVE_PROJECT_FILE = path.join(
  USER_CONFIG_ROOT,
  "active_project.yaml"
);

async function readYamlSafe(filePath) {
  try {
    if (!(await fs.pathExists(filePath))) return null;
    return yaml.load(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function getActiveProjectName() {
  const data = await readYamlSafe(ACTIVE_PROJECT_FILE);
  return data?.active_project || null;
}

async function getActiveSession() {
  return readYamlSafe(
    path.join(ACTIVE_RUNTIME_PATH, ".session.yaml")
  );
}

async function listProjects() {
  const entries = await fs.readdir(PROJECTS_ROOT, {
    withFileTypes: true,
  });

  const activeProject = await getActiveProjectName();
  const session = await getActiveSession();

  const projects = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const projectName = entry.name;
    const projectPath = path.join(PROJECTS_ROOT, projectName);
    const projectYamlPath = path.join(projectPath, "project.yaml");

    const metadata = await readYamlSafe(projectYamlPath);

    if (!metadata) {
      projects.push({
        name: projectName,
        state: "INVALID",
        error: "Missing or invalid project.yaml",
      });
      continue;
    }

    let state = "IDLE";

    if (projectName === activeProject) {
      state = session?.dirty ? "DIRTY" : "ACTIVE";
    }

    projects.push({
      name: metadata.name,
      owner: metadata.owner,
      description: metadata.description,
      created_at: metadata.created_at,
      last_modified: metadata.last_modified,
      project_type: metadata.project_type,
      project_version: metadata.project_version || "1.0.0",
      robot_model: metadata.robot_model,
      tags: metadata.tags || [],
      state,
    });
  }

  return projects;
}

export { listProjects };