

import { promises as fs } from 'fs';
import path from 'path';
import { ensureLayoutsDir } from '../service/layoutService.js';
import { LAYOUTS_DIR } from '../config/path.js';

export const listLayoutController = async (req, res) => {
    try {
        await ensureLayoutsDir();
        const files = await fs.readdir(LAYOUTS_DIR);
        const layouts = [];

        for (const file of files) {
            if (file.endsWith('.json')) {
                try {
                    const filePath = path.join(LAYOUTS_DIR, file);
                    const content = await fs.readFile(filePath, 'utf8');
                    const layout = JSON.parse(content);
                    layouts.push({
                        name: layout.name || path.basename(file, '.json'),
                        description: layout.description || '',
                        timestamp: layout.timestamp || '',
                        fileSize: content.length
                    });
                } catch (err) {
                    console.warn(`Error reading layout file ${file}:`, err.message);
                }
            }
        }

        // Sort by timestamp (newest first)
        layouts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        res.json(layouts);
    } catch (err) {
        console.error('Error listing layouts:', err);
        res.status(500).json({ error: 'Failed to list layouts' });
    }
}

export const saveLayoutController = async (req, res) => {
    try {
        await ensureLayoutsDir();
        const layoutData = req.body;

        if (!layoutData.name || !layoutData.name.trim()) {
            return res.status(400).json({ error: 'Layout name is required' });
        }

        // Sanitize filename
        const safeName = layoutData.name.replace(/[^a-zA-Z0-9_\-\s]/g, '_');
        const filePath = path.join(LAYOUTS_DIR, `${safeName}.json`);

        await fs.writeFile(filePath, JSON.stringify(layoutData, null, 2));
        res.json({ success: true, name: safeName });
    } catch (err) {
        console.error('Error saving layout:', err);
        res.status(500).json({ error: 'Failed to save layout' });
    }
}

export const loadByNameController =  async (req, res) => {
    try {
        await ensureLayoutsDir();
        const safeName = req.params.name.replace(/[^a-zA-Z0-9_\-\s]/g, '_');
        const filePath = path.join(LAYOUTS_DIR, `${safeName}.json`);

        const content = await fs.readFile(filePath, 'utf8');
        const layoutData = JSON.parse(content);
        res.json(layoutData);
    } catch (err) {
        console.error('Error loading layout:', err);
        res.status(404).json({ error: 'Layout not found' });
    }
}

export const deleteByNameController = async (req, res) => {
    try {
        await ensureLayoutsDir();
        const safeName = req.params.name.replace(/[^a-zA-Z0-9_\-\s]/g, '_');
        const filePath = path.join(LAYOUTS_DIR, `${safeName}.json`);

        await fs.unlink(filePath);
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting layout:', err);
        res.status(404).json({ error: 'Layout not found' });
    }
}