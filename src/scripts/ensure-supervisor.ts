import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const pidPath = path.join(process.cwd(), 'output', 'supervisor.pid');
let isRunning = false;

if (fs.existsSync(pidPath)) {
    try {
        const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim());
        if (pid) {
            process.kill(pid, 0);
            isRunning = true;
        }
    } catch {
        isRunning = false;
    }
}

if (!isRunning) {
    console.log('[Watcher] Supervisor is not running. Starting in background...');
    const tsxPath = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const child = spawn('node', [tsxPath, 'src/core/supervisor.ts'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: false
    });
    child.unref();
    console.log('[Watcher] Supervisor started.');
} else {
    console.log('[Watcher] Supervisor is already active.');
}
