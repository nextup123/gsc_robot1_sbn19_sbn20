import express from 'express';
import fs from 'fs-extra';
import path from 'path';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const logsDir = path.resolve(__dirname, "../public/ui_micron_diagnosis/logs");

const pendriveBasePath = "/media/rocket";

////////////////////////////////////////////////////////////////////////////////////////////

// List pendrives
router.get('/list-pendrives', async (req, res) => {
    try {
        const pendrives = await fs.promises.readdir(pendriveBasePath);
        res.json(pendrives); // Returns an array of pendrive folder names
    } catch (error) {
        console.error('Error listing pendrives:', error);
        res.status(500).json({ error: 'Failed to list pendrives', details: error.message });
    }
});

// Copy files recursively
const copyRecursive = async (source, destination) => {
    await fs.promises.mkdir(destination, { recursive: true });
    const items = await fs.promises.readdir(source, { withFileTypes: true });

    for (const item of items) {
        const sourcePath = path.join(source, item.name);
        const destinationPath = path.join(destination, item.name);

        if (item.isDirectory()) {
            await copyRecursive(sourcePath, destinationPath);
        } else {
            await fs.promises.copyFile(sourcePath, destinationPath);
        }
    }
};

// Copy files API
router.post('/copy-files', async (req, res) => {
    const { sourceFilePath, pendrivePath } = req.body;

    if (!sourceFilePath || !pendrivePath) {
        return res.status(400).json({ error: "Source file path and pendrive path are required" });
    }

    try {
        const stats = await fs.promises.stat(sourceFilePath);
        if (stats.isDirectory()) {
            await copyRecursive(sourceFilePath, pendrivePath);
        } else {
            await fs.promises.copyFile(sourceFilePath, path.join(pendrivePath, path.basename(sourceFilePath)));
        }
        res.json({ message: 'Data copied successfully to Pendrive' });
    } catch (error) {
        console.error('Error copying data:', error);
        res.status(500).json({ error: 'Failed to copy data', details: error.message });
    }
});

////////////////////////////////////////////////////////////////////////////////////////////

router.get("/logs-structure", (req, res) => {
    try {
        const years = fs
            .readdirSync(logsDir)
            .filter(year => fs.statSync(path.join(logsDir, year)).isDirectory());
        const structure = years.map(year => {
            const months = fs
                .readdirSync(path.join(logsDir, year))
                .filter(month =>
                    fs.statSync(path.join(logsDir, year, month)).isDirectory()
                );
            return { year, months };
        });


        res.json(structure);
    } catch (error) {
        // Log the error to the terminal
        console.error("Error reading logs structure:", error);
        res.status(500).send("Error reading logs structure");
    }
});

// Route to get months for a given year
router.get('/logs/:year', (req, res) => {
    const { year } = req.params;
    const yearPath = path.join(logsDir, year); // Changed logsDirectory to logsDir

    if (fs.existsSync(yearPath)) {
        const months = fs.readdirSync(yearPath).filter(file => fs.statSync(path.join(yearPath, file)).isDirectory());
        res.json(months);
    } else {
        res.status(404).send('Year not found');
    }
});

// Fetch logs for a specific year/month
router.get("/:year/:month", (req, res) => {
    const { year, month } = req.params;
    const dirPath = path.join(logsDir, year, month);
    try {
        const dates = fs.readdirSync(dirPath).filter(file => file.endsWith(".xlsx"));
        res.json(dates);
    } catch (error) {
        console.error(`Error reading logs for ${month} ${year}:`, error);
        res.status(500).send("Error reading logs for the month");
    }
});

// API to get the list of dates for a given year and month
router.get("/logs/:year/:month", (req, res) => {
  const { year, month } = req.params;
  const dirPath = path.join(logsDir, year, month);
  try {
    const dates = fs
      .readdirSync(dirPath)
      .filter(file => file.endsWith(".xlsx"));
    res.json(dates);
  } catch (error) {
    // Log the error to the terminal
    console.error(`Error reading logs for ${month} ${year}:`, error);
    res.status(500).send("Error reading logs for the month");
  }
});

// API to load an Excel file's data
router.get("/logs/:year/:month/:date", (req, res) => {
  const { year, month, date } = req.params;
  const filePath = path.join(logsDir, year, month, date); // Use path.join
  try {
    const workbook = xlsx.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet);
    res.json(data);
  } catch (error) {
    console.error(`Error reading Excel file: ${filePath}`, error);
    res.status(500).send("Error reading Excel file");
  }
});


export default router;