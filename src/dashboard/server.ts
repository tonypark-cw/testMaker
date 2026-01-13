import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import * as dotenv from 'dotenv';
import { filenameToRoute, filenameToSlug } from '../core/utils/pathUtils.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const OUTPUT_DIR = path.resolve('./output');
const SCREENSHOTS_DIR = path.join(OUTPUT_DIR, 'screenshots');
const TAGS_FILE = path.join(OUTPUT_DIR, 'qa-tags.json');
const SUPERVISOR_STATUS_FILE = path.join(OUTPUT_DIR, 'supervisor_status.json');

// Server State
let isRunning = false;
let currentProcess: any = null;

// Basic Auth Credentials
const AUTH_USER = process.env.DASHBOARD_USER;
const AUTH_PASS = process.env.DASHBOARD_PASS;

const server = http.createServer((req, res) => {
    // [SECURITY] Track Client IP
    trackClient(req);

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
    let pathname = reqUrl.pathname || '/';
    try { pathname = decodeURIComponent(pathname); } catch (e) { }

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
            if (isRunning) {
                res.writeHead(409, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Analysis already running' }));
                return;
            }

            try {
                const { url, depth } = JSON.parse(body);
                console.log(`[Dashboard] Starting analysis for ${url} (Depth: ${depth || 3})...`);

                isRunning = true;

                // Spawn the analysis process
                const args = ['run', 'analyze', '--', '--url', url, '--force'];
                if (depth) args.push('--depth', String(depth));

                currentProcess = spawn('npm', args, { stdio: 'inherit', shell: true });

                currentProcess.on('close', (code: number) => {
                    console.log(`[Dashboard] Analysis finished with code ${code}`);
                    isRunning = false;
                    currentProcess = null;
                });

                currentProcess.on('error', (err: Error) => {
                    console.error('[Dashboard] Failed to start process:', err);
                    isRunning = false;
                    currentProcess = null;
                });

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

    // API: Stop Supervisor (POST)
    if (pathname === '/api/stop-supervisor' && req.method === 'POST') {
        try {
            execSync('pkill -9 -f "tsx src/core/supervisor.ts"');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Supervisor stopped' }));
        } catch (e: any) {
            // pkill returns exit code 1 if no process found - this is OK
            if (e.status === 1) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Supervisor is not running' }));
            } else {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: String(e) }));
            }
        }
        return;
    }

    // API: Tags (POST)
    if (pathname === '/api/tag' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { url, status } = JSON.parse(body);
                updateTag(url, status);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: String(e) }));
            }
        });
        return;
    }

    // API: Stats
    if (pathname === '/api/stats') {
        try {
            const stats = getStats();
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
        const filePath = path.join(process.cwd(), pathname);
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

    // UI: Index or About
    if (pathname === '/' || pathname === '/index.html' || pathname === '/about.html') {
        const basename = pathname === '/' ? 'index.html' : pathname.substring(1);
        const uiPath = path.join(__dirname, basename);
        if (fs.existsSync(uiPath)) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            fs.createReadStream(uiPath).pipe(res);
        } else {
            res.writeHead(404); res.end('UI not found');
        }
        return;
    }

    // UI: Static Assets (Styles & Scripts)
    if (pathname.startsWith('/styles/') || pathname.startsWith('/scripts/')) {
        let safePath = '';
        if (pathname === '/scripts/utils/pathUtils.js') {
            safePath = path.join(__dirname, '../core/utils/pathUtils.js');
        } else {
            safePath = path.join(__dirname, pathname).replace(/^(\.\.[\/\\])+/, '');
        }

        if (fs.existsSync(safePath)) {
            const ext = path.extname(safePath).toLowerCase();
            const mime = {
                '.css': 'text/css',
                '.js': 'application/javascript',
                '.map': 'application/json'
            }[ext] || 'text/plain';

            res.writeHead(200, { 'Content-Type': mime });
            fs.createReadStream(safePath).pipe(res);
            return;
        }

        res.writeHead(404);
        res.end('Asset not found');
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

function updateTag(url: string, status: string) {
    let tags: Record<string, string> = {};
    if (fs.existsSync(TAGS_FILE)) {
        try { tags = JSON.parse(fs.readFileSync(TAGS_FILE, 'utf-8')); } catch { }
    }
    tags[url] = status;
    fs.writeFileSync(TAGS_FILE, JSON.stringify(tags, null, 2));
}

// Path utils removed and moved to src/core/utils/pathUtils.ts

function getStats() {
    let analyzedCount = 0;
    // Helper to track unique screenshots per date: Date -> Map<NormalizedPath, FileEntry>
    let dailyUnique: Record<string, Map<string, { url: string, mtime: number }>> = {};

    let latestTrace = '';
    let tags: Record<string, string> = {};

    // Load Tags
    if (fs.existsSync(TAGS_FILE)) {
        try { tags = JSON.parse(fs.readFileSync(TAGS_FILE, 'utf-8')); } catch { }
    }

    const uniquePages = new Set();

    // 1. Process Screenshots
    if (fs.existsSync(SCREENSHOTS_DIR)) {
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
                        const url = '/' + relativePath;

                        // [ACCURACY] Normalize page name for counting & deduplication
                        const route = filenameToRoute(item).toLowerCase();
                        uniquePages.add(route);

                        // [DATE GROUPING] Extract date from filesystem mtime
                        const mdate = new Date(stat.mtime);
                        const date = mdate.toISOString().split('T')[0]; // YYYY-MM-DD

                        if (!dailyUnique[date]) dailyUnique[date] = new Map();

                        // Deduplication Logic: Keep only the latest file for this normalized path
                        const existing = dailyUnique[date].get(route);
                        if (!existing || stat.mtimeMs > existing.mtime) {
                            dailyUnique[date].set(route, { url, mtime: stat.mtimeMs });
                        }
                    }
                });
            } catch (e) { }
        };
        traverse(SCREENSHOTS_DIR);
    }

    // Convert Map back to array for frontend
    let screenshotsByDate: Record<string, { url: string, mtime: number }[]> = {};
    Object.keys(dailyUnique).forEach(date => {
        screenshotsByDate[date] = Array.from(dailyUnique[date].values());
    });

    // 2. Process Crawler JSONs
    const jsonDir = path.join(OUTPUT_DIR, 'json');
    if (fs.existsSync(jsonDir)) {
        try {
            const domains = fs.readdirSync(jsonDir);
            domains.forEach(d => {
                const dPath = path.join(jsonDir, d);
                if (fs.statSync(dPath).isDirectory()) {
                    const files = fs.readdirSync(dPath).filter(f => f.endsWith('.json'));
                    files.forEach(f => uniquePages.add(`json-${d}-${f}`));
                }
            });
        } catch (e) { }
    }

    analyzedCount = uniquePages.size;

    // Convert to final format: Record<string, string[]>
    const finalScreenshotsByDate: Record<string, string[]> = {};
    const availableDates = Object.keys(screenshotsByDate).sort().reverse();

    availableDates.forEach(date => {
        // Sort by mtime descending (newest first)
        screenshotsByDate[date].sort((a, b) => b.mtime - a.mtime);

        // Keep latest per logical path
        const seen = new Set();
        const deduplicated = screenshotsByDate[date].filter(item => {
            const fileName = item.url.split('/').pop() || '';
            const norm = filenameToRoute(fileName);
            if (seen.has(norm)) return false;
            seen.add(norm);
            return true;
        }).map(item => item.url);

        finalScreenshotsByDate[date] = deduplicated;
    });

    // Find latest trace
    if (fs.existsSync(OUTPUT_DIR)) {
        const traces = fs.readdirSync(OUTPUT_DIR).filter(f => f.startsWith('trace-') && f.endsWith('.zip'));
        if (traces.length > 0) {
            traces.sort().reverse();
            latestTrace = '/output/' + traces[0];
        }
    }

    // Supervisor Status
    let supervisorStatus = { status: 'UNKNOWN', timestamp: '' };
    if (fs.existsSync(SUPERVISOR_STATUS_FILE)) {
        try { supervisorStatus = JSON.parse(fs.readFileSync(SUPERVISOR_STATUS_FILE, 'utf-8')); } catch { }
    }

    // [HEALTH CHECK] Ensure isRunning is accurate
    if (currentProcess && currentProcess.exitCode !== null) {
        console.log('[Dashboard] Found zombie process reference, resetting state.');
        isRunning = false;
        currentProcess = null;
    }

    // [METADATA INJECTION] Enrich screenshots with confidence scores
    // We change the structure of screenshots from string[] to object[] in the API response
    // But we need to maintain backward compatibility if possible, or update frontend.
    // Let's return objects: { url: string, confidence?: number }

    const enrichedScreenshotsByDate: Record<string, { url: string, confidence?: number }[]> = {};

    availableDates.forEach(date => {
        const urls = finalScreenshotsByDate[date];
        enrichedScreenshotsByDate[date] = urls.map(url => {
            const entry: any = { url };

            // Try to find matching JSON
            // Screenshot: /output/screenshots/domain/screenshot-name.png
            // JSON: /output/json/domain/domain-name.json
            // We need to infer the domain and name from the URL.
            // URL format: /output/screenshots/stage-ianai-co/screenshot-app_home.png

            try {
                const parts = url.split('/');
                const fileName = parts.pop() || '';
                const domain = parts[parts.length - 1]; // stage-ianai-co

                const slug = filenameToSlug(fileName);
                const jsonFileName = `${domain}-${slug}.json`;
                const jsonPath = path.join(OUTPUT_DIR, 'json', domain, jsonFileName);

                if (fs.existsSync(jsonPath)) {
                    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
                    if (data.goldenPath && typeof data.goldenPath.confidence === 'number') {
                        entry.confidence = data.goldenPath.confidence;
                    }
                }
            } catch (e) { }

            return entry;
        });
    });

    return {
        analyzedCount,
        screenshots: enrichedScreenshotsByDate[availableDates[0]] || [],
        screenshotsByDate: enrichedScreenshotsByDate,
        availableDates,
        latestTrace,
        tags,
        isRunning,
        supervisorStatus,
        activeClientCount: Object.keys(connectedClients).length
    };
}


// Client IP Tracking
const connectedClients: Record<string, number> = {};

function trackClient(req: http.IncomingMessage) {
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    if (!connectedClients[ip]) {
        console.log(`[Dashboard] New client connected: ${ip}`);
    }
    connectedClients[ip] = now;

    // Cleanup old clients (> 30s inactive)
    Object.keys(connectedClients).forEach(clientIp => {
        if (now - connectedClients[clientIp] > 30000) delete connectedClients[clientIp];
    });
}

server.listen(PORT, () => {
    console.log(`[Dashboard] Live Monitoring running at http://localhost:${PORT}`);
    console.log(`[Dashboard] 🔒 Protected. User: ${AUTH_USER} / Pass: *******`);
    console.log(`[Dashboard] Server updated at ${new Date().toLocaleTimeString()} - with Runner & Tagging`);
});
