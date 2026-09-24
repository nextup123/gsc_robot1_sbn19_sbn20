import fs from "fs/promises";
import yaml from "js-yaml";
import { pointPlanningFilePath } from "../config/path.js"; 

const YAML_FILE = pointPlanningFilePath.POINTS_YAML_FILE;
const YAML_BACKUP_FILE = pointPlanningFilePath.POINTS_BACKUP_YAML_FILE;



// Helper function to check if file exists
export async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}
 
// Create backup of current YAML
export async function createBackup() {
    try {
        if (await fileExists(YAML_FILE)) {
            const data = await fs.readFile(YAML_FILE, 'utf8');
            await fs.writeFile(YAML_BACKUP_FILE, data, 'utf8');
            return true;
        }
        return false;
    } catch (err) {
        console.error('Error creating backup:', err);
        return false;
    }
}
 
// Swap main YAML with backup for undo
export async function swapWithBackup() {
    try {
        if (!await fileExists(YAML_BACKUP_FILE)) {
            throw new Error('No backup file exists to undo to');
        }

        const backupData = await fs.readFile(YAML_BACKUP_FILE, 'utf8');
        if (await fileExists(YAML_FILE)) {
            const currentData = await fs.readFile(YAML_FILE, 'utf8');
            await fs.writeFile(`${YAML_BACKUP_FILE}.tmp`, currentData, 'utf8');
        }

        await fs.writeFile(YAML_FILE, backupData, 'utf8');

        if (await fileExists(`${YAML_BACKUP_FILE}.tmp`)) {
            await fs.rename(`${YAML_BACKUP_FILE}.tmp`, YAML_BACKUP_FILE);
        } else {
            await fs.unlink(YAML_BACKUP_FILE);
        }

        return true;
    } catch (err) {
        console.error('Error swapping files:', err);
        throw err;
    }
}

// Save YAML with backup
export async function saveYAML(data) {
    try {
        await createBackup();
        const yamlStr = yaml.dump(data, { noRefs: true, noCompatMode: true });
        await fs.writeFile(YAML_FILE, yamlStr, 'utf8');
    } catch (err) {
        console.error('Error saving YAML:', err);
        console.error('Problematic data:', JSON.stringify(data, null, 2));
        if (data.points) {
            data.points.forEach((point, index) => {
                console.error(`Point ${index} sequence:`, point.sequence, typeof point.sequence);
                console.error(`Point ${index} joints_values:`, point.joints_values);
                console.error(`Point ${index} coordinate:`, point.coordinate);
                console.error(`Point ${index} history:`, point.history);
            });
        }
        throw new Error(`Failed to save YAML: ${err.message}`);
    }
}

/**
 * Resolve is_editable with safe fallback.
 * Handles: boolean true/false, missing/undefined/null (→ true),
 * string "true"/"false" (from malformed YAML), and numeric 1/0.
 */
export function resolveEditable(point) {
    const val = point.is_editable;
    if (val === undefined || val === null) return true;
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') return val.toLowerCase() !== 'false';
    return Boolean(val);
}

/**
 * Normalize a single point object so is_editable is always an explicit boolean.
 * Safe to call on old YAML points that have no is_editable field.
 */
function normalizePoint(point) {
    return {
        ...point,
        is_editable: resolveEditable(point),
    };
}

// Load YAML with error handling.
// Normalization happens here so every downstream consumer always receives
// points with is_editable explicitly set — no scattered ?? true fallbacks needed.
export async function loadYAML() {
    try {
        if (!await fileExists(YAML_FILE)) {
            if (await fileExists(YAML_BACKUP_FILE)) {
                console.log('Main YAML file not found, using backup');
                await fs.copyFile(YAML_BACKUP_FILE, YAML_FILE);
            } else {
                throw new Error('YAML file not found');
            }
        }

        const raw = await fs.readFile(YAML_FILE, 'utf8');
        const data = yaml.load(raw);

        // Normalize all points for backward compatibility.
        // Old YAML files without is_editable will have it defaulted to true.
        if (data && Array.isArray(data.points)) {
            data.points = data.points.map(normalizePoint);
        }

        return data;
    } catch (err) {
        console.error('Error loading YAML:', err);
        throw new Error(`Failed to load YAML: ${err.message}`);
    }
}

// Generate date_time in DDMMM_HHMM format
export function getCurrentDateTime() {
    const now = new Date();
    const day = now.getDate().toString().padStart(2, '0');
    const month = now.toLocaleString('en-US', { month: 'short' }).toLowerCase();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    return `${day}${month}_${hours}${minutes}`;
}

// Format joints and coordinates as arrays
export function formatPointData(joints, coords) {
    const jointsArray = [
        joints.joint1,
        joints.joint2,
        joints.joint3,
        joints.joint4,
        joints.joint5,
        joints.joint6
    ].map(n => Number(n).toFixed(5));
    const coordsArray = [
        coords.x,
        coords.y,
        coords.z,
        coords.r,
        coords.p,
        coords.w
    ].map(n => Number(n).toFixed(5));
    return {
        jointsStr: `[${jointsArray.join(',')}]`,
        coordsStr: `[${coordsArray.join(',')}]`
    };
}

// Validate point data
export function validatePoint(point, isUpdate = false) {
    const requiredFields = ['name', 'date_time', 'sequence', 'joints_values', 'coordinate'];
    const jointFields = ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6'];
    const coordFields = ['x', 'y', 'z', 'r', 'p', 'w'];
    const errors = [];

    if (!isUpdate) {
        requiredFields.forEach(field => {
            if (!point[field]) errors.push(`Missing ${field}`);
        });
    }

    if (point.name && !/^[a-zA-Z0-9-_]+$/.test(point.name)) {
        errors.push('Name can only contain letters, numbers, and dashes');
    }

    if (point.sequence === undefined || point.sequence === null) {
        errors.push('Sequence is required');
    } else {
        const sequenceNum = Number(point.sequence);
        if (isNaN(sequenceNum) || !/^\d{1,3}$/.test(String(sequenceNum))) {
            errors.push('Sequence must be a 1- to 3-digit number');
        }
    }

    if (point.joints_values) {
        jointFields.forEach(joint => {
            if (!point.joints_values.hasOwnProperty(joint)) {
                errors.push(`Missing ${joint} in joints_values`);
            } else if (typeof point.joints_values[joint] !== 'number') {
                errors.push(`${joint} must be a number`);
            }
        });
    }

    if (point.coordinate) {
        coordFields.forEach(coord => {
            if (!point.coordinate.hasOwnProperty(coord)) {
                errors.push(`Missing ${coord} in coordinate`);
            } else if (typeof point.coordinate[coord] !== 'number') {
                errors.push(`${coord} must be a number`);
            }
        });
    }

    // History is optional
    if (point.history && typeof point.history !== 'object') {
        errors.push('History must be an object');
    }

    // is_editable is optional — must be boolean if provided
    if (point.is_editable !== undefined && point.is_editable !== null) {
        if (typeof point.is_editable !== 'boolean') {
            errors.push('is_editable must be a boolean');
        }
    }

    return errors.length > 0 ? errors.join(', ') : null;
}