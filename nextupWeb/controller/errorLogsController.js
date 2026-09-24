import fs from "fs/promises";
import { spawn } from "child_process";

import {
  DESCRIPTION_PATH,
  COMMANDS_PATH,
  OPEN_TERMINAL_PATH,
  FAULTJSONPATH,
} from "../config/path.js";

import { readLastErrorLogs } from "../service/errorLogsService.js";
import { readLiveLogs, clearLiveLogs } from "../ros/rosHelper.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("controller", "errorLogsController.js");

const DEFAULT_LIMIT = 500;
const HARD_LIMIT = 2000;

// ─────────────────────────────────────────────────────────────
// ERROR LOGS
// ─────────────────────────────────────────────────────────────

export const getErrorLogsController = async (req, res) => {
  const limit = Math.min(
    parseInt(req.query.limit) || DEFAULT_LIMIT,
    HARD_LIMIT
  );

  try {
    const logs = await readLastErrorLogs(limit);

    res.json({
      count: logs.length,
      logs,
    });
  } catch (err) {
    log.error(
      {
        err,
        function: getErrorLogsController,
      },
      "Error reading error logs"
    );

    res.status(500).json({
      error: "Failed to read error logs",
    });
  }
};

// ─────────────────────────────────────────────────────────────
// LIVE LOGS  (/logs_topic persisted to live_logs.json)
// ─────────────────────────────────────────────────────────────

export const getLiveLogsController = async (req, res) => {
  const limit = Math.min(
    parseInt(req.query.limit) || DEFAULT_LIMIT,
    HARD_LIMIT
  );

  try {
    const logs = await readLiveLogs(limit); // oldest -> newest

    res.json({
      count: logs.length,
      logs,
    });
  } catch (err) {
    log.error(
      {
        err,
        function: getLiveLogsController,
      },
      "Error reading live logs"
    );

    res.status(500).json({
      error: "Failed to read live logs",
    });
  }
};

export const clearLiveLogsController = async (req, res) => {
  try {
    await clearLiveLogs();

    res.json({
      status: "cleared",
    });
  } catch (err) {
    log.error(
      {
        err,
        function: clearLiveLogsController,
      },
      "Error clearing live logs"
    );

    res.status(500).json({
      error: "Failed to clear live logs",
    });
  }
};

// ─────────────────────────────────────────────────────────────
// DESCRIPTION
// ─────────────────────────────────────────────────────────────

export const getDescriptionController = async (req, res) => {
  try {
    const data = await fs.readFile(DESCRIPTION_PATH, "utf8");

    res.type("text/plain").send(data);
  } catch (err) {
    log.error({
      err,
      function: getDescriptionController,
    });

    res.status(500).send("Failed to read description");
  }
};

export const postDescriptionController = async (req, res) => {
  const content = req.body.content ?? "";

  try {
    await fs.writeFile(DESCRIPTION_PATH, content, "utf8");

    res.json({
      status: "saved",
    });
  } catch (err) {
    log.error({
      err,
      function: postDescriptionController,
    });

    res.status(500).json({
      error: "Failed to save",
    });
  }
};

// ─────────────────────────────────────────────────────────────
// COMMANDS
// ─────────────────────────────────────────────────────────────

export const getCommandsController = async (req, res) => {
  try {
    const data = await fs.readFile(COMMANDS_PATH, "utf8");

    res.json(JSON.parse(data));
  } catch (err) {
    log.error({
      err,
      function: getCommandsController,
    });

    res.json({
      cells: [],
    });
  }
};

export const postCommandsController = async (req, res) => {
  try {
    await fs.writeFile(
      COMMANDS_PATH,
      JSON.stringify(req.body, null, 2),
      "utf8"
    );

    res.json({
      status: "saved",
    });
  } catch (err) {
    log.error({
      err,
      function: postCommandsController,
    });

    res.status(500).json({
      error: "save failed",
    });
  }
};

// ─────────────────────────────────────────────────────────────
// OPEN TERMINAL
// ─────────────────────────────────────────────────────────────

export const openTerminalController = async (req, res) => {
  try {
    spawn(OPEN_TERMINAL_PATH, [], {
      detached: true,
      stdio: "ignore",
    }).unref();

    res.json({
      status: "terminal launched",
    });
  } catch (err) {
    log.error(
      {
        err,
        function: openTerminalController,
      },
      "Failed to launch terminal script"
    );

    res.status(500).json({
      error: "failed to launch terminal",
    });
  }
};

// ─────────────────────────────────────────────────────────────
// FAULT DATABASE
// ─────────────────────────────────────────────────────────────

const faultsPath = FAULTJSONPATH;

export const fetchErrorController = async (req, res) => {
  try {

    const data = await fs.readFile(faultsPath, "utf8");

    res.json(JSON.parse(data));
  } catch (err) {
    log.error({
      err,
      function: fetchErrorController,
    });

    res.status(500).json({
      error: "Failed to read faults.json",
    });
  }
};