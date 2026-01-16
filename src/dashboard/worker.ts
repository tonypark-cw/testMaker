import { spawn } from 'child_process';
import * as http from 'http';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
// [FIX] Use DASHBOARD_USER/PASS to match server.ts
const AUTH_USER = process.env.DASHBOARD_USER || process.env.AUTH_USER;
const AUTH_PASS = process.env.DASHBOARD_PASS || process.env.AUTH_PASS;

// Helper for Basic Auth header
const getAuthHeader = () => {
    if (!AUTH_USER || !AUTH_PASS) return {};
    const auth = Buffer.from(`${AUTH_USER}:${AUTH_PASS}`).toString('base64');
    return { 'Authorization': `Basic ${auth}` };
};

async function fetchJob(): Promise<any> {
    return new Promise((resolve) => {
        const options = {
            headers: {
                ...getAuthHeader(),
            }
        };

        http.get(`${SERVER_URL}/api/worker/next`, options, (res) => {
            if (res.statusCode === 204) return resolve(null);
            if (res.statusCode === 401) {
                console.error(`[Worker] Error: 401 Unauthorized. (User: ${AUTH_USER || 'undefined'})`);
                console.error('         Check DASHBOARD_USER/DASHBOARD_PASS in .env');
                return resolve(null);
            }

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch {
                    resolve(null);
                }
            });
        }).on('error', (err) => {
            console.error(`[Worker] Connectivity Error: ${err.message}`);
            resolve(null);
        });
    });
}

async function updateStatus(running: boolean) {
    const data = JSON.stringify({ running });
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
            ...getAuthHeader(),
        }
    };

    const req = http.request(`${SERVER_URL}/api/worker/status`, options);
    req.on('error', (err) => console.error('[Worker] Status Update Error:', err.message));
    req.write(data);
    req.end();
}

async function start() {
    console.log('--- Worker Mode Started ---');
    console.log(`Polling Dashboard at ${SERVER_URL}...`);
    if (AUTH_USER) {
        console.log(`[Worker] Authentication: ENABLED (User: ${AUTH_USER})`);
    } else {
        console.warn(`[Worker] Warning: No AUTH_USER or DASHBOARD_USER found in .env`);
    }

    let pollCount = 0;

    while (true) {
        try {
            const job = await fetchJob();
            if (job) {
                console.log(`\n[Worker] 📥 Picked up job: ${job.url}`);
                await updateStatus(true);

                const args = ['run', 'search', '--', '--url', job.url, '--force'];
                if (job.depth) args.push('--depth', String(job.depth));
                if (job.limit) args.push('--limit', String(job.limit));

                console.log(`[Worker] 🚀 Executing: npm ${args.join(' ')}`);

                const child = spawn('npm', args, {
                    stdio: 'inherit',
                    shell: true,
                    env: { ...process.env, FORCE_COLOR: '3' }
                });

                await new Promise((resolve) => {
                    child.on('exit', (code) => {
                        console.log(`[Worker] ✅ Process exited with code ${code}`);
                        resolve(code);
                    });
                    child.on('error', (err) => {
                        console.error(`[Worker] ❌ Failed to start child process:`, err);
                        resolve(1);
                    });
                });

                console.log(`[Worker] 🏁 Job finished.\n`);
                await updateStatus(false);
            } else {
                pollCount++;
            }
        } catch (e: any) {
            console.error('[Worker] Error in loop:', e.message);
        }
        await new Promise(r => setTimeout(r, 2000));
    }
}

start().catch(console.error);
