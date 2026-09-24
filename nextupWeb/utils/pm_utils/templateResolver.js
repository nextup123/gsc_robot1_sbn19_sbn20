// utils/templateResolver.js

import fs from "fs-extra";
import path from "node:path";

import { TEMPLATE_PATH, ACTIVE_RUNTIME_PATH } from "./paths.js";

async function loadProjectTemplate() {
  return fs.readJson(TEMPLATE_PATH);
}

async function resolveTrackedPaths() {
  const template = await loadProjectTemplate();

  const tracked = new Set();

  // directories (top-level)
  // NOTE: template entries are bare relative names (e.g. "points"), so they
  // must be joined to ACTIVE_RUNTIME_PATH here. Previously these were left
  // relative and later resolved against process.cwd() by mutationWatcher,
  // which never matched the real (absolute) paths chokidar reports — that
  // silently broke all dirty-on-external-mutation detection.
  for (const dir of template.directories || []) {
    tracked.add(path.join(ACTIVE_RUNTIME_PATH, dir));
  }

  // files inside directories
  for (const [dir, files] of Object.entries(template.files || {})) {
    if (dir === "root") continue;

    // track directory itself
    tracked.add(path.join(ACTIVE_RUNTIME_PATH, dir));

    // OPTIONAL (more granular tracking if needed later)
    // for (const file of Object.keys(files || {})) {
    //   tracked.add(path.join(ACTIVE_RUNTIME_PATH, dir, file));
    // }
  }

  // root-level files
  for (const file of Object.keys(template.files?.root || {})) {
    tracked.add(path.join(ACTIVE_RUNTIME_PATH, file));
  }

  return Array.from(tracked);
}

export { resolveTrackedPaths };