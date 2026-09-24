//projectCreator.js

import fs from "fs-extra";
import path from "node:path";
import yaml from "js-yaml";

import { PROJECTS_ROOT } from "./paths.js";
import { generateFromTemplate } from "./projectTemplateGenerator.js";

// __dirname replacement in ESM
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NEXTUP_WEB_ROOT = path.join(__dirname, "..", "..");

async function createNewProject(projectData) {
  const {
    name,
    owner,
    description = "",
    project_type = "standard",
  } = projectData;

  if (!name || !owner) {
    throw new Error("Project name and owner are required");
  }

  if (!["standard", "blank"].includes(project_type)) {
    throw new Error("Invalid project_type");
  }

  const projectPath = path.join(PROJECTS_ROOT, name);

  if (await fs.pathExists(projectPath)) {
    const err = new Error(`A project named "${name}" already exists`);
    err.code = "PROJECT_EXISTS";
    throw err;
  }

  await fs.ensureDir(projectPath);

  const projectYaml = {
    name,
    owner,
    description,
    project_type,
    created_at: new Date().toISOString(),
    version: "1.0.0",
    project_version: "1.0.0",
  };

  await fs.writeFile(
    path.join(projectPath, "project.yaml"),
    yaml.dump(projectYaml),
    "utf8"
  );

  const template = await fs.readJson(
    path.join(
      NEXTUP_WEB_ROOT,
      "user_config",
      "pm_templates",
      "default_project_template.json"
    )
  );

  const defaultsPath = path.join(
    NEXTUP_WEB_ROOT,
    "user_config",
    "pm_defaults"
  );

  await generateFromTemplate(
    template,
    projectPath,
    defaultsPath,
    project_type
  );

  return {
    success: true,
    name,
    projectPath,
    project_type,
  };
}

export { createNewProject };