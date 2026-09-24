import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const TREE_LAYOUT_DIR = path.join(__dirname, "../routes/tree_layout");

export const pointPlanningFilePath = {
  POINTS_YAML_FILE:
    "/home/nextup/NextupRobot/src/active_project_configs/planning_data/points.yaml",
  POINTS_BACKUP_YAML_FILE: "points_backup.yaml",
};

export const wsCalibrationFilePath = {
  CALIBRATION_YAML_FILE:
    "/home/nextup/NextupRobot/src/active_project_configs/planning_data/calibration.yaml",
};

export const pathPlanningFilePath = {
  PATH_PLAN_TREE_XML_FILE:
    "/home/nextup/NextupRobot/src/active_project_configs/planning_data/plan_path.xml",
  PATH_PLAN_TREE_XML_BACKUP_FILE:
    "/home/nextup/NextupRobot/src/active_project_configs/planning_data/plan_path_undo.xml",
  PATHS_YAML_FILE:
    "/home/nextup/NextupRobot/src/active_project_configs/planning_data/paths.yaml",
};

export const ioFilePath = {
  DO_DI_TREE_XML_FILE:
    "/home/nextup/NextupRobot/src/active_project_configs/control_data/do_di.xml",
  DO_DI_TREE_XML_BACKUP_FILE:
    "/home/nextup/NextupRobot/src/active_project_configs/control_data/do_di_backup.xml",
};
export const BACKUP_DIR =
  "/home/nextup/user_config_files/planning_data/points/backup";

export const ERROR_LOGS_PATH =
  "/home/nextup/user_config_files/error_container/error_logs.yaml";

export const DESCRIPTION_PATH =
  "/home/nextup/user_config_files/error_container/description_error.txt";

export const COMMANDS_PATH =
  "/home/nextup/user_config_files/error_container/commands.json";

export const OPEN_TERMINAL_PATH =
  "/home/nextup/user_config_files/error_container/always_on_top_terminal.sh";

export const XML_BASE_DIR =
  "/home/nextup/NextupRobot/src/active_project_configs/control_data";

export const LAYOUTS_DIR = path.join(__dirname, "../config/layouts");

export const MAPPED_DATA_PATH =
  "/home/nextup/user_config_files/planning_data/articles/mapped_data.yaml";

export const TEMPLATE_PATH =
  "/home/nextup/NextupRobot/src/active_project_configs/control_data/template.xml";
export const RUNPATH_TEMPLATE_PATH =
  "/home/nextup/NextupRobot/src/active_project_configs/control_data/run_path.xml";

export const LOGS_JSON_FILE = "/home/nextup/NextupRobot/src/active_project_configs/logs.json";
export const LIVE_LOGS_JSON_FILE = "/home/nextup/user_config_files/live_logs.json";
export const NODES_JSON_PATH = '/home/nextup/user_config_files/nodes.json';

export const PASSWORD_FILE_PATH =
  "/home/nextup/user_config_files/security/web_frontent_passwords.json";

  export const MONITOR_YAML_PATH =
  "/home/nextup/user_config_files/ros_node_controller_monitor/monitor.yaml";

  export const FAULTJSONPATH = '/home/nextup/NextupRobot/src/nextupWeb/user_config/faults.json'