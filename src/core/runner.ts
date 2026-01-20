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
        if (!this.config.force) {
            this.queueManager.loadHealthyVisitedUrls();
        }

        // 1. Launch & Auth
        try {
            this.log('[Runner] Launching browser...');
            this.browser = await chromium.launch({ headless: this.config.headless });
            this.context = await this.browser.newContext({ viewport: { width: 1920, height: 1080 } });

            // [DEBUG] Track download events to identify source
            this.context.on('page', page => {
                page.on('download', async download => {
                    // Silently cancel downloads (PDF exports, etc.)
                    await download.cancel().catch(() => { });
                });

                // [CONFIGURABLE] Filter console errors from dev server artifacts
                // Set FILTER_DEV_ERRORS=false in .env to disable filtering
                page.on('console', msg => {
                    const text = msg.text();

                    // Known dev server patterns to ignore
                    const ignoredPatterns = [
                        /WebSocket connection.*localhost.*failed/i,
                        /Warning: forwardRef render functions/i,
                        /net::ERR_CONNECTION_REFUSED/i
                    ];

                    const shouldFilter = process.env.FILTER_DEV_ERRORS !== 'false' &&
                        ignoredPatterns.some(pattern => pattern.test(text));

                    if (!shouldFilter && (msg.type() === 'error' || text.includes('[DEBUG]'))) {
                        this.log(`[Browser ${msg.type()}] ${text}`);
                    }
                });
            });

            // [Phase 8] Block specifically failing requests (Delegated to NetworkManager)
            await this.networkManager.setupRequestBlocking(this.context);

            // [RATE-LIMIT] Global listener for 429 errors (Delegated to NetworkManager)
            this.networkManager.setupRateLimitHandler(this.context, {
                on429: (url, method, delay, count, isDeepSleep) => {
                    this.log(`[Runner] ⚠️ 429 Too Many Requests detected! URL: [${method}] ${url}`);
                    if (isDeepSleep) {
                        console.warn('[Runner] 💤 DEEP SLEEP triggered (8+ failures). Pausing for 30 minutes.');
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
            this.log(`[Runner] Performing authentication...`);
            // [OPTIMIZATION] Removed duplicate goto - AuthManager.performLogin already handles navigation

            // [FIX] Correct method is performLogin
            const loginSuccess = await this.authManager.performLogin(loginPage, this.context);
            if (!loginSuccess) {
                console.error('[Runner] ❌ Authentication failed.');
                await this.stop();
                return;
            }

            this.log('[Runner] Auth Success! Proceeding to crawl...');
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

    /**
     * Extract token expiry time from browser storage or cookies.
     * @returns expiresIn in seconds, or 3600 as default
     */
    private async extractTokenExpiry(page: Page, cookies: any[]): Promise<number> {
        // 1. Try localStorage/sessionStorage
        try {
            const expiry = await page.evaluate(() => {
                return localStorage.getItem('tokenExpiry') ||
                    sessionStorage.getItem('tokenExpiry') ||
                    localStorage.getItem('expiresIn') ||
                    sessionStorage.getItem('expiresIn');
            });
            if (expiry) {
                const parsed = parseInt(expiry);
                if (!isNaN(parsed) && parsed > 0) {
                    this.log(`[Runner] Found token expiry in storage: ${parsed}s`);
                    return parsed;
                }
            }
        } catch (e) {
            // Ignore evaluation errors
        }

        // 2. Try cookies
        const expiryCookie = cookies.find(c =>
            c.name === 'token_expiry' || c.name === 'expires_in'
        );
        if (expiryCookie) {
            const parsed = parseInt(expiryCookie.value);
            if (!isNaN(parsed) && parsed > 0) {
                this.log(`[Runner] Found token expiry in cookie: ${parsed}s`);
                return parsed;
            }
        }

        // 3. Default fallback
        this.log('[Runner] Using default token expiry: 3600s');
        return 3600;
    }

    private async initializeSessionManager(page: Page) {
        try {
            // [AUTH-FIX] Wait for tokens to be populated in localStorage
            let attempts = 0;
            let tokens = { access: '', refresh: '', expiresIn: 3600 };

            while (attempts < 10) {
                tokens = await page.evaluate(() => {
                    return {
                        access: localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken') || '',
                        refresh: localStorage.getItem('refreshToken') || sessionStorage.getItem('refreshToken') || '',
                        expiresIn: 3600
                    };
                });

                if (tokens.access && tokens.refresh) {
                    break;
                }

                await page.waitForTimeout(1000);
                attempts++;
            }

            // [AUTH-FIX] Get cookies for fallback and expiry extraction
            const cookies = await this.context!.cookies();

            if (!tokens.access || !tokens.refresh) {
                console.warn('[Runner] ⚠️ Warning: Failed to retrieve tokens from localStorage after login.');

                // Fallback: Try to get refresh token from cookies (HttpOnly)
                const refreshCookie = cookies.find(c => c.name === 'refresh_token');

                if (refreshCookie) {
                    tokens.refresh = refreshCookie.value;
                    this.log('[Runner] ✓ Retrieved refresh_token from HttpOnly cookie.');
                } else {
                    console.error('[Runner] ❌ CRITICAL: Could not find refresh_token in cookies or localStorage.');
                }
            } else {
                this.log(`[Runner] Retrieved tokens (Access: ${tokens.access.substring(0, 10)}...)`);
            }

            // Extract actual token expiry time
            tokens.expiresIn = await this.extractTokenExpiry(page, cookies);

            const sessionMgr = SessionManager.getInstance();
            sessionMgr.setTokens(tokens.access, tokens.refresh, tokens.expiresIn);
            this.log(`[Runner] SessionManager initialized with tokens (expires in ${tokens.expiresIn}s).`);

            sessionMgr.setRefreshHandler(async (refreshToken) => {
                this.log('[SessionManager] Refreshing token...');
                try {
                    // [AUTH-FIX] Dynamic API URL based on environment
                    const isDev = this.config.url.includes('dev.ianai.co');
                    const apiBase = isDev ? 'https://api-dev.ianai.co' : 'https://api-stage.ianai.co';
                    const originBase = isDev ? 'https://dev.ianai.co' : 'https://stage.ianai.co';
                    this.log(`[SessionManager] Using API Base: ${apiBase}`);

                    const response = await this.context!.request.post(`${apiBase}/v2/user/token`, {
                        data: { refreshToken },
                        headers: {
                            'Origin': originBase,
                            'Referer': `${originBase}/app`,
                            'Content-Type': 'application/json'
                        }
                    });

                    if (response.ok()) {
                        const data = await response.json();
                        const expiresIn = data.expiresIn ?? data.expires_in ?? 3600;
                        const newAccessToken = data.accessToken || data.token;

                        if (!newAccessToken) {
                            console.error('[SessionManager] Refresh response missing accessToken:', data);
                            throw new Error('Refresh response missing accessToken');
                        }

                        this.log(`[SessionManager] Token refreshed (expires in ${expiresIn}s)`);
                        return {
                            accessToken: newAccessToken,
                            refreshToken: data.refreshToken || refreshToken,
                            expiresIn: expiresIn
                        };
                    } else {
                        const errorText = await response.text();
                        console.error(`[SessionManager] Refresh failed: ${response.status()} - ${errorText}`);
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

            const queueLength = this.queueManager.getQueueLength();
            if (queueLength > 0 && this.activeWorkers < this.concurrency) {
                this.log(`[Runner-Debug] Queue: ${queueLength}, Active: ${this.activeWorkers}, Searched: ${this.searchedCount}/${this.config.limit}`);
                const job = this.queueManager.getNextJob();
                if (job) {
                    this.activeWorkers++;
                    const jitter = 3000 + Math.random() * 5000;
                    await new Promise(r => setTimeout(r, jitter));

                    // For concurrency=1, await the worker to complete before continuing
                    if (this.concurrency === 1) {
                        await this.runWorker(job);
                        this.activeWorkers--;
                        if (this.isRunning) {
                            this.queueManager.saveCheckpoint();
                        }
                    } else {
                        // For higher concurrency, run in parallel
                        this.runWorker(job).finally(() => {
                            this.activeWorkers--;
                            if (this.isRunning) {
                                this.queueManager.saveCheckpoint();
                            }
                        });
                    }
                }
            } else {
                await new Promise(r => setTimeout(r, 100));
            }
        }
    }

    private async runWorker(job: ScrapeJob) {
        if (!this.isRunning || !this.authenticatedPage) return;

        // [DEDUP] Check if already visited during processQueue jitter delay
        if (this.queueManager.isVisited(job.url)) {
            // Already visited by another worker, skip.
            return;
        }

        // Mark as visited NOW, before starting work
        this.queueManager.markVisited(job.url);

        const scraper = new Scraper(this.config, this.outputDir);
        this.searchedCount++;
        this.log(`[Runner] [${this.searchedCount}/${this.config.limit}] Worker started for: ${job.url}`);

        // [OPTIMIZATION] Reuse authenticated page for single-tab mode (concurrency=1)
        let page: Page | null = null;
        const shouldReuseTab = this.concurrency === 1;

        try {
            // [AUTH-FIX] Ensure tokens are fresh BEFORE creating/using page
            const sessionMgr = SessionManager.getInstance();
            let accessToken: string;
            try {
                accessToken = await sessionMgr.getAccessToken(); // Triggers refresh if expiring, returns valid token
                console.log(`[Runner-Debug] Received accessToken: ${accessToken ? accessToken.substring(0, 10) + '...' : 'EMPTY'}`);
            } catch (e) {
                console.error(`[Runner] Token refresh failed for ${job.url}. Aborting worker.`, e);
                return;
            }

            if (!accessToken) {
                console.error(`[Runner] No access token available for ${job.url}. Aborting worker.`);
                return;
            }

            const { refreshToken } = sessionMgr.getTokens();

            if (shouldReuseTab) {
                // Reuse the authenticated page (single tab mode)
                page = this.authenticatedPage;
                this.log('[Runner] Reusing authenticated tab for next URL...');
            } else {
                // Create new page for parallel processing
                page = await this.context!.newPage();

                // Inject tokens IMMEDIATELY after page creation, before any navigation
                await page.addInitScript((tokens) => {
                    localStorage.setItem('accessToken', tokens.access);
                    localStorage.setItem('refreshToken', tokens.refresh);
                    try {
                        sessionStorage.setItem('accessToken', tokens.access);
                        sessionStorage.setItem('refreshToken', tokens.refresh);
                    } catch (e) { }
                }, { access: accessToken, refresh: refreshToken });
            }

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
            // Only close page if it's a temporary page (not the authenticated page)
            if (page && !shouldReuseTab) {
                await page.close().catch(() => { });
            }
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
