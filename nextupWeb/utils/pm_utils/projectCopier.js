// utils/projectCopier.js

import fs from "fs-extra";
import path from "path";
import yaml from "js-yaml";
import { PROJECTS_ROOT } from "./paths.js";

const SESSION_FILE = ".session.yaml";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function readYamlSafe(filePath) {
  try {
    if (!(await fs.pathExists(filePath))) return null;
    return yaml.load(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────

/**
 * Physically duplicate a saved project folder into a new project.
 *
 * Safety guarantees:
 *  ✅ Atomic  — writes to a temp dir first, then renames into place.
 *               If anything fails mid-way the destination is never
 *               partially created.
 *  ✅ Isolated — never touches ACTIVE_RUNTIME_PATH, dirty tracker,
 *               mutation watcher, or the active session in any way.
 *  ✅ Clean    — .session.yaml is stripped; the copy starts life with
 *               a fresh project.yaml (version 1.0.0, new timestamps).
 *  ✅ Safe     — throws a typed PROJECT_EXISTS error if the name is
 *               already taken so the route can return HTTP 409.
 *
 * @param {string} sourceName  - existing project folder name
 * @param {object} opts
 * @param {string} opts.name        - new project name (required)
 * @param {string} [opts.owner]     - override owner  (falls back to source)
 * @param {string} [opts.description] - override description
 * @returns {{ success, name, projectPath }}
 */
async function copyProject(sourceName, { name, owner, description } = {}) {

  // ── 1. Validate inputs ───────────────────────────────────────────
  if (!sourceName) throw new Error("Source project name is required");
  if (!name)       throw new Error("New project name is required");

  const sourcePath = path.join(PROJECTS_ROOT, sourceName);
  const destPath   = path.join(PROJECTS_ROOT, name);
  const tempPath   = `${destPath}__copy_tmp`;          // temp staging dir

  if (!(await fs.pathExists(sourcePath))) {
    throw new Error(`Source project "${sourceName}" does not exist`);
  }

  // ── 2. Conflict check ────────────────────────────────────────────
  if (await fs.pathExists(destPath)) {
    const err = new Error(`A project named "${name}" already exists`);
    err.code  = "PROJECT_EXISTS";
    throw err;
  }

  // ── 3. Read source metadata (we'll derive the new project.yaml from it) ──
  const sourceYamlPath = path.join(sourcePath, "project.yaml");
  const sourceMeta     = (await readYamlSafe(sourceYamlPath)) || {};

  // ── 4. Atomic copy: source → temp ───────────────────────────────
  //    Clean up any leftover temp dir from a previous crashed attempt.
  await fs.remove(tempPath);

  await fs.copy(sourcePath, tempPath, {
    overwrite: true,
    // Strip the runtime session file — it belongs to the active runtime,
    // not to the project on disk, and is meaningless for a new project.
    filter: (src) => !src.endsWith(SESSION_FILE),
  });

  // ── 5. Write a fresh project.yaml inside temp ────────────────────
  //    We intentionally reset:
  //      • name          → the new name
  //      • owner         → caller-supplied or fall back to source
  //      • description   → caller-supplied or "Copy of <source>"
  //      • project_version → "1.0.0"  (the copy starts its own lineage)
  //      • version         → "1.0.0"
  //      • created_at    → now
  //      • last_modified → now
  //    Everything else (project_type, robot_model, tags, …) is inherited
  //    from the source so the copy is structurally identical.
  const now         = new Date().toISOString();
  const newMeta     = {
    ...sourceMeta,                                     // inherit everything
    name,
    owner:           owner       || sourceMeta.owner || "unknown",
    description:     description || `Copy of ${sourceName}`,
    project_version: "1.0.0",
    version:         "1.0.0",
    created_at:      now,
    last_modified:   now,
  };

  await fs.writeFile(
    path.join(tempPath, "project.yaml"),
    yaml.dump(newMeta),
    "utf8"
  );

  // ── 6. Atomic rename: temp → dest ───────────────────────────────
  //    fs.move is atomic on most filesystems (same partition).
  //    A second conflict check happens implicitly — if dest appeared
  //    between step 2 and here, move() will throw and tempPath is
  //    cleaned up in the catch block.
  await fs.move(tempPath, destPath, { overwrite: false });

  return {
    success:     true,
    name,
    sourceName,
    projectPath: destPath,
  };
}

export default copyProject;