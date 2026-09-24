//dirtyTracker.js

import fs from "fs-extra";
import path from "path";
import yaml from "js-yaml";

import { ACTIVE_RUNTIME_PATH } from "./paths.js";
import eventBus from "./eventBus.js";

const SESSION_FILE = path.join(ACTIVE_RUNTIME_PATH, ".session.yaml");

// simple write lock
let writeLock = Promise.resolve();

function queueWrite(fn) {
  writeLock = writeLock.then(fn).catch(console.error);
  return writeLock;
}

async function readSession() {
  try {
    if (!(await fs.pathExists(SESSION_FILE))) {
      return {};
    }

    const content = await fs.readFile(SESSION_FILE, "utf8");
    return yaml.load(content) || {};
  } catch (err) {
    console.error("[SESSION READ ERROR]", err);
    return {};
  }
}

async function writeSession(session) {
  try {
    await fs.writeFile(SESSION_FILE, yaml.dump(session), "utf8");
  } catch (err) {
    console.error("[SESSION WRITE ERROR]", err);
  }
}

/**
 * Mark runtime as dirty
 */
async function markDirty(reason = "user_edit") {
  return queueWrite(async () => {
    console.log("[DIRTY TRACKER] markDirty");

    const session = await readSession();

    session.dirty = true;
    session.dirty_reason = reason;
    session.last_change_at = new Date().toISOString();
    session.change_counter = (session.change_counter || 0) + 1;

    await writeSession(session);
    eventBus.emit("session:update", {
      project: session.project_name,
      state: "DIRTY",
      reason,
    });
  });
}

/**
 * Mark runtime as clean
 */
async function markClean(reason = "commit") {
  return queueWrite(async () => {
    const session = await readSession();

    session.dirty = false;
    session.dirty_reason = reason;
    session.last_clean_at = new Date().toISOString();
    session.change_counter = 0;

    await writeSession(session);

    eventBus.emit("session:update", {
      project: session.project_name,
      state: "ACTIVE",
      reason,
    });
  });
}

/**
 * Initialize session on load
 */
async function initSession(projectName) {
  return queueWrite(async () => {
    console.log("[DIRTY TRACKER] initSession");

    const session = {
      project_name: projectName,
      dirty: false,
      loaded_at: new Date().toISOString(),
      change_counter: 0,
    };

    await writeSession(session);

    eventBus.emit("session:update", {
      project: projectName,
      state: "ACTIVE",
      reason: "init",
    });
  });
}

export {
  markDirty,
  markClean,
  initSession,
  readSession
};
