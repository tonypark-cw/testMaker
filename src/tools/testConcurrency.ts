import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// Cleanup previous sessions
const outputDir = path.join(process.cwd(), 'output');
const sessionFile = path.join(outputDir, 'session-mutex.json');
const storageFile = path.join(outputDir, 'session-mutex.storage.json');

if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
if (fs.existsSync(storageFile)) fs.unlinkSync(storageFile);

console.log('[Test] cleaned up previous session files.');

function runWorker(name: string, delay: number) {
    return new Promise((resolve) => {
        setTimeout(() => {
            console.log(`[${name}] Starting...`);
            // Use verifyMultiSession logic via independent runs or actual search
            // Using verifyMultiSession is faster/safer than full search
            const p = spawn('npx', ['tsx', 'src/tools/verifyMultiSession.ts'], {
                cwd: process.cwd(),
                env: { ...process.env, COMPONENT_NAME: name, FORCE_COLOR: 'true' },
                shell: true
            });

            p.stdout.on('data', (data) => {
                const lines = data.toString().split('\n');
                lines.forEach((line: string) => {
                    if (line.trim()) console.log(`[${name}] ${line.trim()}`);
                });
            });

            p.stderr.on('data', (data) => {
                const lines = data.toString().split('\n');
                lines.forEach((line: string) => {
                    if (line.trim()) console.error(`[${name}] ERR: ${line.trim()}`);
                });
            });

            p.on('close', (code) => {
                console.log(`[${name}] Exited with code ${code}`);
                resolve(code);
            });
        }, delay);
    });
}

async function run() {
    // Start Worker A immediately
    const p1 = runWorker('Worker A', 0);

    // Start Worker B 2 seconds later (race condition simulation)
    const p2 = runWorker('Worker B', 2000);

    await Promise.all([p1, p2]);
}

run().catch(console.error);
