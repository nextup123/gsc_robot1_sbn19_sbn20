import fs from "fs-extra";
import path from "node:path";
import yaml from "js-yaml";

import {
  PROJECT_BACKUP_ROOT,
  ACTIVE_RUNTIME_PATH,
  USER_CONFIG_ROOT,
} from "./paths.js";

import { markDirty } from "./dirtyTracker.js";
import { startMutationWatcher, stopMutationWatcher } from "./mutationWatcher.js";

const ACTIVE_PROJECT_FILE = path.join(
  USER_CONFIG_ROOT,
  "active_project.yaml"
);

async function restoreProjectVersion(projectName, versionId) {
  const backupPath = path.join(
    PROJECT_BACKUP_ROOT,
    projectName,
    versionId
  );

  if (!(await fs.pathExists(backupPath))) {
    throw new Error("Backup version does not exist");
  }

  const tempPath = `${ACTIVE_RUNTIME_PATH}__tmp`;

  // 🛑 Stop watcher BEFORE mutation (important fix)
  stopMutationWatcher();

  await fs.remove(tempPath);
  await fs.copy(backupPath, tempPath);

  const session = {
    project_name: projectName,
    loaded_at: new Date().toISOString(),
    dirty: true,
    restored_from: versionId,
  };

  await fs.writeFile(
    path.join(tempPath, ".session.yaml"),
    yaml.dump(session),
    "utf8"
  );

  // Atomic replace
  await fs.remove(ACTIVE_RUNTIME_PATH);
  await fs.move(tempPath, ACTIVE_RUNTIME_PATH, { overwrite: true });

  await fs.writeFile(
    ACTIVE_PROJECT_FILE,
    yaml.dump({ active_project: projectName }),
    "utf8"
  );

  // Mark dirty AFTER restore
  await markDirty(`restored_from_${versionId}`);

  // 🔁 Restart watcher safely
  await startMutationWatcher();

  return {
    success: true,
    restored_version: versionId,
  };
}

export { restoreProjectVersion };