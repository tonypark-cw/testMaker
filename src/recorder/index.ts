import { chromium, Page, BrowserContext, Request } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { AuthManager } from '../shared/auth/AuthManager.js';

export interface RecordedSession {
    url: string;
    timestamp: string;
    events: RecordedEvent[];
}

export interface RecordedEvent {
    type: string;
    selector: string;
    value?: string;
    timestamp: number;
    location: string;
    network: string[]; // List of API URLs triggered by this action
}

export class Recorder {
    private context: BrowserContext | null = null;
    private currentSession: RecordedSession | null = null;
    private actionQueue: RecordedEvent[] = [];
    private lastAction: string | null = null;
    private outputDir: string;
    private transactionsDir: string;
    private labelsDir: string;

    constructor(outputDir: string = './output/dev') {
        this.outputDir = outputDir;
        this.transactionsDir = path.join(this.outputDir, 'transactions');
        this.labelsDir = path.join(this.outputDir, 'print_label');

        if (!fs.existsSync(this.outputDir)) fs.mkdirSync(this.outputDir, { recursive: true });
        if (!fs.existsSync(this.transactionsDir)) fs.mkdirSync(this.transactionsDir, { recursive: true });
        if (!fs.existsSync(this.labelsDir)) fs.mkdirSync(this.labelsDir, { recursive: true });
    }

    async start(targetUrl: string) {
        console.log(`[Recorder] Initializing session for: ${targetUrl}`);

        const browser = await chromium.launch({ headless: false });
        this.context = await browser.newContext({
            viewport: { width: 1280, height: 720 }
        });

        const page = await this.context.newPage();

        console.log('[Recorder] ⏳ Waiting for manual login or automatic redirect...');

        // 2. Initialize Session Data
        this.currentSession = {
            url: targetUrl,
            timestamp: new Date().toISOString(),
            events: []
        };

        // 3. Expose Recording Function to Browser
        await page.exposeFunction('antigravity_recordAction', (data: any) => {
            console.log(`[Recorder] 🖱️ Action captured: ${data.type} on ${data.selector}`);
            this.lastAction = `${data.type}: ${data.innerText || data.selector}`;

            const event: RecordedEvent = {
                ...data,
                network: [] // Will be associated later if needed, but we capture transactions globally
            };

            this.actionQueue.push(event);
        });

        // 4. Inject Event Tracker Script
        const trackerPath = path.join(process.cwd(), 'src/recorder/tracker/EventTracker.ts');
        const trackerScriptContent = fs.readFileSync(trackerPath, 'utf-8');

        // Wrap in a script that handles type stripping and execution
        const wrappedScript = `
            try {
                // Improved TS stripping for runtime injection
                const rawScript = ${JSON.stringify(trackerScriptContent)};
                const jsCode = rawScript
                    .replace(/export\\s+/g, '')
                    .replace(/import\\s+.*?;/g, '')
                    .replace(/:\\s*[a-zA-Z<>[\\]|]+\\s*([={,)]|$)/g, '$1')
                    .replace(/as\\s+[a-zA-Z<>[\\]]+/g, '')
                    .replace(/<[A-Z][A-Za-z]+>/g, '');
                eval(jsCode);
            } catch (e) {
                console.error('[Antigravity] Failed to inject EventTracker:', e);
            }
        `;

        await page.addInitScript({ content: wrappedScript });

        // 5. Intercept Network Requests for Schema Extraction
        page.on('response', async (response) => {
            const url = response.url();
            const status = response.status();

            if (status === 200 && (url.includes('ianai-dev.com') || url.includes('ianai.co'))) {
                // Strict UUID matching
                const match = url.match(/\/v2\/(.+)\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(\?.*)?$/i);

                if (match) {
                    const module = match[1];
                    const uuid = match[2];

                    try {
                        const contentType = response.headers()['content-type'] || '';
                        if (contentType.includes('application/json')) {
                            const data = await response.json();

                            // Save Transaction Result
                            const modDir = path.join(this.transactionsDir, module);
                            if (!fs.existsSync(modDir)) fs.mkdirSync(modDir, { recursive: true });

                            const filePath = path.join(modDir, `${uuid}_res.json`);
                            if (!fs.existsSync(filePath)) {
                                // Gracefully handle array vs object for metadata enrichment
                                const enrichedData = Array.isArray(data)
                                    ? { items: data, triggerAction: this.lastAction || 'manual_navigation' }
                                    : { ...data, triggerAction: this.lastAction || 'manual_navigation' };

                                fs.writeFileSync(filePath, JSON.stringify(enrichedData, null, 2));
                                console.log(`[Recorder] 🛰️ Captured transaction: ${module}/${uuid} (Trigger: ${this.lastAction || 'None'})`);

                                // Update Label Dictionary
                                this.updatePrintLabelDictionary(module, enrichedData);
                            }
                        }
                    } catch {
                        /* ignored */
                    }
                }
            }
        });

        // 6. Navigate to Target
        await page.goto(targetUrl);
        console.log('[Recorder] RECORDER READY. Please perform your manual test.');
        console.log('[Recorder] Close the browser window to finish recording.');

        // Keep running until browser is closed
        return new Promise<void>((resolve) => {
            page.on('close', async () => {
                await this.saveSession();
                await browser.close();
                resolve();
            });
        });
    }

    private async saveSession() {
        if (!this.currentSession) return;

        this.currentSession.events = this.actionQueue;

        const sessionDir = path.join(this.outputDir, 'sessions');
        if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

        const filename = `session-${new Date().getTime()}.json`;
        const filePath = path.join(sessionDir, filename);

        fs.writeFileSync(filePath, JSON.stringify(this.currentSession, null, 2));
        console.log(`[Recorder] ✅ Manual session saved to: ${filePath}`);
        console.log(`[Recorder] Captured ${this.actionQueue.length} actions.`);
    }

    private updatePrintLabelDictionary(module: string, data: any) {
        const labelFile = path.join(this.labelsDir, `${module}.json`);
        let existingKeys: string[] = [];

        if (fs.existsSync(labelFile)) {
            try {
                existingKeys = JSON.parse(fs.readFileSync(labelFile, 'utf-8'));
            } catch { /* ignore */ }
        }

        const newKeys = this.extractAllKeys(data);
        const combinedKeys = Array.from(new Set([...existingKeys, ...newKeys])).sort();

        fs.writeFileSync(labelFile, JSON.stringify(combinedKeys, null, 2));
    }

    private extractAllKeys(obj: any, prefix = ''): string[] {
        let keys: string[] = [];
        if (!obj || typeof obj !== 'object') return keys;

        if (Array.isArray(obj)) {
            if (obj.length > 0 && typeof obj[0] === 'object') {
                keys = keys.concat(this.extractAllKeys(obj[0], prefix));
            }
            return keys;
        }

        for (const key of Object.keys(obj)) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            keys.push(fullKey);

            if (obj[key] && typeof obj[key] === 'object') {
                keys = keys.concat(this.extractAllKeys(obj[key], fullKey));
            }
        }
        return keys;
    }
}
