//mainTreeService.js

import fs from 'fs/promises';
import path from 'path';

import { fileURLToPath } from 'url';
import { jsonToXml, parseXmlString } from '../user_config/customXmlParser.js';
import { NODES_JSON_PATH, TEMPLATE_PATH } from '../config/path.js';

export {NODES_JSON_PATH} from "../config/path.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function readAndParseXML(filePath = TEMPLATE_PATH, forceXml2jsParse = false) {
  try {
    const baseName = path.basename(filePath, '.xml');
    const UID_CACHE_PATH = path.join('/home/nextup/NextupRobot/src/active_project_configs', `${baseName}_with_uids.json`);
    if (!forceXml2jsParse) {
      try {
        
        const cached = await fs.readFile(UID_CACHE_PATH, 'utf-8');
        return JSON.parse(cached);
      } catch {
      }
    } else {
    }

    const xmlData = await fs.readFile(filePath, 'utf-8');
    const json = parseXmlString(xmlData);
    await fs.writeFile(UID_CACHE_PATH, JSON.stringify(json, null, 2));
    return json;
  } catch (err) {
    console.error(`❌ Error in readAndParseXML(${filePath}):`, err);
    throw err;
  }
}



export async function writeXML(jsonObj, filePath = TEMPLATE_PATH) {
  try {
    const baseName = path.basename(filePath, '.xml');
    const UID_CACHE_PATH = path.join('/home/nextup/NextupRobot/src/active_project_configs', `${baseName}_with_uids.json`);
    await fs.writeFile(UID_CACHE_PATH, JSON.stringify(jsonObj, null, 2));
    const xml = jsonToXml({ root: jsonObj }, true);
    await fs.writeFile(filePath, xml, 'utf-8');
  } catch (err) {
    console.error('Error writing XML:', err);
    throw err;
  }
}


// Utility: Read / Write nodes.json
export async function readNodeDefs() {
  const data = await fs.readFile(NODES_JSON_PATH, 'utf-8');
  return JSON.parse(data);
}

export async function writeNodeDefs(defs) {
  await fs.writeFile(NODES_JSON_PATH, JSON.stringify(defs, null, 2));
}

// Unique ID helper (used only for external visible IDs)
export function ensureUids(node) {
  if (!node || typeof node !== 'object') return;
  if (node['@attributes']) {
    if (!node['@attributes']._uid) {
      node['@attributes']._uid = generateUniqueId('uid_');
    }
  }
  if (Array.isArray(node['@children'])) {
    node['@children'].forEach(child => ensureUids(child.content));
  }
}

export function generateUniqueId(prefix = '') {
  return `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function updateNodeIds(node, prefix = '') {
  if (node.$ && (node.$.ID || node.$.id)) {
    node.$.ID = generateUniqueId(prefix);
  }
  for (const key in node) {
    if (Array.isArray(node[key])) {
      node[key].forEach(child => updateNodeIds(child, `${prefix}${key}_`));
    }
  }
}

export function findNodeById(node, targetId, parent = null, parentArray = null, parentKey = null, index = -1) {
  const currentId = node.$?.ID || node.$?.id;
  if (currentId === targetId) {
    return { node, parent, parentArray, parentKey, index };
  }
  for (const key in node) {
    if (Array.isArray(node[key])) {
      for (let i = 0; i < node[key].length; i++) {
        const child = node[key][i];
        const result = findNodeById(child, targetId, node, node[key], key, i);
        if (result.node) return result;
      }
    }
  }
  return { node: null, parent: null, parentArray: null, parentKey: null, index: -1 };
}