
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SEQUENCE_FILE = path.join(__dirname, "../config/path_sequence.json");
const UNDO_FILE = path.join(__dirname, "../config/path_sequence_undo.json");
const DEFAULT_VELOCITY = 0.2;


export async function ensureConfigDir() {
    const configDir = path.join(__dirname, '../config');
    try {
        await fs.access(configDir);
    } catch (error) {
        if (error.code === 'ENOENT') {
            await fs.mkdir(configDir, { recursive: true });
        }
    }
}

// Initialize files if they don't exist
export async function initializeFiles() {
    await ensureConfigDir();
    
    const files = [
        { path: SEQUENCE_FILE, defaultContent: { sequences: [] } },
        { path: UNDO_FILE, defaultContent: { history: [] } }
    ];
    
    for (const file of files) {
        try {
            await fs.access(file.path);
        } catch (error) {
            if (error.code === 'ENOENT') {
                await fs.writeFile(file.path, JSON.stringify(file.defaultContent, null, 2));
            }
        }
    }
}

// Call initialization
export async function initSequenceModule() {
    await initializeFiles();
}
// Utility function to read JSON file
export async function readJSONFile(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(data);
        
        // Handle old format (with "sequence" root) or new format (with "sequences" array)
        if (parsed.sequence && !parsed.sequences) {
            // Convert old format to new format
            const sequenceObj = parsed.sequence;
            if (sequenceObj.steps) {
                sequenceObj.id = sequenceObj.id || `seq_${Date.now()}`;
                sequenceObj.name = sequenceObj.name || `sequence_${new Date().toISOString().slice(0, 10)}`;
                sequenceObj.createdAt = sequenceObj.createdAt || new Date().toISOString();
                sequenceObj.totalSteps = sequenceObj.steps.length;
                
                // Add velocities if missing
                sequenceObj.steps = sequenceObj.steps.map((step, index) => ({
                    ...step,
                    order: step.order || index + 1,
                    velocity: step.velocity || DEFAULT_VELOCITY
                }));
                
                return { sequences: [sequenceObj] };
            }
        }
        
        return parsed;
    } catch (error) {
        if (error.code === 'ENOENT') {
            // File doesn't exist, return default structure
            console.log(`File ${filePath} doesn't exist, returning default`);
            return { sequences: [] };
        } else if (error instanceof SyntaxError) {
            // JSON parse error, return default
            console.error(`Invalid JSON in ${filePath}:`, error.message);
            return { sequences: [] };
        }
        throw error;
    }
}

// Utility function to write JSON file
export async function writeJSONFile(filePath, data) {
    try {
        const jsonString = JSON.stringify(data, null, 2);
        await fs.writeFile(filePath, jsonString);
        return true;
    } catch (error) {
        console.error(`Failed to write file ${filePath}:`, error.message);
        throw error;
    }
}

// Save current state to undo before changes
export async function saveToUndo() {
    try {
        const currentData = await readJSONFile(SEQUENCE_FILE);
        const undoData = await readJSONFile(UNDO_FILE);
        
        if (!undoData.history) undoData.history = [];
        
        // Limit undo history to last 10 operations
        if (undoData.history.length >= 10) {
            undoData.history.shift();
        }
        
        undoData.history.push({
            timestamp: new Date().toISOString(),
            previousState: JSON.parse(JSON.stringify(currentData)) // Deep copy
        });
        
        await writeJSONFile(UNDO_FILE, undoData);
    } catch (error) {
        console.error('Failed to save undo state:', error.message);
    }
}