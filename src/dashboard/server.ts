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

// --- OPTIMIZATION START: Hybrid File Watcher ---
// Automatically selects Native Watch (Win/Mac) or Polling (Linux/Other)
class FileSystemWatcher {
    private cache = new Map<string, any>();
    private watchedDir: string;
    private nativeWatcher: fs.FSWatcher | null = null;
    private pollingInterval: NodeJS.Timeout | null = null;
    private latestChangeTime: number = 0; // [FIX] Track actual change time

    constructor(dir: string) {
        this.watchedDir = dir;
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        console.log(`[Watcher] Initializing file system watcher for: ${dir}`);
        this.initialScan();
        this.startStrategy();
    }

    private initialScan() {
        console.time('[Watcher] Initial Scan');
        this.scanAll(); // Reuse scan logic
        console.timeEnd('[Watcher] Initial Scan');
        console.log(`[Watcher] Indexed ${this.cache.size} files.`);
    }

    private scanAll() {
        const traverse = (currentDir: string) => {
            try {
                const items = fs.readdirSync(currentDir);
                items.forEach(item => {
                    const fullPath = path.join(currentDir, item);
                    try {
                        const stat = fs.statSync(fullPath);
                        if (stat.isDirectory()) {
                            traverse(fullPath);
                        } else if (item.endsWith('.webp') || item.endsWith('.png')) {
                            this.updateCache(fullPath, stat);
                        }
                    } catch { }
                });
            } catch { }
        };
        traverse(this.watchedDir);
    }

    private startStrategy() {
        const platform = process.platform;
        // Recursive watch is supported on Windows (win32) and macOS (darwin)
        const isNativeRecursiveSupported = platform === 'win32' || platform === 'darwin';

        if (isNativeRecursiveSupported) {
            this.tryNativeWatch();
        } else {
            console.log(`[Watcher] Platform '${platform}' may not support recursive watch. Defaulting to Polling.`);
            this.startPolling();
        }
    }

    private tryNativeWatch() {
        try {
            console.log('[Watcher] Attempting to start Native Recursive Watcher (High Performance)...');
            this.nativeWatcher = fs.watch(this.watchedDir, { recursive: true }, (eventType, filename) => {
                if (!filename) return;
                // Only care about relevant files
                if (filename.endsWith('.webp') || filename.endsWith('.png') || filename.endsWith('.json')) {
                    const fullPath = path.join(this.watchedDir, filename);
                    this.handleChange(fullPath);
                }
            });

            this.nativeWatcher.on('error', (e) => {
                console.error('[Watcher] Native watcher error:', e);
                console.log('[Watcher] Falling back to Polling strategy...');
                if (this.nativeWatcher) this.nativeWatcher.close();
                this.startPolling();
            });

            console.log('[Watcher] 🚀 Native Watcher Active (Win/Mac Mode)');
        } catch (e) {
            console.error('[Watcher] Failed to start native watcher:', e);
            this.startPolling();
        }
    }

    private startPolling() {
        console.log('[Watcher] 🐢 Polling Strategy Active (Compatibility Mode - 2s interval)');
        if (this.pollingInterval) clearInterval(this.pollingInterval);

        this.pollingInterval = setInterval(() => {
            // Re-scan everything (O(N)) - Legacy behavior but safe
            this.scanAll();
            // Note: In polling, we don't efficiently detect deletes unless we diff the keys.
            // For now, simpler implementation mainly adds new files.
            // To support deletes in polling, we'd need to mark and sweep. 
            // Given performace constraints, we just re-scan/update.
        }, 2000);
    }

    private handleChange(fullPath: string) {
        try {
            if (fs.existsSync(fullPath)) {
                if (!fullPath.endsWith('.json')) {
                    const stat = fs.statSync(fullPath);
                    this.updateCache(fullPath, stat);
                }
            } else {
                this.removeFromCache(fullPath);
            }
        } catch {
            this.removeFromCache(fullPath);
        }
    }

    private updateCache(fullPath: string, stat: fs.Stats) {
        const relativePath = '/' + path.relative(process.cwd(), fullPath).replace(/\\/g, '/');
        const hash = getFileHash(fullPath, stat.mtimeMs);
        const metadata = getWebUrlForScreenshot(fullPath);

        // [FIX] Update latest change time if newer
        if (stat.mtimeMs > this.latestChangeTime) {
            this.latestChangeTime = stat.mtimeMs;
        }

        const data = {
            url: relativePath,
            hash: hash,
            time: stat.mtimeMs,
            webUrl: metadata ? metadata.url : '',
            metadata: metadata,
            confidence: metadata?.goldenPath?.confidence ?? null,
            isStable: metadata?.goldenPath?.isStable ?? null,
            goldenPathReasons: metadata?.goldenPath?.reasons ?? []
        };
        this.cache.set(relativePath, data);
    }

    private removeFromCache(fullPath: string) {
        const relativePath = '/' + path.relative(process.cwd(), fullPath).replace(/\\/g, '/');
        this.cache.delete(relativePath);
    }

    public getScreenshots(environment: string): any[] {
        const filterPrefix = `/output/${environment}`;
        const results: any[] = [];

        for (const [key, value] of this.cache.entries()) {
            if (key.startsWith(filterPrefix)) {
                results.push(value);
            }
        }
        return results;
    }

    public getLatestScanTime(): number {
        return this.latestChangeTime;
    }
}
// --- OPTIMIZATION END ---

// Helper Functions
function loadTags() {
    if (fs.existsSync(TAGS_FILE)) {
        try { return JSON.parse(fs.readFileSync(TAGS_FILE, 'utf-8')); } catch { }
    }
    return {};
}

function loadReasons() {
    if (fs.existsSync(REASONS_FILE)) {
        try { return JSON.parse(fs.readFileSync(REASONS_FILE, 'utf-8')); } catch { }
    }
    return {};
}

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

        const args = ['run', 'search', '--', '--url', nextJob.url, '--force'];
        if (nextJob.depth) args.push('--depth', String(nextJob.depth));
        if (nextJob.limit) args.push('--limit', String(nextJob.limit));

        currentProcess = spawn('npm', args, { stdio: 'inherit', shell: true });

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

// Hash Cache
const hashCache = new Map<string, { mtime: number, hash: string }>();
function getFileHash(filePath: string, mtime: number): string {
    const cached = hashCache.get(filePath);
    if (cached && cached.mtime === mtime) return cached.hash;

    try {
        const content = fs.readFileSync(filePath);
        const hash = crypto.createHash('md5').update(content).digest('hex');
        hashCache.set(filePath, { mtime, hash });
        return hash;
    } catch {
        return '';
    }
}

// Global Watcher Instance
let watcher: FileSystemWatcher;

// Basic Auth
const AUTH_USER = process.env.DASHBOARD_USER;
const AUTH_PASS = process.env.DASHBOARD_PASS;

const server = http.createServer(async (req, res) => {
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

    const baseURL = 'http://' + (req.headers.host || 'localhost');
    const reqUrl = new URL(req.url || '', baseURL);
    const pathname = reqUrl.pathname || '/';

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    // Static Assets (CSS, JS)
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

    // API: Search
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

    // API: Stop
    if (pathname === '/api/stop' && req.method === 'POST') {
        if (currentProcess && isRunning) {
            try { currentProcess.kill('SIGTERM'); setTimeout(() => { if (isRunning) isRunning = false; }, 2000); } catch (e) { }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No process running' }));
        }
        return;
    }

    // API: Worker Poll
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

    // API: Worker Status
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

    // API: Tags
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

    // API: Reason
    if (pathname === '/api/reason' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { url, reason } = JSON.parse(body);
                const reasons = loadReasons();
                reasons[url] = reason;
                fs.writeFileSync(REASONS_FILE, JSON.stringify(reasons, null, 2));
                res.writeHead(200); res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(500); res.end(JSON.stringify({ error: String(e) }));
            }
        });
        return;
    }

    // API: Stats
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

    // Static Files
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

    // UI: Index
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

function updateTag(url: string, status: string, hash?: string) {
    let tags: Record<string, string> = {};
    if (fs.existsSync(TAGS_FILE)) { try { tags = JSON.parse(fs.readFileSync(TAGS_FILE, 'utf-8')); } catch { } }
    const key = hash ? `${url}#${hash}` : url;
    tags[key] = status;
    fs.writeFileSync(TAGS_FILE, JSON.stringify(tags, null, 2));
}

// Minimal Cache for Web URL metadata lookup
const webUrlCache: Record<string, any> = {};
function getWebUrlForScreenshot(screenshotFullPath: string): any {
    if (webUrlCache[screenshotFullPath]) return webUrlCache[screenshotFullPath];

    const filename = path.basename(screenshotFullPath, path.extname(screenshotFullPath));
    const domainDir = path.basename(path.dirname(screenshotFullPath));
    const domainWithDots = domainDir.replace(/-/g, '.');

    const possiblePaths = [
        path.join(SCREENSHOTS_DIR, 'json', domainWithDots, `${filename}.json`),
        path.join(SCREENSHOTS_DIR, 'json', domainWithDots, `${domainWithDots}-${filename}.json`)
    ];

    for (const jsonPath of possiblePaths) {
        if (fs.existsSync(jsonPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
                if (data.url) {
                    webUrlCache[screenshotFullPath] = data; // Cache hit
                    return data;
                }
            } catch (e) { }
        }
    }
    return null;
}

// Optimized GetStats using Watcher
async function getStats(environment = 'stage') {
    // 1. Get Screenshots from Watcher (O(1))
    const screenshots = watcher.getScreenshots(environment);

    // Sort by time descending
    screenshots.sort((a, b) => b.time - a.time);

    // 2. Misc Data
    let tags: Record<string, string> = {};
    if (fs.existsSync(TAGS_FILE)) { try { tags = JSON.parse(fs.readFileSync(TAGS_FILE, 'utf-8')); } catch { } }

    let latestTrace = '';
    const envOutputDir = path.join(OUTPUT_DIR, environment);
    if (fs.existsSync(envOutputDir)) {
        const traces = fs.readdirSync(envOutputDir).filter(f => f.startsWith('trace-') && f.endsWith('.zip'));
        if (traces.length > 0) {
            traces.sort().reverse();
            latestTrace = '/output/' + environment + '/' + traces[0];
        }
    }

    // Check running status
    let isActuallyRunning = isRunning || jobQueue.length > 0;
    if (!isActuallyRunning) {
        try {
            const { exec } = await import('child_process');
            const util = await import('util');
            const execAsync = util.promisify(exec);
            const { stdout } = await execAsync('ps aux | grep "src/core/cli.ts" | grep -v grep', { encoding: 'utf-8', timeout: 500 });
            if (stdout && stdout.trim()) isActuallyRunning = true;
        } catch (e) { }
    }

    return {
        searchedCount: screenshots.length,
        screenshots,
        latestTrace,
        tags,
        reasons: loadReasons(),
        isRunning: isActuallyRunning,
        queueLength: jobQueue.length,
        latestScanTime: watcher.getLatestScanTime()
    };
}

server.listen(PORT, () => {
    // Start Watcher
    watcher = new FileSystemWatcher(OUTPUT_DIR);

    console.log(`[Dashboard] Mode: ${isExternalWorkerMode ? '🎨 EXTERNAL WORKER' : '🚀 INTERNAL RUNNER'}`);
    console.log(`[Dashboard] Live Monitoring running at http://localhost:${PORT}`);
    console.log(`[Dashboard] ⚡ Adaptive Watcher Active (Detecting ${process.platform})`);
});
