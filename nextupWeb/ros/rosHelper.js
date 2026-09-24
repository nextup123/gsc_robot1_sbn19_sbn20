// backend - rosHelper.js

import fs from "fs/promises";
import { parseXmlString } from "../user_config/customXmlParser.js";
import { ioFilePath, LOGS_JSON_FILE, LIVE_LOGS_JSON_FILE } from "../config/path.js";

const XML_PATH = ioFilePath.DO_DI_TREE_XML_FILE;
const LOG_FILE = LOGS_JSON_FILE;
const LIVE_LOG_FILE = LIVE_LOGS_JSON_FILE;

// Keep at most this many live-log entries on disk (ring buffer).
const LIVE_LOG_MAX = 2000;

// ===== Utility: Recursively search nodes =====
export function extractNodes(node, tagName, result = []) {
  if (!node || !node["@children"]) return result;

  for (const child of node["@children"]) {
    if (child.tagName === tagName) {
      result.push(child.content["@attributes"]);
    }
    extractNodes(child.content, tagName, result);
  }
  return result;
}

// ===== Async XML Parser =====
export const getParsedXml = async () => {
  const xmlContent = await fs.readFile(XML_PATH, "utf-8");
  return parseXmlString(xmlContent);
};


let writeQueue = Promise.resolve();

export function saveLogMessage(rawMsg) {
  // Queue every write so they execute one after another
  writeQueue = writeQueue
    .then(() => saveLogMessageInternal(rawMsg))
    .catch((err) => {
      console.error("Error in log queue:", err);
    });

  return writeQueue;
}

async function saveLogMessageInternal(rawMsg) {
  try {
    const parts = rawMsg.split(",");

    if (parts.length < 3) {
      console.warn("Invalid log format:", rawMsg);
      return;
    }

    const duration = parts.pop();
    const type = parts.pop();
    const message = parts.join(","); // Handles commas inside the message

    const logEntry = {
      message: message.trim(),
      duration: Number(duration),
      timestamp: new Date().toISOString(),
    };

    let data;

    try {
      const fileContent = await fs.readFile(LOG_FILE, "utf-8");
      data = JSON.parse(fileContent);
    } catch (err) {
      if (err.code === "ENOENT") {
        data = {
          failure: [],
          success: [],
          warn: [],
        };
      } else {
        throw err;
      }
    }

    if (!data[type]) {
      console.warn("Unknown log type:", type);
      return;
    }

    data[type].push(logEntry);

    // Keep only the latest 100 logs
    if (data[type].length > 100) {
      data[type] = data[type].slice(-100);
    }

    await fs.writeFile(LOG_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error saving log:", err);
  }
}

// ===================================================================
//  LIVE LOGS  (mirrors saveLogMessage, but for /logs_topic)
//  File shape: { logs: [ { message, level, timestamp } ] }
//  Stored oldest -> newest so the UI can render latest at the bottom.
// ===================================================================

let liveWriteQueue = Promise.resolve();

export function saveLiveLog(rawMsg) {
  // Serialize writes so concurrent messages never clobber the file.
  liveWriteQueue = liveWriteQueue
    .then(() => saveLiveLogInternal(rawMsg))
    .catch((err) => {
      console.error("Error in live log queue:", err);
    });

  return liveWriteQueue;
}

// Extract a level tag like "[warn] some text" -> { level:'warn', message:'some text' }
function parseLiveLevel(text) {
  const match = String(text).match(/^\s*\[(info|success|warn|failure)\]\s*(.*)$/is);
  if (!match) return { level: "info", message: String(text).trim() };
  return { level: match[1].toLowerCase(), message: match[2].trim() };
}

async function saveLiveLogInternal(rawMsg) {
  try {
    if (rawMsg == null || String(rawMsg).trim() === "") return;

    const { level, message } = parseLiveLevel(rawMsg);

    const logEntry = {
      message,
      level,
      timestamp: new Date().toISOString(),
    };

    let data;
    try {
      const fileContent = await fs.readFile(LIVE_LOG_FILE, "utf-8");
      data = JSON.parse(fileContent);
    } catch (err) {
      if (err.code === "ENOENT") {
        data = { logs: [] };
      } else {
        throw err;
      }
    }

    if (!data || !Array.isArray(data.logs)) data = { logs: [] };

    data.logs.push(logEntry);

    // Ring-buffer: keep only the most recent LIVE_LOG_MAX.
    if (data.logs.length > LIVE_LOG_MAX) {
      data.logs = data.logs.slice(-LIVE_LOG_MAX);
    }

    await fs.writeFile(LIVE_LOG_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error saving live log:", err);
  }
}

// Read the last `limit` live logs (oldest -> newest).
export async function readLiveLogs(limit = 500) {
  try {
    const fileContent = await fs.readFile(LIVE_LOG_FILE, "utf-8");
    const data = JSON.parse(fileContent);
    const logs = Array.isArray(data?.logs) ? data.logs : [];
    return limit > 0 ? logs.slice(-limit) : logs;
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

// Clear all live logs on disk.
export async function clearLiveLogs() {
  // Route through the same queue so we don't race an in-flight append.
  liveWriteQueue = liveWriteQueue
    .then(() => fs.writeFile(LIVE_LOG_FILE, JSON.stringify({ logs: [] }, null, 2)))
    .catch((err) => {
      console.error("Error clearing live logs:", err);
    });
  return liveWriteQueue;
}