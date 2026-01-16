import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { Scraper } from './scraper.js';
import { TransformerService as Transformer } from './services/TransformerService.js';
import { GeneratorService as Generator } from './services/GeneratorService.js';
import { SearchResult } from '../../types/index.js';
import { ScrapeJob, ScraperConfig } from './types.js';
import { RecoveryManager } from './RecoveryManager.js';
import { NetworkManager } from './NetworkManager.js';
import { SessionManager } from './SessionManager.js';
import { AuthManager } from './lib/AuthManager.js';
import { QueueManager } from './lib/QueueManager.js';

export class Runner {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private activeWorkers = 0;
    private authenticatedPage: Page | null = null;
    private isRunning = false;
    private rateLimitUntil = 0;

    // Components
    private transformer = new Transformer();
    private generator = new Generator();
    private recoveryManager = new RecoveryManager(50);
    private networkManager = new NetworkManager();
    private queueManager: QueueManager;
    private authManager: AuthManager;

    // Stats
    private searchedCount = 0;
    private startTime = 0;

    constructor(private config: ScraperConfig, private outputDir: string, private concurrency: number = 3) {
        this.queueManager = new QueueManager(config, outputDir, (msg) => this.log(msg));
        this.authManager = new AuthManager(config, this.networkManager, this.recoveryManager, outputDir);
    }

    private log(message: string, ...args: any[]) {
        if (!this.config.quiet) {
            console.log(message, ...args);
        }
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.startTime = Date.now();

        this.log(`[Runner] Starting search on ${this.config.url} (Concurrency: ${this.concurrency}, Limit: ${this.config.limit})`);

        if (!fs.existsSync(this.outputDir)) fs.mkdirSync(this.outputDir, { recursive: true });

        // [SRP] Delegate healthy URL pre-scanning to QueueManager
        this.queueManager.loadHealthyVisitedUrls();

        // 1. Launch & Auth
        try {
            this.log('[Runner] Launching browser...');
            this.browser = await chromium.launch({ headless: this.config.headless });
            this.context = await this.browser.newContext({ viewport: { width: 1920, height: 1080 } });

            // [Phase 8] Block specifically failing requests (Delegated to NetworkManager)
            await this.networkManager.setupRequestBlocking(this.context);

            // [RATE-LIMIT] Global listener for 429 errors (Delegated to NetworkManager)
            this.networkManager.setupRateLimitHandler(this.context, {
                on429: (url, method, delay, count, isDeepSleep) => {
                    this.log(`[Runner] ⚠️ 429 Too Many Requests detected! URL: [${method}] ${url}`);
                    if (isDeepSleep) {
                        console.warn(`[Runner] 💤 DEEP SLEEP triggered (8+ failures). Pausing for 30 minutes.`);
                    } else {
                        console.warn(`[Runner] ⚠️ Pausing for ${delay / 1000}s... (attempt #${count})`);
                    }
                    this.rateLimitUntil = this.networkManager.getRateLimitUntil();

                    if (this.concurrency > 1) {
                        this.concurrency--;
                        console.warn(`[Runner] 📉 Downgrading concurrency to ${this.concurrency}.`);
                    }
                },
                onRecovery: (count) => {
                    this.log(`[Runner] ✅ Success detected after cooldown (#${count}).`);
                    this.rateLimitUntil = 0;
                    // Gradually restore concurrency if limit allows
                    if (this.concurrency < (this.config.limit > 1 ? 3 : 1)) {
                        this.concurrency++;
                        this.log(`[Runner] 📈 Restoring concurrency to ${this.concurrency}.`);
                    }
                }
            });

            // Start Tracing
            await this.context.tracing.start({ screenshots: true, snapshots: true, sources: true });

            // Initial Auth
            const loginPage = await this.context.newPage();
            this.log(`[Runner] Navigating to ${this.config.url} for authentication...`);
            await loginPage.goto(this.config.url, { waitUntil: 'networkidle', timeout: 60000 });

            // [FIX] Correct method is performLogin
            const loginSuccess = await this.authManager.performLogin(loginPage, this.context);
            if (!loginSuccess) {
                console.error(`[Runner] ❌ Authentication failed.`);
                await this.stop();
                return;
            }

            this.log(`[Runner] Auth Success! Proceeding to crawl...`);
            await this.initializeSessionManager(loginPage);

            // Initial Job Handling
            if (!this.config.resume || this.queueManager.getQueueLength() === 0) {
                const startUrl = loginPage.url();
                const normalizedStart = this.queueManager.normalizeUrl(startUrl);
                this.log(`[Runner] Starting exploration from: ${normalizedStart.replace(/\/\/.*@/, '//***@')}`);

                if (this.queueManager.getQueueLength() === 0) {
                    this.queueManager.addJobs([{ url: normalizedStart, depth: 0, actionChain: [] }]);
                }
                this.queueManager.markVisited(normalizedStart);
            }

            this.authenticatedPage = loginPage;

        } catch (e) {
            console.error('[Runner] initialization/Auth error:', e);
            await this.stop();
            return;
        }

        // 2. Start Worker Loop
        await this.processQueue();

        this.log(`[Runner] Finished. Searched ${this.queueManager.getVisitedCount()} pages.`);
        this.queueManager.clearCheckpoint();

        // 3. Cleanup
        await this.stop();
    }

    private async initializeSessionManager(page: Page) {
        try {
            const tokens = await page.evaluate(() => {
                return {
                    access: localStorage.getItem('accessToken') || '',
                    refresh: localStorage.getItem('refreshToken') || '',
                    expiresIn: 3600
                };
            });

            const sessionMgr = SessionManager.getInstance();
            sessionMgr.setTokens(tokens.access, tokens.refresh, tokens.expiresIn);
            this.log('[Runner] SessionManager initialized with tokens.');

            sessionMgr.setRefreshHandler(async (refreshToken) => {
                this.log('[SessionManager] Refreshing token...');
                try {
                    const response = await this.context!.request.post('**/v2/user/token', {
                        data: { refreshToken }
                    });

                    if (response.ok()) {
                        const data = await response.json();
                        return {
                            accessToken: data.accessToken,
                            refreshToken: data.refreshToken || refreshToken,
                            expiresIn: data.expiresIn || 3600
                        };
                    } else {
                        throw new Error(`Refresh failed: ${response.status()}`);
                    }
                } catch (e) {
                    console.error('[SessionManager] Refresh error:', e);
                    throw e;
                }
            });

        } catch (e) {
            console.error('[Runner] Failed to initialize SessionManager:', e);
        }
    }

    private async processQueue() {
        while ((this.queueManager.getQueueLength() > 0 || this.activeWorkers > 0) && this.searchedCount < this.config.limit && this.isRunning) {

            // [RATE-LIMIT] Sync and check pause state from NetworkManager
            const currentWait = this.networkManager.getRateLimitUntil();
            if (Date.now() < currentWait) {
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }

            if (this.queueManager.getQueueLength() > 0 && this.activeWorkers < this.concurrency) {
                const job = this.queueManager.getNextJob();
                if (job) {
                    this.activeWorkers++;
                    const jitter = 3000 + Math.random() * 5000;
                    await new Promise(r => setTimeout(r, jitter));

                    this.runWorker(job).finally(() => {
                        this.activeWorkers--;
                        if (this.isRunning) {
                            this.queueManager.saveCheckpoint();
                        }
                    });
                }
            } else {
                await new Promise(r => setTimeout(r, 100));
            }
        }
    }

    private async runWorker(job: ScrapeJob) {
        if (!this.isRunning || !this.authenticatedPage) return;

        // [DEDUP] Check if already visited during processQueue jitter delay
        if (this.queueManager.isVisited(job.url) && this.searchedCount > 0) {
            // Already visited by another worker, skip.
            return;
        }

        const scraper = new Scraper(this.config, this.outputDir);
        this.searchedCount++;
        this.log(`[Runner] [${this.searchedCount}/${this.config.limit}] Worker started for: ${job.url}`);

        // Reuse context but create a new page
        let page: Page | null = null;
        try {
            page = await this.context!.newPage();
            const result = await scraper.scrape(page, job);

            if (!result.error && result.discoveredLinks) {
                const newJobs = result.discoveredLinks
                    .filter(link => !this.queueManager.isVisited(link.url))
                    .map(link => ({
                        url: link.url,
                        depth: job.depth + 1,
                        sourceUrl: job.url,
                        actionChain: result.actionChain,
                        functionalPath: result.functionalPath ? [result.functionalPath] : job.functionalPath
                    }));

                const added = this.queueManager.addJobs(newJobs);
                if (added > 0) {
                    this.log(`[Runner] Discovered ${added} new links from ${job.url}`);
                }
            }

            if (!result.error) {
                this.log(`[Runner] Page analyzed: ${result.pageTitle} (${result.elements.length} elements)`);
                const scenarios = this.transformer.transform(result.elements);
                const stats: Record<string, number> = {};
                result.elements.forEach(el => { stats[el.type] = (stats[el.type] || 0) + 1; });

                const searchResult: SearchResult = {
                    success: true,
                    url: job.url,
                    timestamp: new Date().toISOString(),
                    pageTitle: result.pageTitle,
                    elements: result.elements,
                    scenarios,
                    discoveredLinks: result.links,
                    sidebarLinks: result.sidebarLinks || [],
                    modalDiscoveries: result.modalDiscoveries,
                    actionChain: result.actionChain,
                    functionalPath: result.functionalPath || '',
                    metadata: {
                        totalElements: result.elements.length,
                        byType: stats,
                        domain: new URL(job.url).hostname,
                        bySection: { 0: result.elements.length }
                    }
                };

                const subDir = path.join(this.outputDir, '..');
                await this.generator.generate(searchResult, {
                    outputDir: subDir,
                    formats: ['markdown', 'playwright', 'json'],
                    includeScreenshots: true
                });
            }

        } catch (e) {
            this.log(`[Runner] ❌ Error processing ${job.url}:`, e);
        } finally {
            if (page) await page.close().catch(() => { });
        }
    }

    async stop() {
        this.isRunning = false;
        if (this.context) {
            const tracePath = path.join(this.outputDir, '..', `trace-${Date.now()}.zip`);
            await this.context.tracing.stop({ path: tracePath }).catch(() => { });
            await this.context.close().catch(() => { });
        }
        if (this.browser) await this.browser.close().catch(() => { });
        this.browser = null;
        this.context = null;
        this.authenticatedPage = null;
    }
}
