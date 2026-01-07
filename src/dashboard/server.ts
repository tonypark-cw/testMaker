import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import * as dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const OUTPUT_DIR = path.resolve('./output');
const SCREENSHOTS_DIR = path.join(OUTPUT_DIR, 'screenshots');
const TAGS_FILE = path.join(OUTPUT_DIR, 'qa-tags.json');

// Server State
let isRunning = false;
let currentProcess: any = null;

// Basic Auth Credentials
const AUTH_USER = process.env.DASHBOARD_USER;
const AUTH_PASS = process.env.DASHBOARD_PASS;

const server = http.createServer((req, res) => {
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

function updateTag(url: string, status: string) {
    let tags: Record<string, string> = {};
    if (fs.existsSync(TAGS_FILE)) {
        try { tags = JSON.parse(fs.readFileSync(TAGS_FILE, 'utf-8')); } catch { }
    }
    tags[url] = status;
    fs.writeFileSync(TAGS_FILE, JSON.stringify(tags, null, 2));
}

function getStats() {
    let analyzedCount = 0;
    let screenshots: string[] = [];
    let latestTrace = '';
    let tags: Record<string, string> = {};

    // Load Tags
    if (fs.existsSync(TAGS_FILE)) {
        try { tags = JSON.parse(fs.readFileSync(TAGS_FILE, 'utf-8')); } catch { }
    }

    // Count JSON reports
    const jsonDir = path.join(OUTPUT_DIR, 'json');
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
    if (fs.existsSync(SCREENSHOTS_DIR)) {
        const allFiles: { path: string, time: number }[] = [];
        const traverse = (dir: string) => {
            const items = fs.readdirSync(dir);
            items.forEach(item => {
                const fullPath = path.join(dir, item);
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    traverse(fullPath);
                } else if (item.endsWith('.webp') || item.endsWith('.png')) {
                    const relativePath = path.relative(process.cwd(), fullPath);
                    allFiles.push({
                        path: '/' + relativePath,
                        time: stat.mtimeMs
                    });
                }
            });
        };
        traverse(SCREENSHOTS_DIR);

        screenshots = allFiles
            .sort((a, b) => b.time - a.time)
            .map(f => f.path);
    }

    // Find latest trace
    const traces = fs.readdirSync(OUTPUT_DIR).filter(f => f.startsWith('trace-') && f.endsWith('.zip'));
    if (traces.length > 0) {
        traces.sort().reverse();
        latestTrace = '/output/' + traces[0];
    }
    return { analyzedCount, screenshots, latestTrace, tags, isRunning };
}

server.listen(PORT, () => {
    console.log(`[Dashboard] Live Monitoring running at http://localhost:${PORT}`);
    console.log(`[Dashboard] 🔒 Protected. User: ${AUTH_USER} / Pass: *******`);
    console.log(`[Dashboard] Server updated at ${new Date().toLocaleTimeString()} - with Runner & Tagging`);
});
