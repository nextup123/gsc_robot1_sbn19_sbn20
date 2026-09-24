import fs from "fs-extra";
import path from "node:path";
import yaml from "js-yaml";

import { PROJECT_BACKUP_ROOT, PROJECTS_ROOT } from "./paths.js";

async function readYamlSafe(file) {
  try {
    if (!(await fs.pathExists(file))) return null;
    return yaml.load(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function listProjectVersions(projectName) {
  // ---- HEAD version ----
  const projectYamlPath = path.join(
    PROJECTS_ROOT,
    projectName,
    "project.yaml"
  );

  const projectMeta = (await readYamlSafe(projectYamlPath)) || {};
  const currentVersion = projectMeta.project_version || "unknown";

  // ---- Backup dir ----
  const projectBackupDir = path.join(
    PROJECT_BACKUP_ROOT,
    projectName
  );

  if (!(await fs.pathExists(projectBackupDir))) {
    return {
      current_version: currentVersion,
      versions: [],
    };
  }

  const entries = await fs.readdir(projectBackupDir, {
    withFileTypes: true,
  });

  const versions = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const backupPath = path.join(projectBackupDir, entry.name);
    const metaPath = path.join(backupPath, "backup_meta.yaml");

    const meta = await readYamlSafe(metaPath);

    versions.push({
      id: entry.name,
      project_version: meta?.project_version || "unknown",
      saved_at: meta?.saved_at || entry.name,
      saved_by: meta?.saved_by || "unknown",
      is_head: meta?.project_version === currentVersion,
    });
  }

  // ---- Sort (newest first) ----
  versions.sort((a, b) => {
    // Prefer ISO timestamps if available
    const aTime = Date.parse(a.saved_at) || 0;
    const bTime = Date.parse(b.saved_at) || 0;
    return bTime - aTime;
  });

  return {
    current_version: currentVersion,
    versions,
  };
}

export { listProjectVersions };