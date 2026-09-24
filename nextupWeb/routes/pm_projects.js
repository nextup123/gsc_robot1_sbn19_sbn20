import express from "express";
const router = express.Router();

import { createNewProject } from "../utils/pm_utils/projectCreator.js";
import { listProjects } from "../utils/pm_utils/projectRegistry.js";
import { deleteProject } from "../utils/pm_utils/projectDeleter.js";

import {
  loadProject,
  readActiveProjectName,
  readActiveProjectData,
} from "../utils/pm_utils/projectLoader.js";

import { saveProject } from "../utils/pm_utils/projectSaver.js";
import { listProjectVersions } from "../utils/pm_utils/projectVersions.js";
import { restoreProjectVersion } from "../utils/pm_utils/projectVersionRestorer.js";
import { getSessionDetails } from "../utils/pm_utils/runTimeInitializer.js";
import renameProject from "../utils/pm_utils/projectRenamer.js";
import copyProject from "../utils/pm_utils/projectCopier.js";
// Create project
// Create project
router.post("/create", async (req, res) => {
  try {
    const result = await createNewProject(req.body);
    res.status(201).json(result);
  } catch (err) {
    // 409 Conflict for duplicate name, 400 for all other validation errors
    const status = err.code === 'PROJECT_EXISTS' ? 409 : 400;
    res.status(status).json({ success: false, error: err.message });
    // Do NOT re-throw — that would crash the process
  }
});

// List projects
router.get("/list", async (req, res) => {
  try {
    const projects = await listProjects();

    setTimeout(() => {
      getSessionDetails();
    }, 300);

    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: "Failed to list projects" });
  }
});

// LOAD
router.post("/load", async (req, res) => {
  try {
    const { name } = req.body;
    const result = await loadProject(name);
    res.json(result);
  } catch (err) {
    console.error("[LOAD ERROR FULL]", err);
    res.status(400).json({ error: err.message, stack: err.stack });
  }
});

// SAVE
router.post("/save", async (req, res) => {
  try {
    // req.body.auto === true → autosave call; skip backup if nothing's dirty
    const result = await saveProject({ skipIfClean: !!req.body?.auto });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/versions/:name", async (req, res) => {
  try {
    const data = await listProjectVersions(req.params.name);
    res.json(data);
  } catch {
    res.status(500).json({ error: "Failed to list versions" });
  }
});

router.post("/overwrite", async (req, res) => {
  const { name } = req.body;

  try {
    await loadProject(name, { force: true });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/restore", async (req, res) => {
  try {
    const { name, versionId } = req.body;
    const result = await restoreProjectVersion(name, versionId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

//Add these two Routes

router.get("/active", async (req, res) => {
  try {
    // const { name } = req.body;
    const result = await readActiveProjectName();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/active-project", async (req, res) => {
  try {
    const { projectName } = req.body;
    const result = await readActiveProjectData(projectName);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete("/delete/:name", async (req, res) => {
  try {
    const { name } = req.params;

    const result = await deleteProject(name);

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});



// Rename project
router.post("/rename", async (req, res) => {
  const { currentName, newName } = req.body;

  if (!currentName || !newName) {
    return res.status(400).json({ error: "currentName and newName are required" });
  }

  try {
    const result = await renameProject(currentName, newName);
    return res.status(200).json(result);
  } catch (err) {
    if (err.code === "PROJECT_EXISTS") {
      return res.status(409).json({ error: err.message });
    }
    if (err.message?.includes("does not exist")) {
      return res.status(404).json({ error: err.message });
    }
    console.error("[POST /rename]", err);
    return res.status(500).json({ error: "Internal server error during rename" });
  }
});


// Copy project
router.post("/copy", async (req, res) => {
  const { sourceName, name, owner, description } = req.body;

  if (!sourceName || !name) {
    return res.status(400).json({ error: "sourceName and name are required" });
  }

  try {
    const result = await copyProject(sourceName, { name, owner, description });
    return res.status(201).json(result);
  } catch (err) {
    if (err.code === "PROJECT_EXISTS") {
      return res.status(409).json({ error: err.message });
    }
    if (err.message?.includes("does not exist")) {
      return res.status(404).json({ error: err.message });
    }
    console.error("[POST /copy]", err);
    return res.status(500).json({ error: "Internal server error during copy" });
  }
});

export default router;