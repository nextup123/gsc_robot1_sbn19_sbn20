
import { promises as fs } from 'fs';
import { LAYOUTS_DIR } from '../config/path.js';
// Ensure layouts directory exists
export async function ensureLayoutsDir() {
    try {
        await fs.mkdir(LAYOUTS_DIR, { recursive: true });
    } catch (err) {
        console.error('Error creating layouts directory:', err);
    }
}