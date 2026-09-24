
import fs from "fs";
import xml2js from "xml2js";
import { pathPlanningFilePath } from "../config/path.js";


const XML_FILE = pathPlanningFilePath.PATH_PLAN_TREE_XML_FILE;
const XML_BACKUP_FILE = pathPlanningFilePath.PATH_PLAN_TREE_XML_BACKUP_FILE;


const parser = new xml2js.Parser({ explicitArray: false });
const builder = new xml2js.Builder();

export function buildXML(json){
    return builder.buildObject(json);
}

export function fileExists(filePath) {
    try {   
        return fs.existsSync(filePath);
    } catch (err) { 
        return false;
    }
}

// Create backup of current XML
export async function createBackup() {
    try {
        if (fileExists(XML_FILE)) {
            const data = fs.readFileSync(XML_FILE, 'utf8');
            fs.writeFileSync(XML_BACKUP_FILE, data, 'utf8');
            return true;
        }
        return false;
    } catch (err) {
        console.error('Error creating backup:', err);
        return false;
    }
}

// Swap the main XML file with the backup
export async function swapWithBackup() {
    try {
        // Check if backup exists
        if (!fileExists(XML_BACKUP_FILE)) {
            throw new Error('No backup file exists to undo to');
        }

        // Read backup content
        const backupData = fs.readFileSync(XML_BACKUP_FILE, 'utf8');

        // Create a temporary backup of current state
        if (fileExists(XML_FILE)) {
            const currentData = fs.readFileSync(XML_FILE, 'utf8');
            fs.writeFileSync(`${XML_BACKUP_FILE}.tmp`, currentData, 'utf8');
        }

        // Write backup data to main file
        fs.writeFileSync(XML_FILE, backupData, 'utf8');

        // Replace backup with the temporary backup (for redo functionality if needed)
        if (fileExists(`${XML_BACKUP_FILE}.tmp`)) {
            fs.renameSync(`${XML_BACKUP_FILE}.tmp`, XML_BACKUP_FILE);
        } else {
            // If no current file existed, remove the backup after undo
            fs.unlinkSync(XML_BACKUP_FILE);
        }

        return true;
    } catch (err) {
        console.error('Error swapping files:', err);
        throw err;
    }
}



// Modified saveXML function to create backup before saving
export async function saveXML(json) {
    try {
        // Create backup before making changes
        await createBackup();

        const xml = buildXML(json);
        fs.writeFileSync(XML_FILE, xml, 'utf8');
    } catch (err) {
        throw new Error(`Failed to save XML: ${err.message}`);
    }
}

export async function loadXML() {
    try {
        if (!fileExists(XML_FILE)) {
            // If main file doesn't exist, check if backup exists
            if (fileExists(XML_BACKUP_FILE)) {
                console.log('Main XML file not found, using backup');
                fs.copyFileSync(XML_BACKUP_FILE, XML_FILE);
            } else {
                throw new Error('XML file not found');
            }
        }

        const data = fs.readFileSync(XML_FILE, 'utf8');
        return await new Promise((resolve, reject) => {
            parser.parseString(data, (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });
    } catch (err) {
        throw new Error(`Failed to load XML: ${err.message}`);
    }
}

export function findRootPlanSequence(data) {
    try {
        let mainSeq = data.root.BehaviorTree.Sequence.Start.Fallback.Sequence;

        if (Array.isArray(mainSeq)) {
            mainSeq = mainSeq.find(s => s.$?.name === 'main_seq');
        } else if (mainSeq.$?.name !== 'main_seq') {
            return null;
        }

        if (!mainSeq) return null;

        let rootSeq = mainSeq.Sequence;

        if (Array.isArray(rootSeq)) {
            rootSeq = rootSeq.find(s => s.$?.name === 'root_plan_sequence');
        } else if (rootSeq.$?.name !== 'root_plan_sequence') {
            return null;
        }

        return rootSeq;
    } catch (error) {
        console.error('Error finding root_plan_sequence:', error);
        return null;
    }
}

export async function initXMLBackup() {

    if (fileExists(XML_FILE) && !fileExists(XML_BACKUP_FILE)) {
        try {
            fs.writeFileSync(XML_BACKUP_FILE, fs.readFileSync(XML_FILE, "utf8"));
            console.log("Initial xml plan bt backup created");
        } catch (err) {
            console.error("Failed to create initial xml plan bt backup:", err);
        }
    }
}