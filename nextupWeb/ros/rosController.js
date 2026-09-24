//backend - rosController.js

import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { extractNodes, getParsedXml } from "./rosHelper.js";
import { getROSNode } from "./rosService.js";
import { LOGS_JSON_FILE } from "../config/path.js";
import { loadYAML } from "../service/pointPlanningBtService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DO_LAYOUT_PATH = path.join(
  __dirname,
  "../user_config/layouts/do_layout.json",
);

const SETTINGS_PATH = path.join(__dirname, "../user_config/user_settings.json");

const DI_LAYOUT_PATH = path.join(
  __dirname,
  "../user_config/layouts/di_layout.json",
);

// Ensure directories exist
await fs.mkdir(path.dirname(DO_LAYOUT_PATH), { recursive: true });
await fs.mkdir(path.dirname(DI_LAYOUT_PATH), { recursive: true });

export const doListController = async (req, res) => {
  try {
    const jsonRoot = await getParsedXml();

    const driverDOs = extractNodes(jsonRoot, "DoControl").map(attr => ({
      type: "driver",
      name: attr.name,
      driver_id: attr.driver_id,
      do_id: attr.do_id,
      type_of_control: attr.type_of_control,
      ...(attr.type_of_control === "push"
        ? { push_wait: attr.push_wait }
        : {})
    }));

    const gpioDOs = extractNodes(jsonRoot, "GpioDoControl").map(attr => ({
      type: "gpio",
      name: attr.name,
      gpio_id: attr.gpio_id,      // or gpio_name/group_name depending on XML
      do_id: attr.do_id,
      type_of_control: attr.type_of_control,
      ...(attr.type_of_control === "push"
        ? { push_wait: attr.push_wait }
        : {})
    }));

    const doNodes = [...driverDOs, ...gpioDOs];

    res.json({
      count: doNodes.length,
      data: doNodes,
    });
  } catch (err) {
    console.error("Error reading DOs:", err);
    res.status(500).json({
      error: "Failed to read DO list",
      details: err.message,
    });
  }
};

export const getDoLayoutController = async (req, res) => {
  try {
    const data = await fs.readFile(DO_LAYOUT_PATH, "utf-8").catch(() => null);

    if (!data) return res.json({});

    res.json(JSON.parse(data));
  } catch (e) {
    console.error("Failed to read DO layout:", e);
    res.status(500).json({ error: "Failed to load DO layout" });
  }
};

export const postDoLayoutController = async (req, res) => {
  try {
    const tmp = DO_LAYOUT_PATH + ".tmp";

    await fs.writeFile(tmp, JSON.stringify(req.body, null, 2));
    await fs.rename(tmp, DO_LAYOUT_PATH);

    res.json({ status: "ok" });
  } catch (e) {
    console.error("Failed to save DO layout:", e); {
      res.status(500).json({ error: "Failed to save DO layout" });
    }
  };
}
export const diListController = async (req, res) => {
  try {
    const jsonRoot = await getParsedXml();
    const driverDIs = extractNodes(jsonRoot, "DIControl").map(attr => ({
      type: "driver",
      name: attr.name,
      driver_id: attr.driver_id,
      di_id: attr.di_id
    }));

    const gpioDIs = extractNodes(jsonRoot, "GpioDiControl").map(attr => ({
      type: "gpio",
      name: attr.name,
      gpio_id: attr.gpio_id,
      di_id: attr.di_id
    }));

    const diNodes = [...driverDIs, ...gpioDIs];

    res.json({
      count: diNodes.length,
      data: diNodes,
    });
  } catch (err) {
    console.error("Error reading DIs:", err);
    res.status(500).json({
      error: "Failed to read DI list",
      details: err.message,
    });
  }
};

export const getDiLayoutController = async (req, res) => {
  try {
    const data = await fs.readFile(DI_LAYOUT_PATH, "utf-8").catch(() => null);

    if (!data) return res.json({});

    res.json(JSON.parse(data));
  } catch (err) {
    console.error("Failed to read DI layout:", err);
    res.status(500).json({ error: "Failed to load DI layout" });
  }
};

export const postDiLayoutController = async (req, res) => {
  try {
    const layout = req.body;

    if (typeof layout !== "object") {
      return res.status(400).json({ error: "Invalid layout format" });
    }

    const tempPath = DI_LAYOUT_PATH + ".tmp";

    await fs.writeFile(tempPath, JSON.stringify(layout, null, 2));
    await fs.rename(tempPath, DI_LAYOUT_PATH);

    res.json({ status: "ok" });
  } catch (err) {
    console.error("Failed to save DI layout:", err);
    res.status(500).json({ error: "Failed to save DI layout" });
  }
};

export const startMotionPlanningController = async (req, res) => {
  try {

    const ros = getROSNode();

    if (!ros) {
      console.error("ROS not initialized yet");
      return res.status(500).json({ error: "ROS not initialized" });
    }

    await ros.publishMotionStart(true); // assuming this can be async

    res.json({ status: "started" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to start motion planning" });
  }
};


export const publishMoveitStopController = async (req, res) => {
  try {

    const ros = getROSNode();

    if (!ros) {
      console.error("ROS not initialized yet");
      return res.status(500).json({ error: "ROS not initialized" });
    }

    await ros.publishMoveitStopCommand();

    res.json({ status: "moveit stopped the current trajectory" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to  stopped the current trajectory" });
  }
};

export async function getLogsController(req, res) {
  try {
    const data = await fs.readFile(LOGS_JSON_FILE, "utf-8");
    const logs = JSON.parse(data);
    res.json({
      success: true,
      data: logs,
    });
  } catch (err) {
    console.error("Error reading logs:", err);

    res.status(500).json({
      success: false,
      message: "Failed to fetch logs",
    });
  }
}

// ════════════════════════════════════════════════════════════════════
// 🆕 NEW: Get the current servo frame from backend
// ════════════════════════════════════════════════════════════════════
export async function getServoFrameController(req, res) {
  try {
    const ros = getROSNode();
    if (!ros) {
      return res.status(500).json({
        success: false,
        error: "ROS not initialized"
      });
    }

    const currentFrame = ros.getCurrentFrame();
    res.json({
      success: true,
      frame: currentFrame
    });
  } catch (err) {
    console.error("Error getting servo frame:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
}

export async function setFrameController(req, res) {
  const { frame } = req.body;
  if (!frame || typeof frame !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "frame" field' });
  }

  const ros = getROSNode();
  if (!ros) {
    console.error("ROS not initialized yet");
    return res.status(500).json({ error: "ROS not initialized" });
  }

  // ✅ Correct: call the dedicated method
  ros.setCurrentFrame(frame);  // This will save AND publish

  res.json({ success: true, frame });
}


export const moveToPointController = async (req, res) => {
  try {
    const { pointName } = req.body;
    if (!pointName) {
      return res.status(400).json({ message: 'Point name is required' });
    }
    const ros = getROSNode();


    // Get the point data to verify it exists
    const data = await loadYAML();
    let targetPoint = pointName;

    // Handle the get_last_pose@pointName format
    if (pointName.includes('@')) {
      targetPoint = pointName.split('@')[1];
    }

    const point = data.points?.find(p => p.name === targetPoint);

    if (!point) {
      return res.status(404).json({ message: `Point ${targetPoint} not found` });
    }

    // Publish to ROS via service
    const success = ros.publishUiCommand(pointName);


    res.json({ success: true, message: `Moving to ${pointName}` });

  } catch (err) {
    console.error('Error in /moveToPoint:', err);
    res.status(500).json({ message: err.message });
  }
};

export const setMotionTypeController = async (req, res) => {
  try {
    const { motionType } = req.body;
    const ros = getROSNode();

    if (!motionType || !['cartesian', 'joint'].includes(motionType)) {
      return res.status(400).json({ message: 'motionType must be "cartesian" or "joint"' });
    }
    ros.publishMotionType(motionType);
    res.json({ success: true, message: `Motion type set to ${motionType}` });
  } catch (err) {
    console.error('Error in /setMotionType:', err);
    res.status(500).json({ message: err.message });
  }
};




export function getPlannerStateController(req, res) {
  try {
    const ros = getROSNode();
    const planner = ros.getCurrentPlanner(); // 'PILZ' | 'OMPL'
    res.json({ success: true, planner, isPilz: planner === 'PILZ' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}


export async function togglePlannerController(req, res) {
  try {
    const { isPilz } = req.body;

    if (typeof isPilz !== "boolean") {
      return res.status(400).json({ success: false, message: "isPilz must be a boolean" });
    }
    const ros = getROSNode()
    const useOmpl = !isPilz;
    const result = await ros.setPlanningPipeline(useOmpl);

    if (!result.success) {
      return res.status(502).json({ success: false, message: result.message });
    }

    res.json({ success: true, planner: isPilz ? "PILZ" : "OMPL", message: result.message });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── ADD THESE TO THE BOTTOM OF ros/rosController.js ───────────────────────

export const getEmergencyManagerYamlController = async (req, res) => {
  try {
    const YAML_PATH = '/home/nextup/NextupRobot/src/active_project_configs/emergency_manager.yaml';
    const content = await fs.readFile(YAML_PATH, 'utf-8');
    const { default: yaml } = await import('js-yaml');
    const config = yaml.load(content);
    return res.json({ success: true, config });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const saveEmergencyManagerYamlController = async (req, res) => {
  try {
    const YAML_PATH = '/home/nextup/NextupRobot/src/active_project_configs/emergency_manager.yaml';
    const { driver, di, bool_topics } = req.body;
    const { default: yaml } = await import('js-yaml');
    const config = {
      emergency_di: { driver: Number(driver), di: Number(di) },
      bool_topics: Array.isArray(bool_topics) ? bool_topics : []
    };
    await fs.writeFile(YAML_PATH, yaml.dump(config), 'utf-8');

    // After 500ms publish true to /reload_emergency_manager_yaml
    setTimeout(() => {
      try {
        const ros = getROSNode();
        ros.publishBoolTopic('/reload_emergency_manager_yaml', true);
      } catch (e) {
        console.error('Failed to publish reload:', e);
      }
    }, 500);

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};