/**
 * TestMaker Dashboard Server
 * HTTP server with API endpoints for dashboard UI
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Module imports
import { FileSystemWatcher } from './lib/FileSystemWatcher.js';
import {
    OUTPUT_DIR,
    TAGS_FILE,
    REASONS_FILE,
    loadTags,
    loadReasons,
    updateTag,
    updateReason
} from './lib/helpers.js';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PORT = 3000;

// Mode Detection
const isExternalWorkerMode = process.env.EXTERNAL_WORKER?.trim().toLowerCase() === 'true';

// Server State
let isRunning = false;
let currentProcess: any = null;
let jobQueue: Array<{ url: string, depth?: number, limit?: number }> = [];

// Global Watcher Instance
let watcher: FileSystemWatcher;

// Basic Auth
const AUTH_USER = process.env.DASHBOARD_USER;
const AUTH_PASS = process.env.DASHBOARD_PASS;

// ===== Job Queue Processing =====
const processQueue = () => {
    if (isRunning || jobQueue.length === 0) return;

    const nextJob = jobQueue[0];
    if (!nextJob) return;

    if (isExternalWorkerMode) return;

    jobQueue.shift();
    try {
        if (process.env.EXTERNAL_WORKER !== 'true') {
            console.log(`[Dashboard] Starting queued job for ${nextJob.url}...`);
        }
        isRunning = true;

        const tsxPath = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
        const searchArgs = ['src/core/cli.ts', '--url', nextJob.url, '--force'];
        if (nextJob.depth) searchArgs.push('--depth', String(nextJob.depth));
        if (nextJob.limit) searchArgs.push('--limit', String(nextJob.limit));

        currentProcess = spawn('node', [tsxPath, ...searchArgs], {
            stdio: 'pipe', // Use pipe instead of inherit to avoid terminal requests
            shell: false,
            windowsHide: true
        });

        currentProcess.on('close', (code: number) => {
            console.log(`[Dashboard] Job finished with code ${code}`);
            isRunning = false;
            currentProcess = null;
            setTimeout(processQueue, 1000);
        });

        currentProcess.on('error', (err: Error) => {
            console.error('[Dashboard] Failed to start process:', err);
            isRunning = false;
            currentProcess = null;
            setTimeout(processQueue, 1000);
        });
    } catch (e) {
        console.error('[Dashboard] Job execution error:', e);
        isRunning = false;
        setTimeout(processQueue, 1000);
    }
};

// ===== Stats API =====
async function getStats(environment = 'stage') {
    const screenshots = watcher.getScreenshots(environment);
    screenshots.sort((a, b) => b.time - a.time);

    const tags = loadTags();

    let latestTrace = '';
    const envOutputDir = path.join(OUTPUT_DIR, environment);
    if (fs.existsSync(envOutputDir)) {
        const traces = fs.readdirSync(envOutputDir).filter(f => f.startsWith('trace-') && f.endsWith('.zip'));
        if (traces.length > 0) {
            traces.sort().reverse();
            latestTrace = '/output/' + environment + '/' + traces[0];
        }
    }

    let isActuallyRunning = isRunning || jobQueue.length > 0;
    if (!isActuallyRunning) {
        try {
            const { exec } = await import('child_process');
            const util = await import('util');
            const execAsync = util.promisify(exec);
            // Process check is platform specific, returning empty for now to avoid crashes on Windows
            const stdout: string = '';
            if (stdout && stdout.trim()) isActuallyRunning = true;
        } catch {
            /* ignored */
        }
    }

    let supervisorStatus = { overall: 'unknown' };
    try {
        const supPath = path.join(OUTPUT_DIR, 'supervisor_status.json');
        if (fs.existsSync(supPath)) {
            supervisorStatus = JSON.parse(fs.readFileSync(supPath, 'utf-8'));
        }
    } catch {
        /* ignored */
    }

    return {
        searchedCount: screenshots.length,
        screenshots,
        latestTrace,
        tags,
        reasons: loadReasons(),
        isRunning: isActuallyRunning,
        queueLength: jobQueue.length,
        latestScanTime: watcher.getLatestScanTime(),
        supervisor: supervisorStatus
    };
}

// ===== HTTP Server =====
const server = http.createServer(async (req, res) => {
    // Authentication
    const auth = req.headers['authorization'];
    if (!auth) {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="TestMaker Dashboard"' });
        res.end('Authentication required');
        return;
    }
    const [scheme, credentials] = auth.split(' ');
    if (scheme !== 'Basic' || !credentials) {
        res.writeHead(401); res.end('Invalid auth scheme'); return;
    }
    const [user, pass] = Buffer.from(credentials, 'base64').toString().split(':');
    if (user !== AUTH_USER || pass !== AUTH_PASS) {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Valid credentials required"' });
        res.end('Invalid credentials');
        return;
    }

    // Parse URL
    const baseURL = 'http://' + (req.headers.host || 'localhost');
    const reqUrl = new URL(req.url || '', baseURL);
    const pathname = reqUrl.pathname || '/';

    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    // ===== Static Assets =====
    if (pathname.startsWith('/assets/')) {
        const assetName = pathname.replace('/assets/', '');
        const assetPath = path.join(__dirname, 'assets', assetName);
        if (fs.existsSync(assetPath)) {
            const ext = path.extname(assetName).toLowerCase();
            const mimeTypes: Record<string, string> = {
                '.css': 'text/css; charset=utf-8',
                '.js': 'application/javascript; charset=utf-8',
                '.json': 'application/json; charset=utf-8'
            };
            res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
            res.end(fs.readFileSync(assetPath));
        } else {
            res.writeHead(404); res.end('Asset not found');
        }
        return;
    }

    // ===== API: Search =====
    if (pathname === '/api/search' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { url, depth, limit } = JSON.parse(body);
                if (isRunning) {
                    console.log(`[Dashboard] Search running, adding to queue: ${url}`);
                    jobQueue.push({ url, depth, limit });
                    res.writeHead(202, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: 'Search queued', queueLength: jobQueue.length }));
                    return;
                }
                jobQueue.push({ url, depth, limit });
                processQueue();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Search started' }));
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: String(e) }));
                isRunning = false;
            }
        });
        return;
    }

    // ===== API: Stop =====
    if (pathname === '/api/stop' && req.method === 'POST') {
        if (currentProcess && isRunning) {
            try {
                currentProcess.kill('SIGTERM');
                setTimeout(() => {
                    if (isRunning) isRunning = false;
                }, 2000);
            } catch {
                /* ignored */
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No process running' }));
        }
        return;
    }

    // ===== API: Worker Poll =====
    if (pathname === '/api/worker/next' && req.method === 'GET') {
        const nextJob = jobQueue.shift();
        if (nextJob) {
            console.log(`[Dashboard] WORKER MAPPED: Job sent to worker -> ${nextJob.url}`);
            isRunning = true;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(nextJob));
        } else {
            res.writeHead(204); res.end();
        }
        return;
    }

    // ===== API: Worker Status =====
    if (pathname === '/api/worker/status' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { running } = JSON.parse(body);
                isRunning = !!running;
                res.writeHead(200); res.end();
            } catch (e) { res.writeHead(400); res.end(); }
        });
        return;
    }

    // ===== API: Tags =====
    if (pathname === '/api/tag' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { url, status, hash } = JSON.parse(body);
                updateTag(url, status, hash);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: String(e) }));
            }
        });
        return;
    }

    // ===== API: Reason =====
    if (pathname === '/api/reason' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { url, reason, hash } = JSON.parse(body);
                updateReason(url, reason, hash);
                res.writeHead(200); res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(500); res.end(JSON.stringify({ error: String(e) }));
            }
        });
        return;
    }

    // ===== API: Stats =====
    if (pathname === '/api/stats' && req.method === 'GET') {
        try {
            const env = reqUrl.searchParams.get('env') || 'stage';
            const stats = await getStats(env);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(stats));
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: String(e) }));
        }
        return;
    }

    // ===== Static Files (Output) =====
    if (pathname.startsWith('/output/')) {
        const decodedPath = decodeURIComponent(pathname);
        const filePath = path.join(process.cwd(), decodedPath);
        if (!filePath.startsWith(process.cwd())) { res.writeHead(403); res.end('Forbidden'); return; }
        if (fs.existsSync(filePath)) {
            const ext = path.extname(filePath).toLowerCase();
            const mime = { '.webp': 'image/webp', '.png': 'image/png', '.zip': 'application/zip', '.json': 'application/json' }[ext] || 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': mime });
            fs.createReadStream(filePath).pipe(res);
        } else { res.writeHead(404); res.end('Not Found'); }
        return;
    }

    // ===== UI: Index =====
    if (pathname === '/' || pathname === '/index.html') {
        const uiPath = path.join(__dirname, 'index.html');
        if (fs.existsSync(uiPath)) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            fs.createReadStream(uiPath).pipe(res);
        } else { res.writeHead(404); res.end('UI not found'); }
        return;
    }

    res.writeHead(404); res.end('Not Found');
});

// ===== Start Server =====
server.listen(PORT, () => {
    watcher = new FileSystemWatcher(OUTPUT_DIR);

    console.log(`[Dashboard] Mode: ${isExternalWorkerMode ? '🎨 EXTERNAL WORKER' : '🚀 INTERNAL RUNNER'}`);
    console.log(`[Dashboard] Live Monitoring running at http://localhost:${PORT}`);
    console.log(`[Dashboard] ⚡ Adaptive Watcher Active (Detecting ${process.platform})`);
});
