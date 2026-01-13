import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const OUTPUT_DIR = path.resolve('./output');
const DATA_DIR = path.resolve('./data');
const SCREENSHOTS_DIR = path.join(OUTPUT_DIR, 'screenshots');
const TAGS_FILE = path.join(DATA_DIR, 'qa-tags.json');
const REASONS_FILE = path.join(DATA_DIR, 'qa-reasons.json');

// [FIX] Robust Mode Detection
const isExternalWorkerMode = process.env.EXTERNAL_WORKER?.trim().toLowerCase() === 'true';

// Server State
let isRunning = false;
let currentProcess: any = null;
let jobQueue: Array<{ url: string, depth?: number, limit?: number }> = [];

// Helper Functions
function loadTags() {
    if (fs.existsSync(TAGS_FILE)) {
        try { return JSON.parse(fs.readFileSync(TAGS_FILE, 'utf-8')); } catch { }
    }
    return {};
}

function loadReasons() {
    // const REASONS_FILE = path.join(OUTPUT_DIR, 'qa-reasons.json'); // Use global
    if (fs.existsSync(REASONS_FILE)) {
        try { return JSON.parse(fs.readFileSync(REASONS_FILE, 'utf-8')); } catch { }
    }
    return {};
}

const processQueue = () => {
    if (isRunning || jobQueue.length === 0) return;

    const nextJob = jobQueue[0]; // Peek
    if (!nextJob) return;

    // [FIX] If external worker is preferred, we don't spawn here.
    if (isExternalWorkerMode) {
        // We wait for the worker to pull it via /api/worker/next
        return;
    }

    jobQueue.shift(); // Remove from queue now that we are spawning
    try {
        if (process.env.EXTERNAL_WORKER !== 'true') {
            console.log(`[Dashboard] Starting queued job for ${nextJob.url}...`);
        }
        isRunning = true;

        const args = ['run', 'analyze', '--', '--url', nextJob.url, '--force'];
        if (nextJob.depth) args.push('--depth', String(nextJob.depth));
        if (nextJob.limit) args.push('--limit', String(nextJob.limit));

        currentProcess = spawn('npm', args, { stdio: 'inherit', shell: true });

        currentProcess.on('close', (code: number) => {
            console.log(`[Dashboard] Job finished with code ${code}`);
            isRunning = false;
            currentProcess = null;
            setTimeout(processQueue, 1000); // Check next job
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

// Hash Cache to avoid recalculating MD5 every few seconds
const hashCache = new Map<string, { mtime: number, hash: string }>();

function getFileHash(filePath: string): string {
    const stat = fs.statSync(filePath);
    const mtime = stat.mtimeMs;
    const cached = hashCache.get(filePath);

    if (cached && cached.mtime === mtime) {
        return cached.hash;
    }

    const content = fs.readFileSync(filePath);
    const hash = crypto.createHash('md5').update(content).digest('hex');
    hashCache.set(filePath, { mtime, hash });
    return hash;
}

// Basic Auth Credentials
const AUTH_USER = process.env.DASHBOARD_USER;
const AUTH_PASS = process.env.DASHBOARD_PASS;

const server = http.createServer(async (req, res) => {
    // [SECURITY] Basic Authentication
    const auth = req.headers['authorization'];
    if (!auth) {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="TestMaker Dashboard"' });
        res.end('Authentication required');
        return;
    }
    const [scheme, credentials] = auth.split(' ');
    if (scheme !== 'Basic' || !credentials) {
        res.writeHead(401);
        res.end('Invalid auth scheme');
        return;
    }
    const [user, pass] = Buffer.from(credentials, 'base64').toString().split(':');
    if (user !== AUTH_USER || pass !== AUTH_PASS) {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Valid credentials required"' });
        res.end('Invalid credentials');
        return;
    }

    // URL Parsing
    const baseURL = 'http://' + (req.headers.host || 'localhost');
    const reqUrl = new URL(req.url || '', baseURL);
    const pathname = reqUrl.pathname || '/';

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // API: Analyze (POST)
    if (pathname === '/api/analyze' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { url, depth, limit } = JSON.parse(body);

                if (isRunning) {
                    console.log(`[Dashboard] Analysis running, adding to queue: ${url}`);
                    jobQueue.push({ url, depth, limit });
                    res.writeHead(202, { 'Content-Type': 'application/json' }); // 202 Accepted
                    res.end(JSON.stringify({ success: true, message: 'Analysis queued', queueLength: jobQueue.length }));
                    return;
                }

                if (isExternalWorkerMode) {
                    console.log(`[Dashboard] Job queued for Worker: ${url}`);
                } else {
                    console.log(`[Dashboard] Starting Analysis: ${url} (Depth: ${depth || 3})...`);
                }

                // Add to queue and process immediately
                jobQueue.push({ url, depth, limit });
                processQueue();

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Analysis started' }));
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: String(e) }));
                isRunning = false;
            }
        });
        return;
    }

    // API: Stop (POST)
    if (pathname === '/api/stop' && req.method === 'POST') {
        if (currentProcess && isRunning) {
            try {
                currentProcess.kill('SIGTERM');
                setTimeout(() => { if (isRunning) isRunning = false; }, 2000);
            } catch (e) { }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No process running' }));
        }
        return;
    }

    // API: Worker Poll (GET)
    if (pathname === '/api/worker/next' && req.method === 'GET') {
        const nextJob = jobQueue.shift();
        if (nextJob) {
            console.log(`[Dashboard] WORKER MAPPED: Job sent to worker -> ${nextJob.url}`);
            isRunning = true;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(nextJob));
        } else {
            // console.log(`[Dashboard] Worker Poll (Queue Empty)`);
            res.writeHead(204);
            res.end();
        }
        return;
    }

    // API: Worker Status (POST)
    if (pathname === '/api/worker/status' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { running } = JSON.parse(body);
                isRunning = !!running;
                res.writeHead(200);
                res.end();
            } catch (e) { res.writeHead(400); res.end(); }
        });
        return;
    }

    // API: Tags (POST)
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

    // API: Reason (POST)
    if (pathname === '/api/reason' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { url, reason } = JSON.parse(body);
                const reasons = loadReasons();
                reasons[url] = reason;
                fs.writeFileSync(REASONS_FILE, JSON.stringify(reasons, null, 2));
                res.writeHead(200);
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: String(e) }));
            }
        });
        return;
    }

    // API: Stats
    if (pathname === '/api/stats' && req.method === 'GET') {
        try {
            const stats = await getStats();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(stats));
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: String(e) }));
        }
        return;
    }

    // Static Files
    if (pathname.startsWith('/output/')) {
        const decodedPath = decodeURIComponent(pathname);
        const filePath = path.join(process.cwd(), decodedPath);
        if (!filePath.startsWith(process.cwd())) {
            res.writeHead(403); res.end('Forbidden'); return;
        }

        if (fs.existsSync(filePath)) {
            const ext = path.extname(filePath).toLowerCase();
            const mime = { '.webp': 'image/webp', '.png': 'image/png', '.zip': 'application/zip', '.json': 'application/json' }[ext] || 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': mime });
            fs.createReadStream(filePath).pipe(res);
        } else {
            res.writeHead(404); res.end('Not Found');
        }
        return;
    }

    // UI: Index
    if (pathname === '/' || pathname === '/index.html') {
        const uiPath = path.join(__dirname, 'index.html');
        if (fs.existsSync(uiPath)) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            fs.createReadStream(uiPath).pipe(res);
        } else {
            res.writeHead(404); res.end('UI not found');
        }
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

function updateTag(url: string, status: string, hash?: string) {
    let tags: Record<string, string> = {};
    if (fs.existsSync(TAGS_FILE)) {
        try { tags = JSON.parse(fs.readFileSync(TAGS_FILE, 'utf-8')); } catch { }
    }
    // [FIX] Tag by URL + Hash (Visual Identity)
    const key = hash ? `${url}#${hash}` : url;
    tags[key] = status;
    fs.writeFileSync(TAGS_FILE, JSON.stringify(tags, null, 2));
}

// Cache for web URLs to avoid repeated disk reads
const webUrlCache: Record<string, string> = {};

function getWebUrlForScreenshot(screenshotFullPath: string): any {
    if (webUrlCache[screenshotFullPath]) return webUrlCache[screenshotFullPath];

    const filename = path.basename(screenshotFullPath, path.extname(screenshotFullPath));
    const domainDir = path.basename(path.dirname(screenshotFullPath));
    const domainWithDots = domainDir.replace(/-/g, '.');

    // [FIX] Simplified JSON lookup: Look for exactly filename.json in domain dir
    const possiblePaths = [
        path.join(SCREENSHOTS_DIR, 'json', domainWithDots, `${filename}.json`),
        path.join(SCREENSHOTS_DIR, 'json', domainWithDots, `${domainWithDots}-${filename}.json`)
    ];

    for (const jsonPath of possiblePaths) {
        if (fs.existsSync(jsonPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
                if (data.url) {
                    return data; // Return full metadata object
                }
            } catch (e) { }
        }
    }

    return null;
}

// [OPTIMIZATION] Enhanced Cache for getStats to reduce disk I/O
// Separate caches for different data types with appropriate TTLs
let screenshotCache: any[] | null = null;
let lastDirMtime: number = 0;
let lastCacheTime: number = 0;
let lastAnalyzedCount: number = 0;
let lastLatestTrace: string = '';
let cachedLatestScanTime: number = 0;

const CACHE_TTL = 5000; // 5 seconds - increased from 2s for better performance

// Helper to get the maximum mtime across directory and subdirectories (shallow check)
function getEffectiveDirMtime(dir: string): number {
    let maxMtime = 0;
    try {
        if (!fs.existsSync(dir)) return 0;

        const dirStat = fs.statSync(dir);
        maxMtime = dirStat.mtimeMs;

        // Check immediate subdirectories only (not recursive for performance)
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            try {
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory() && stat.mtimeMs > maxMtime) {
                    maxMtime = stat.mtimeMs;
                }
            } catch (e) { }
        }
    } catch (e) { }
    return maxMtime;
}

async function getStats(forceRefresh = false) {
    const now = Date.now();
    let shouldRefresh = forceRefresh;

    // Check if cache is still valid by TTL
    if (!screenshotCache || (now - lastCacheTime) > CACHE_TTL) {
        // TTL expired, check if directory actually changed
        try {
            const currentDirMtime = getEffectiveDirMtime(SCREENSHOTS_DIR);
            if (currentDirMtime !== lastDirMtime) {
                shouldRefresh = true;
                lastDirMtime = currentDirMtime;
            }
        } catch (e) {
            shouldRefresh = true;
        }
    }

    // If cache is valid and no refresh needed, return cached data quickly
    if (!shouldRefresh && screenshotCache) {
        // Only refresh dynamic data (isRunning, tags, reasons, queueLength)
        let tags: Record<string, string> = {};
        if (fs.existsSync(TAGS_FILE)) {
            try { tags = JSON.parse(fs.readFileSync(TAGS_FILE, 'utf-8')); } catch { }
        }

        // Check running status (lightweight check)
        let isActuallyRunning = isRunning || jobQueue.length > 0;
        if (!isActuallyRunning) {
            try {
                const { exec } = await import('child_process');
                const util = await import('util');
                const execAsync = util.promisify(exec);
                const { stdout } = await execAsync('ps aux | grep "src/core/cli.ts" | grep -v grep', { encoding: 'utf-8', timeout: 500 });
                if (stdout && stdout.trim()) {
                    isActuallyRunning = true;
                }
            } catch (e) { }
        }

        return {
            analyzedCount: lastAnalyzedCount,
            screenshots: screenshotCache,
            latestTrace: lastLatestTrace,
            tags,
            reasons: loadReasons(),
            isRunning: isActuallyRunning,
            queueLength: jobQueue.length,
            latestScanTime: cachedLatestScanTime,
            cached: true
        };
    }

    // --- FULL SCAN (only when cache is invalid or forced) ---
    let analyzedCount = 0;
    let screenshots: any[] = [];
    let latestTrace = '';
    let tags: Record<string, string> = {};

    // Load Tags
    if (fs.existsSync(TAGS_FILE)) {
        try { tags = JSON.parse(fs.readFileSync(TAGS_FILE, 'utf-8')); } catch { }
    }

    // Count JSON reports
    const jsonDir = path.join(SCREENSHOTS_DIR, 'json');
    if (fs.existsSync(jsonDir)) {
        const domains = fs.readdirSync(jsonDir);
        domains.forEach(d => {
            const dPath = path.join(jsonDir, d);
            if (fs.statSync(dPath).isDirectory()) {
                const files = fs.readdirSync(dPath).filter(f => f.endsWith('.json'));
                analyzedCount += files.length;
            }
        });
    }

    // Get recent screenshots
    let latestScanTime = 0;
    if (fs.existsSync(SCREENSHOTS_DIR)) {
        const allFiles: { path: string, time: number, hash: string }[] = [];
        const traverse = (dir: string) => {
            try {
                const items = fs.readdirSync(dir);
                items.forEach(item => {
                    const fullPath = path.join(dir, item);
                    const stat = fs.statSync(fullPath);
                    if (stat.isDirectory()) {
                        traverse(fullPath);
                    } else if (item.endsWith('.webp') || item.endsWith('.png')) {
                        const relativePath = path.relative(process.cwd(), fullPath);
                        if (stat.mtimeMs > latestScanTime) latestScanTime = stat.mtimeMs;
                        allFiles.push({
                            path: '/' + relativePath,
                            time: stat.mtimeMs,
                            hash: getFileHash(fullPath)
                        });
                    }
                });
            } catch (e) { }
        };
        traverse(SCREENSHOTS_DIR);

        // Map to objects instead of strings
        screenshots = allFiles
            .sort((a, b) => b.time - a.time)
            .map(f => {
                const metadata = getWebUrlForScreenshot(path.join(process.cwd(), f.path));
                return {
                    url: f.path,
                    hash: f.hash,
                    time: f.time,
                    webUrl: metadata ? metadata.url : '',
                    metadata: metadata,
                    // [NEW] Golden Path Info (Flattened for UI)
                    confidence: metadata?.goldenPath?.confidence ?? null,
                    isStable: metadata?.goldenPath?.isStable ?? null,
                    goldenPathReasons: metadata?.goldenPath?.reasons ?? []
                };
            });
    }

    // Find latest trace
    const traces = fs.readdirSync(OUTPUT_DIR).filter(f => f.startsWith('trace-') && f.endsWith('.zip'));
    if (traces.length > 0) {
        traces.sort().reverse();
        latestTrace = '/output/' + traces[0];
    }

    // Check if any analyze process is running (even from terminal)
    let isActuallyRunning = isRunning || jobQueue.length > 0;

    if (!isActuallyRunning) {
        try {
            const { exec } = await import('child_process');
            const util = await import('util');
            const execAsync = util.promisify(exec);
            const { stdout } = await execAsync('ps aux | grep "src/core/cli.ts" | grep -v grep', { encoding: 'utf-8', timeout: 500 });
            if (stdout && stdout.trim()) {
                isActuallyRunning = true;
            }
        } catch (e) { }
    }

    // Update all caches
    screenshotCache = screenshots;
    lastCacheTime = now;
    lastAnalyzedCount = analyzedCount;
    lastLatestTrace = latestTrace;
    cachedLatestScanTime = Math.max(latestScanTime, lastDirMtime);

    return {
        analyzedCount,
        screenshots,
        latestTrace,
        tags,
        reasons: loadReasons(),
        isRunning: isActuallyRunning,
        queueLength: jobQueue.length,
        latestScanTime: cachedLatestScanTime
    };
}

server.listen(PORT, () => {
    console.log(`[Dashboard] Mode: ${isExternalWorkerMode ? '🎨 EXTERNAL WORKER (Job Queue only)' : '🚀 INTERNAL RUNNER (Classic)'}`);
    console.log(`[Dashboard] Live Monitoring running at http://localhost:${PORT}`);
    console.log(`[Dashboard] 🔒 Protected. User: ${AUTH_USER} / Pass: *******`);
    console.log(`[Dashboard] Server updated at ${new Date().toLocaleTimeString()} - with Runner & Tagging`);
});
