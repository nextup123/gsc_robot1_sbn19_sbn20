import copyProject from "./projectCopier.js";
import { deleteProject } from "./projectDeleter.js";


async function renameProject(currentName, newName) {
  // Copy to new name (preserves all data, throws PROJECT_EXISTS / "does not exist" on errors)
  await copyProject(currentName, { name: newName });

  // Delete the original only after copy succeeds
  await deleteProject(currentName);

  return { success: true, name: newName };
}

export default renameProject;