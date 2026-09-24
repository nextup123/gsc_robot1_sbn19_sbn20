import fs from "fs/promises";
import path from "path";
import { fileExists, formatPointData, loadYAML, saveYAML, swapWithBackup, validatePoint, getCurrentDateTime, resolveEditable } from "../service/pointPlanningBtService.js";
import { BACKUP_DIR, pointPlanningFilePath } from "../config/path.js";
import { publishToUICommand, getLatestRobotStatus, setMotionType, publishEditedPoint } from "../ros/rosPointPlanningService.js";
import { createLogger } from '../utils/logger.js';



const log = createLogger('controller', 'pointPlanningBtController.js');



const YAML_BACKUP_FILE = pointPlanningFilePath.POINTS_BACKUP_YAML_FILE;

export const getPointFileNameController = async (req, res) => {
    try {
        const data = await loadYAML();
        res.json({ points_file_name: data.points_file_name || '' });
    } catch (err) {
        log.error({ err, function: getPointFileNameController }, "Error in /getPointFileName");
        res.status(500).json({ message: err.message });
    }
}

export const getPointsController = async (req, res) => {
    try {
        const data = await loadYAML();
        // loadYAML already normalizes is_editable on every point
        res.json(data.points || []);
    } catch (err) {
        log.error({ err, function: getPointsController }, "Error in /getPoints");
        res.status(500).json({ message: err.message });
    }
}

export const getPointBackupFileNamesController = async (req, res) => {
    try {
        await fs.access(BACKUP_DIR);
        const files = await fs.readdir(BACKUP_DIR);
        const yamlFiles = files
            .filter(file => file.endsWith('.yaml'))
            .map(file => path.basename(file, '.yaml'));
        res.json({ backupFiles: yamlFiles });
    } catch (err) {
        log.error({ err, function: getPointBackupFileNamesController }, "Error in /getPointsBackupFileNames");
        res.status(500).json({ message: `Failed to read backup directory: ${err.message}` });
    }
}

export const addPointController = async (req, res) => {
    try {
        const point = { ...req.body, sequence: Number(req.body.sequence) };

        // Normalize is_editable: explicit boolean, defaults to true for missing/unknown values
        point.is_editable = resolveEditable(point);

        const validationError = validatePoint(point);
        if (validationError) {
            return res.status(400).json({ message: validationError });
        }

        const data = await loadYAML();
        if (!data.points) data.points = [];
        if (data.points.some(p => p.name === point.name)) {
            return res.status(400).json({ message: `Point ${point.name} already exists` });
        }

        data.points.push(point);
        await saveYAML(data);
        res.json({ message: `Added point ${point.name}`, points: data.points });
    } catch (err) {
        log.error({ err, function: addPointController }, "Error in /addPoint");
        res.status(500).json({ message: err.message });
    }
}

export const updatePointController = async (req, res) => {
    try {
        const { oldName, ...point } = req.body;
        point.sequence = Number(point.sequence);
        if (!oldName || !point.name) {
            return res.status(400).json({ message: 'Missing oldName or name' });
        }

        const validationError = validatePoint(point, true);
        if (validationError) {
            return res.status(400).json({ message: validationError });
        }

        const data = await loadYAML();
        const index = data.points.findIndex(p => p.name === oldName);
        if (index === -1) {
            return res.status(404).json({ message: `Point ${oldName} not found` });
        }

        if (point.name !== oldName && data.points.some(p => p.name === point.name)) {
            return res.status(400).json({ message: `Point ${point.name} already exists` });
        }

        const oldPoint = data.points[index];

        // Preserve is_editable from the existing point if the request doesn't include it,
        // so that a partial update can't accidentally reset editability.
        point.is_editable = resolveEditable(
            point.is_editable !== undefined ? point : oldPoint
        );

        // Create history entry
        const { jointsStr: oldJointsStr, coordsStr: oldCoordsStr } = formatPointData(oldPoint.joints_values, oldPoint.coordinate);
        const { jointsStr: newJointsStr, coordsStr: newCoordsStr } = formatPointData(point.joints_values, point.coordinate);
        const historyEntry = `on ${point.date_time} previous ${oldJointsStr} ${oldCoordsStr} updated ${newJointsStr} ${newCoordsStr}`;

        // Initialize or update history
        point.history = oldPoint.history || { Serial: historyEntry };
        point.history.Serial = historyEntry;
        const historyKeys = Object.keys(point.history).filter(k => k !== 'Serial' && !isNaN(k)).map(Number);
        const nextKey = historyKeys.length > 0 ? Math.max(...historyKeys) + 1 : 1;
        point.history[nextKey] = historyEntry;

        data.points[index] = point;
        await saveYAML(data);
        res.json({ message: `Updated point ${oldName} to ${point.name}`, points: data.points });
    } catch (err) {
        log.error({ err, function: updatePointController }, "Error in /updatePoint");
        res.status(500).json({ message: err.message });
    }
}

export const deletePointController = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ message: 'Missing name' });
        }

        const data = await loadYAML();
        const initialLength = data.points.length;
        data.points = data.points.filter(p => p.name !== name);

        if (data.points.length === initialLength) {
            return res.status(404).json({ message: `Point ${name} not found` });
        }

        if (data.points.length === 0) delete data.points;
        await saveYAML(data);
        res.json({ message: `Deleted point ${name}`, points: data.points || [] });
    } catch (err) {
        log.error({ err, function: deletePointController }, "Error in /deletePoint");
        res.status(500).json({ message: err.message });
    }
}

export const deleteAllController = async (req, res) => {
    try {
        const data = await loadYAML();
        if (!data.points || data.points.length === 0) {
            return res.status(400).json({ message: 'No points to delete' });
        }

        delete data.points;
        await saveYAML(data);
        res.json({ message: 'Deleted all points', points: [] });
    } catch (err) {
        log.error({ err, function: deleteAllController }, "Error in /deleteAll");
        res.status(500).json({ message: err.message });
    }
}

export const reorderPointsController = async (req, res) => {
    try {
        const { pointNames } = req.body;
        if (!Array.isArray(pointNames) || pointNames.length === 0) {
            return res.status(400).json({ message: 'pointNames must be a non-empty array' });
        }

        const data = await loadYAML();
        if (!data.points) {
            return res.status(400).json({ message: 'No points to reorder' });
        }

        const pointMap = new Map();
        data.points.forEach(p => pointMap.set(p.name, p));
        const invalidNames = pointNames.filter(name => !pointMap.has(name));
        if (invalidNames.length > 0) {
            return res.status(404).json({ message: `Points not found: ${invalidNames.join(', ')}` });
        }

        // pointMap values already carry normalized is_editable from loadYAML
        data.points = pointNames.map(name => pointMap.get(name));
        await saveYAML(data);
        res.json({ message: 'Points reordered successfully', points: data.points });
    } catch (err) {
        log.error({ err, function: reorderPointsController }, "Error in /reorderPoints");
        res.status(500).json({ message: err.message });
    }
}

export const undoController = async (req, res) => {
    try {
        await swapWithBackup();
        const data = await loadYAML();
        res.json({ message: 'Undo successful', points: data.points || [] });
    } catch (err) {
        log.error({ err, function: undoController }, "Error in /undo");
        res.status(500).json({ message: err.message });
    }
}

export const canUndoController = async (req, res) => {
    try {
        const canUndo = await fileExists(YAML_BACKUP_FILE);
        res.json({ canUndo });
    } catch (err) {
        log.error({ err, function: canUndoController }, "Error in /canUndo");
        res.status(500).json({ message: err.message });
    }
}

export const getRobotStatusController = async (req, res) => {
    try {
        const status = getLatestRobotStatus();
        res.json(status);
    } catch (err) {
        log.error({ err, function: getRobotStatusController }, "Error in /robotStatus");
        res.status(500).json({ message: err.message });
    }
};

export const editedPointNotificationController = async (req, res) => {
    try {
        const { pointName } = req.body;
        if (!pointName) {
            return res.status(400).json({ message: 'Point name is required' });
        }
        publishEditedPoint(pointName);
        res.json({ success: true, message: 'Point edit recorded' });
    } catch (err) {
        log.error({ err, function: editedPointNotificationController }, "Error in /editedPoint");
        res.status(500).json({ message: err.message });
    }
};

export const savePointFileController = async (req, res) => {
    try {
        const { fileName } = req.body;
        if (!fileName || !/^[a-zA-Z0-9_]+$/.test(fileName)) {
            return res.status(400).json({ message: 'File name must contain only letters, numbers, and underscores' });
        }

        const data = await loadYAML();
        const backupFilePath = path.join(BACKUP_DIR, `${fileName}.yaml`);
        await fs.writeFile(backupFilePath, JSON.stringify(data, null, 2));
        data.points_file_name = fileName;
        await saveYAML(data);
        res.json({ message: `File saved as ${fileName}.yaml` });
    } catch (err) {
        log.error({ err, function: savePointFileController }, "Error in /savePointFile");
        res.status(500).json({ message: err.message });
    }
};

export const loadBackupFileController = async (req, res) => {
    try {
        const { fileName } = req.body;
        if (!fileName) {
            return res.status(400).json({ message: 'File name is required' });
        }

        const backupFilePath = path.join(BACKUP_DIR, `${fileName}.yaml`);
        try {
            await fs.access(backupFilePath);
        } catch {
            return res.status(404).json({ message: `Backup file ${fileName}.yaml not found` });
        }

        const backupData = await fs.readFile(backupFilePath, 'utf8');
        const data = JSON.parse(backupData);
        await saveYAML(data);
        res.json({ message: `Loaded ${fileName}.yaml successfully` });
    } catch (err) {
        log.error({ err, function: loadBackupFileController }, "Error in /loadBackupFile");
        res.status(500).json({ message: err.message });
    }
};

export const createNewFileController = async (req, res) => {
    try {
        const { fileName } = req.body;
        if (!fileName || !/^[a-zA-Z0-9_]+$/.test(fileName)) {
            return res.status(400).json({ message: 'File name must contain only letters, numbers, and underscores' });
        }

        const newData = {
            points_file_name: fileName,
            points: []
        };
        await saveYAML(newData);
        res.json({ message: `New file ${fileName} created successfully` });
    } catch (err) {
        log.error({ err, function: createNewFileController }, "Error in /createNewFile");
        res.status(500).json({ message: err.message });
    }
};

export const deleteBackupFileController = async (req, res) => {
    try {
        const { fileName } = req.body;
        if (!fileName) {
            return res.status(400).json({ message: 'File name is required' });
        }

        const backupFilePath = path.join(BACKUP_DIR, `${fileName}.yaml`);
        try {
            await fs.access(backupFilePath);
        } catch {
            return res.status(404).json({ message: `Backup file ${fileName}.yaml not found` });
        }

        await fs.unlink(backupFilePath);
        res.json({ message: `Deleted ${fileName}.yaml successfully` });
    } catch (err) {
        log.error({ err, function: deleteBackupFileController }, "Error in /deleteBackupFile:");
        res.status(500).json({ message: err.message });
    }
};