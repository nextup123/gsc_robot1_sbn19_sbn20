import fs from "fs-extra";
import path from "node:path";
import yaml from "js-yaml";

import { USER_CONFIG_ROOT } from "./paths.js";
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

async function initializeRuntime() {
  try {
    console.log("[INIT] Bootstrapping runtime...");

    if (!(await fs.pathExists(ACTIVE_PROJECT_FILE))) {
      console.log("[INIT] No active project file found");
      return;
    }

    const data = yaml.load(
      await fs.readFile(ACTIVE_PROJECT_FILE, "utf8")
    );
    console.log("runtime initialized");
    const projectName = data?.active_project;

    if (!projectName) {
      console.log("[INIT] No active project set");
      return;
    }

    console.log("[INIT] Active project:", projectName);

    // Ensure session exists / is consistent
    await initSession(projectName);

    // 🛑 Defensive: avoid duplicate watchers
    stopMutationWatcher();

    // 🔥 Start watcher
    await startMutationWatcher();

    console.log("[INIT] Watcher started");
  } catch (err) {
    console.error("[INIT ERROR]", err);
  }
}

const getSessionDetails = async () => {
  const session = await readSession();

  if (!session) {
    return;
  }

  const payload = {
    project: session.project_name,
    state: session.dirty ? "DIRTY" : "ACTIVE",
    reason: "NA",
  };

  eventBus.emit("session:update", payload);

  return payload;
};

export { getSessionDetails, initializeRuntime };