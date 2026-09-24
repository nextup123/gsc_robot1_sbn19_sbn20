
import fs from 'fs';
import readline from 'readline';
import { ERROR_LOGS_PATH } from "../config/path.js";

export async function readLastErrorLogs(limit) {
    if (!fs.existsSync(ERROR_LOGS_PATH)) {// CHecking if files exists or not
    return [];
}
    const stream = fs.createReadStream(ERROR_LOGS_PATH, { encoding: 'utf8' });

    const rl = readline.createInterface({
        input: stream,
        crlfDelay: Infinity
    });

    const buffer = [];
    let current = null;
    let insideList = false;

    for await (const line of rl) {
        const trimmed = line.trim();

        // Detect start of error_logs list
        if (trimmed === 'error_logs:') {
            insideList = true;
            continue;
        }

        if (!insideList) continue;

        // New entry
        if (trimmed.startsWith('- time:')) {
            if (current) {
                buffer.push(current);
                if (buffer.length > limit) buffer.shift();
            }

            current = {
                time: trimmed.replace('- time:', '').trim()
            };
        }
        else if (current && trimmed.startsWith('joint:')) {
            current.joint = trimmed.replace('joint:', '').trim();
        }
        else if (current && trimmed.startsWith('last_error:')) {
            current.last_error = Number(
                trimmed.replace('last_error:', '').trim()
            );
        }
    }

    // Push final entry
    if (current) {
        buffer.push(current);
        if (buffer.length > limit) buffer.shift();
    }

    return buffer;

}
