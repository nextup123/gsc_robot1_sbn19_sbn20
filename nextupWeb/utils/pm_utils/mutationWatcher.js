//mutationWater.js

import chokidar from "chokidar";
import path from "node:path";
import fs from "node:fs";

import { ACTIVE_RUNTIME_PATH } from "./paths.js";
import { markDirty } from "./dirtyTracker.js";
import { resolveTrackedPaths } from "./templateResolver.js";

import { createLogger } from '../../utils/logger.js';

const log = createLogger('utils/pm_utils', 'mutationWatcher.js');

let watcher = null;
let watcherActive = false;
let trackedPaths = [];
let dirtyTriggered = false;

// ignored noise
const IGNORED_PATTERNS = [".session.yaml", "project.yaml", ".swp", ".tmp", "~","logs.json"];

function isIgnored(filePath) {
  const base = path.basename(filePath);
  return IGNORED_PATTERNS.some((p) => base === p || base.endsWith(p));
}

function isTracked(filePath) {
  const normalized = path.resolve(filePath);
  return trackedPaths.some((tracked) => {
    if (normalized === tracked) return true;
    // also match files/subfolders *inside* a tracked directory, e.g.
    // tracked "<runtime>/points" should match "<runtime>/points/points.yaml"
    const rel = path.relative(tracked, normalized);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  });
}
function getWatcherStatus() {
  return {
    active: watcherActive,
    watchingPath: ACTIVE_RUNTIME_PATH,
    trackedPaths,
    watcherInitialized: !!watcher,
  };
}

async function startMutationWatcher() {
  if (watcherActive) {
    log.info("[WATCHER] already active");
    return;
  }

  log.info("[WATCHER] starting...");


  // resolveTrackedPaths() now returns paths already joined to
  // ACTIVE_RUNTIME_PATH, so path.resolve() here is just normalization
  // (e.g. collapsing "..") — it no longer resolves against process.cwd().
  trackedPaths = (await resolveTrackedPaths()).map((p) =>
    path.resolve(p)
  );

  // CHECKPOINT 1 — confirm the watcher actually knows what to track.
  // If this list is empty, or doesn't include the folder points.yaml
  // lives in, nothing downstream will ever work.
  log.info("[WATCHER] tracked paths:", trackedPaths);

  watcher = chokidar.watch(ACTIVE_RUNTIME_PATH, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100,
    },
  });

  watcher.on("ready", () => {
    log.info("[WATCHER] ready");
  });

  watcher.on("error", (err) => {
    log.error({ err }, "[WATCHER] ready");

  });

  watcher.on("all", (event, filePath) => {
    // CHECKPOINT 2 — confirm chokidar is even seeing the file system event
    // at all. If nothing prints here when you save points.yaml, the
    // problem is chokidar/OS-level (wrong path being watched, permissions,
    // editor writing via a temp-file+rename that chokidar is missing),
    // not the dirty-tracking logic below.
    log.info(`[CHOKIDAR EVENT] ${event}: ${filePath}`);
  });

  const handleChange = async (filePath) => {
    const absPath = path.resolve(filePath);
    if (isIgnored(absPath)) {
      // CHECKPOINT 3a — event arrived, but got filtered as noise.
      // log.info(`[IGNORED] : ${absPath}`);
      return;
    }

    if (!isTracked(absPath)) {
      // CHECKPOINT 3b — event arrived, wasn't ignored, but didn't match
      // any tracked path. Compare this absPath against the list printed
      // at CHECKPOINT 1 — if it should match and doesn't, isTracked() or
      // resolveTrackedPaths() still has a bug.
      log.info(`[NOT TRACKED] : ${absPath}`);
      return;
    }

    if (dirtyTriggered) {
      log.info("[ALREADY DIRTY - SKIPPING]");
      return;
    }

    dirtyTriggered = true;

    log.info(`"[DIRTY TRIGGERED]:${absPath}`);

    await markDirty("external_mutation");

    // stopMutationWatcher();
  };

  watcher.on("add", handleChange);

  watcher.on("change", async (filePath) => {
    await handleChange(filePath);
  });
  
  watcher.on("unlink", handleChange);

  watcherActive = true;
  dirtyTriggered = false;

  log.info("[WATCHER] ACTIVE:", watcherActive);

}

// mutationWatcher.js — make stopMutationWatcher async and awaitable
async function stopMutationWatcher() {
  if (watcher) {
    await watcher.close();  // ← await this
    log.info("[WATCHER] stopped");
  }
  watcher = null;
  watcherActive = false;
  dirtyTriggered = false;   // ← also reset dirty flag here
}

function resetDirtyFlag() {
  // log.info("[WATCHER] resetting dirty flag");
  dirtyTriggered = false;
}

export {
  startMutationWatcher,
  stopMutationWatcher,
  getWatcherStatus,
  resetDirtyFlag,
};