const USER_CONFIG_ROOT = '/home/nextup/user_config_files';
const PROJECTS_ROOT = `${USER_CONFIG_ROOT}/projects`;

// Hidden backup storage (OUTSIDE project folders)
const PROJECT_BACKUP_ROOT = `${USER_CONFIG_ROOT}/.project_backups`;

const ACTIVE_RUNTIME_PATH =
  '/home/nextup/NextupRobot/src/active_project_configs';
const TEMPLATE_PATH =
  '/home/nextup/NextupRobot/src/nextupWeb/user_config/pm_templates/default_project_template.json';

export {
  USER_CONFIG_ROOT,
  PROJECTS_ROOT,
  PROJECT_BACKUP_ROOT,
  ACTIVE_RUNTIME_PATH,
  TEMPLATE_PATH
};
