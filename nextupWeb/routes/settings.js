// routes/settings.js
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const SETTINGS_PATH = path.join(__dirname, '../user_config/user_settings.json');

// Utility function to read settings
function readSettings() {
  try {
    const data = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading settings:', err);
    return { mode: 'testing', speed: 0.2, cnc: 'none' };
  }
}

// Utility function to save settings
function writeSettings(newSettings) {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(newSettings, null, 2));
    return true;
  } catch (err) {
    console.error('Error writing settings:', err);
    return false;
  }
}

// 🟢 GET - Read settings
router.get('/', (req, res) => {
  const settings = readSettings();
  res.json(settings);
});

// 🔵 POST - Update settings
router.post('/', express.json(), (req, res) => {
  const newSettings = req.body;
  const success = writeSettings(newSettings);
  if (success) res.json({ message: 'Settings saved successfully', data: newSettings });
  else res.status(500).json({ message: 'Failed to save settings' });
});

export default router;