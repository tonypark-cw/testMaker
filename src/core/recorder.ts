import { chromium, Page, BrowserContext, Request } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { AuthManager } from './lib/AuthManager.js';

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
    private pendingNetwork: string[] = [];
    private outputDir: string;

    constructor(outputDir: string = 'recordings') {
        this.outputDir = outputDir;
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    async start(targetUrl: string) {
        console.log(`[Recorder] Initializing session for: ${targetUrl}`);

        const browser = await chromium.launch({ headless: false });
        this.context = await browser.newContext({
            viewport: { width: 1280, height: 720 }
        });

        const page = await this.context.newPage();

        // 1. Authenticate if needed
        const auth = new AuthManager(page);
        const loginSuccess = await auth.login();
        if (!loginSuccess) {
            console.error('[Recorder] Authentication failed. Exiting.');
            await browser.close();
            return;
        }

        // 2. Initialize Session Data
        this.currentSession = {
            url: targetUrl,
            timestamp: new Date().toISOString(),
            events: []
        };

        // 3. Expose Recording Function to Browser
        await page.exposeFunction('antigravity_recordAction', (data: any) => {
            console.log('[Recorder] Action captured:', data.type, data.selector);

            const event: RecordedEvent = {
                ...data,
                network: [...this.pendingNetwork]
            };

            this.actionQueue.push(event);
            this.pendingNetwork = []; // Reset for next action
        });

        // 4. Inject Event Tracker Script
        const trackerPath = path.join(process.cwd(), 'src/core/lib/recorder/EventTracker.ts');
        const trackerScriptContent = fs.readFileSync(trackerPath, 'utf-8');

        // Wrap in a script that handles type stripping and execution
        const wrappedScript = `
            try {
                // Crude TS stripping for runtime injection
                const rawScript = ${JSON.stringify(trackerScriptContent)};
                const jsCode = rawScript
                    .replace(/export\\s+/g, '')
                    .replace(/:\\s+[A-Z][A-Za-z\\[\\]]+/g, '') // Remove simple types
                    .replace(/as\\s+[A-Za-z]+/g, ''); // Remove 'as any' etc
                eval(jsCode);
            } catch (e) {
                console.error('[Antigravity] Failed to inject EventTracker:', e);
            }
        `;

        await page.addInitScript({ content: wrappedScript });

        // 5. Intercept Network Requests
        page.on('request', (req: Request) => {
            const url = req.url();
            // Filter for relevant API calls (ianai specific)
            if (url.includes('/api/v2/') || url.includes('/v1/')) {
                this.pendingNetwork.push(url);
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

        const urlObj = new URL(this.currentSession.url);
        const domain = urlObj.hostname.replace(/\./g, '-');
        const pageName = urlObj.pathname.replace(/\//g, '-').replace(/^-|-$/g, '') || 'index';

        const sessionDir = path.join(this.outputDir, domain, pageName);
        if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

        const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        const filePath = path.join(sessionDir, filename);

        fs.writeFileSync(filePath, JSON.stringify(this.currentSession, null, 2));
        console.log(`[Recorder] ✅ Session saved to: ${filePath}`);
        console.log(`[Recorder] Captured ${this.actionQueue.length} actions.`);
    }
}
