const express = require("express");
const fs = require("fs-extra");
const path = require("path");

const router = express.Router();
const pendriveBasePath = "/media/rocket";

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

module.exports = router;
