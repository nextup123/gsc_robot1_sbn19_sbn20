
import path from 'path';
import yaml from 'js-yaml';
import { promises as fs } from 'fs';
import { MAPPED_DATA_PATH } from '../config/path.js';


export async function ensureDirectory() {
    const dir = path.dirname(MAPPED_DATA_PATH);
    try {
        await fs.access(dir);
    } catch {
        await fs.mkdir(dir, { recursive: true });
    }
}

// Read mapped data YAML
export async function readMappedData() {
    try {
        const content = await fs.readFile(MAPPED_DATA_PATH, 'utf8');
        return yaml.load(content);
    } catch (error) {
        return {
            mapped_data_file_name: 'mapped_data.yaml',
            description: 'Robot executable mapped data generated from articles.yaml',
            unit: { position: 'cm', orientation: 'deg' },
            mapped_data: {}
        };
    }
}

// Write mapped data YAML
export async function writeMappedData(data) {
    const yamlContent = yaml.dump(data, {
        indent: 2,
        lineWidth: -1,
        noRefs: true
    });
    await fs.writeFile(MAPPED_DATA_PATH, yamlContent, 'utf8');
}

ensureDirectory();
 