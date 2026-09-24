import { promises as fs } from 'fs';
import { readMappedData, writeMappedData } from "../service/mappedDataService.js";

export const getMappedDataController = async (req, res) => {
    try {
        const data = await readMappedData();
        res.json(data);
    } catch (error) {
        console.error('Error reading mapped data:', error);
        res.status(500).json({ error: 'Failed to read mapped data' });
    }
}

export const postMappedDataController = async (req, res) => {
    try {
        const { mapped_data } = req.body;
        
        if (mapped_data === undefined) {
            return res.status(400).json({ error: 'mapped_data is required' });
        }
        
        const currentData = await readMappedData();
        currentData.mapped_data = mapped_data;
        
        await writeMappedData(currentData);
        
        res.json({ success: true, message: 'Mapped data updated' });
    } catch (error) {
        console.error('Error saving mapped data:', error);
        res.status(500).json({ error: 'Failed to save mapped data' });
    }
}

export const mappedDataByKeyController = async (req, res) => {
    try {
        const { key } = req.params;
        const entry = req.body;
        
        // Validate required fields
        const requiredFields = ['shoe_foot_type', 'y_cm'];
        for (const field of requiredFields) {
            if (entry[field] === undefined) {
                return res.status(400).json({ error: `Missing required field: ${field}` });
            }
        }
        
        const currentData = await readMappedData();
        currentData.mapped_data[key] = entry;
        
        await writeMappedData(currentData);
        
        res.json({ success: true, key, entry });
    } catch (error) {
        console.error('Error saving entry:', error);
        res.status(500).json({ error: 'Failed to save entry' });
    }
}

export const deleteMappedDataByKeyController = async (req, res) => {
    try {
        const { key } = req.params;
        
        const currentData = await readMappedData();
        
        if (!currentData.mapped_data[key]) {
            return res.status(404).json({ error: 'Entry not found' });
        }
        
        delete currentData.mapped_data[key];
        await writeMappedData(currentData);
        
        res.json({ success: true, message: `Deleted ${key}` });
    } catch (error) {
        console.error('Error deleting entry:', error);
        res.status(500).json({ error: 'Failed to delete entry' });
    }
}

export const mappedDataRawController = async (req, res) => {
    try {
        const content = await fs.readFile(MAPPED_DATA_PATH, 'utf8');
        res.type('text/yaml').send(content);
    } catch (error) {
        res.status(500).json({ error: 'Failed to read raw YAML' });
    }
}

