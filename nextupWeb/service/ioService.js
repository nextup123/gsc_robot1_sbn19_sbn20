import xml2js from 'xml2js';
import { promises as fs } from 'fs';
import { ioFilePath } from '../config/path.js';


const XML_FILE = ioFilePath.DO_DI_TREE_XML_FILE;
const XML_BACKUP_FILE = ioFilePath.DO_DI_TREE_XML_BACKUP_FILE;
const parser = new xml2js.Parser({ explicitArray: false });

const builder = new xml2js.Builder({ xmldec: { version: '1.0', encoding: 'UTF-8', standalone: 'yes' } });


export function buildXML(json){
    return builder.buildObject(json);
}

export async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

export async function createBackup() {
    try {
        if (await fileExists(XML_FILE)) {
            const data = await fs.readFile(XML_FILE, 'utf8');
            await fs.writeFile(XML_BACKUP_FILE, data, 'utf8');
            return true;
        }
        return false;
    } catch (err) {
        console.error('Error creating backup:', err);
        return false;
    }
}

export async function swapWithBackup() {
    try {
        if (!await fileExists(XML_BACKUP_FILE)) {
            throw new Error('No backup file exists to undo to');
        }
        const backupData = await fs.readFile(XML_BACKUP_FILE, 'utf8');
        if (await fileExists(XML_FILE)) {
            const currentData = await fs.readFile(XML_FILE, 'utf8');
            await fs.writeFile(`${XML_BACKUP_FILE}.tmp`, currentData, 'utf8');
        }
        await fs.writeFile(XML_FILE, backupData, 'utf8');
        if (await fileExists(`${XML_BACKUP_FILE}.tmp`)) {
            await fs.rename(`${XML_BACKUP_FILE}.tmp`, XML_BACKUP_FILE);
        } else {
            await fs.unlink(XML_BACKUP_FILE);
        }
        return true;
    } catch (err) {
        console.error('Error swapping files:', err);
        throw err;
    }
}

export async function saveXML(json) {
    try {
        await createBackup();
        const xml = buildXML(json);
        await fs.writeFile(XML_FILE, xml, 'utf8');
    } catch (err) {
        throw new Error(`Failed to save XML: ${err.message}`);
    }
}

export async function loadXML() {
    try {
        if (!await fileExists(XML_FILE)) {
            if (await fileExists(XML_BACKUP_FILE)) {
                console.log('Main XML file not found, using backup');
                await fs.copyFile(XML_BACKUP_FILE, XML_FILE);
            } else {
                throw new Error('XML file not found');
            }
        }
        const data = await fs.readFile(XML_FILE, 'utf8');
        return await parser.parseStringPromise(data);
    } catch (err) {
        throw new Error(`Failed to load XML: ${err.message}`);
    }
}

export async function initIOXMLBackup() {
    if (await fileExists(XML_FILE) && !await fileExists(XML_BACKUP_FILE)) {
        try {
            await fs.writeFile(XML_BACKUP_FILE, await fs.readFile(XML_FILE, 'utf8'));
            console.log('Initial XML control tree backup created');
        } catch (err) {
            console.error('Failed to create initial XML control tree backup:', err);
        }
    }
}