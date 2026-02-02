import { chromium, Browser, BrowserContext, Page, Cookie } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { Scraper } from './index.js';
import { TransformerService as Transformer } from './services/TransformerService.js';
import { GeneratorService as Generator } from './services/GeneratorService.js';
import { SearchResult, TransactionPayload } from '../types/index.js';
import { ScrapeJob, ScraperConfig, JobPriority } from '../types/scraper.js';
import { RecoveryManager } from '../shared/network/RecoveryManager.js';
import { NetworkManager } from '../shared/network/NetworkManager.js';
import { AuthManager } from '../shared/auth/AuthManager.js';
import { QueueManager } from './queue/QueueManager.js';
import { PlaywrightPage } from './adapters/playwright/PlaywrightPage.js';
import { RLStateManager } from './rl/RLStateManager.js';
import { RLSubscriber } from './subscribers/RLSubscriber.js';
import { extractAllKeys } from '../shared/utils/ObjectUtils.js';

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

    private labelsDir: string;

    constructor(private config: ScraperConfig, private outputDir: string, private concurrency: number = 3) {
        this.queueManager = new QueueManager(config, outputDir, (msg) => this.log(msg));
        this.authManager = new AuthManager(config, this.networkManager, this.recoveryManager, outputDir);

        // Link NetworkManager to AuthManager for token injection
        this.networkManager.setAuthProvider(this.authManager);

        this.labelsDir = path.join(this.outputDir, 'print_label');
        if (!fs.existsSync(this.labelsDir)) fs.mkdirSync(this.labelsDir, { recursive: true });
    }

    private log(message: string, ...args: unknown[]) {
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

        // Initialize RL System (Decoupled via EventBus)
        const rlManager = new RLStateManager(this.outputDir);
        new RLSubscriber(rlManager);

        // [SRP] Delegate healthy URL pre-scanning to QueueManager
        // Force mode is handled inside QueueManager to re-add to queue
        // 3. Load previous state aggressively
        this.queueManager.loadHealthyVisitedUrls();

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

                    if (!shouldFilter && text.includes('[DEBUG]')) {
                        this.log(`[Browser ${msg.type()}] ${text}`);
                    }
                });
            });

            // [Phase 8] Block specifically failing requests (Delegated to NetworkManager)
            await this.networkManager.setupRequestBlocking(this.context);

            // [Phase 2] Setup Transaction Capturer for Schema Extraction
            this.networkManager.setupTransactionCapturer(this.context, (type, module, uuid, data, triggerAction) => {
                const transDir = path.join(this.outputDir, 'transactions', module);
                if (!fs.existsSync(transDir)) fs.mkdirSync(transDir, { recursive: true });

                const suffix = type === 'req' ? '_req' : '_res';
                const filePath = path.join(transDir, `${uuid}${suffix}.json`);

                if (!fs.existsSync(filePath)) {
                    // Include triggerAction in the data
                    const enrichedData: Record<string, unknown> = typeof data === 'object' && data !== null
                        ? { ...data as Record<string, unknown>, triggerAction: triggerAction || 'unknown' }
                        : { data, triggerAction: triggerAction || 'unknown' };
                    fs.writeFileSync(filePath, JSON.stringify(enrichedData, null, 2));
                    this.log(`[Runner] 🛰️ Captured transaction ${type === 'req' ? 'request' : 'response'}: ${module}/${uuid} (Trigger: ${triggerAction || 'None'})`);

                    // [NEW] Update print_label dictionary (Both req and res keys are valuable)
                    this.updatePrintLabelDictionary(module, enrichedData);
                }
            });
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

            // Link NetworkManager and Setup Refresh Handler BEFORE Login
            this.networkManager.setAuthProvider(this.authManager);
            this.setupAuthRefreshHandler();

            // Initial Auth
            const loginPage = await this.context.newPage();
            this.log('[Runner] Performing authentication...');
            // [OPTIMIZATION] Removed duplicate goto - AuthManager.performLogin already handles navigation

            // [FIX] Correct method is performLogin
            const loginSuccess = await this.authManager.performLogin(loginPage, this.context);
            if (!loginSuccess) {
                console.error('[Runner] ❌ Authentication failed.');
                await this.stop();
                return;
            }

            this.log('[Runner] Auth Success! Proceeding to crawl...');
            await this.initializeAuthTokens(loginPage);

            // Initial Job Handling
            if (!this.config.resume || this.queueManager.getQueueLength() === 0) {
                const startUrl = loginPage.url();
                const normalizedStart = this.queueManager.normalizeUrl(startUrl);
                this.log(`[Runner] Starting exploration from: ${normalizedStart.replace(/\/\/.*@/, '//***@')}`);

                if (this.queueManager.getQueueLength() === 0) {
                    this.queueManager.addJobs([{ url: normalizedStart, depth: 0, actionChain: [] }]);
                }
                // [BUG FIX] Removed markVisited() here - worker will mark it when actually processing
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
    private async extractTokenExpiry(page: Page, cookies: Cookie[]): Promise<number> {
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
        } catch {
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

    private async initializeAuthTokens(page: Page) {
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

            this.authManager.setTokens(tokens.access, tokens.refresh, tokens.expiresIn);
            this.log(`[Runner] Auth state initialized (expires in ${tokens.expiresIn}s).`);

        } catch (_e) {
            console.error('[Runner] Failed to initialize Auth Tokens:', _e);
        }
    }

    private setupAuthRefreshHandler() {
        if (!this.context) return;

        this.authManager.setRefreshHandler(async (refreshToken) => {
            this.log('[AuthManager] Refreshing token via Runner configured handler...');
            try {
                // [AUTH-FIX] Dynamic API URL based on environment
                const isDev = this.config.url.includes('dev.ianai.co');
                const apiBase = isDev ? 'https://api-dev.ianai.co' : 'https://api-stage.ianai.co';
                const originBase = isDev ? 'https://dev.ianai.co' : 'https://stage.ianai.co';

                const response = await this.context!.request.post(`${apiBase}/v2/user/token`, {
                    data: { refresh_token: refreshToken },
                    headers: {
                        'Origin': originBase,
                        'Referer': `${originBase}/app`,
                        'Content-Type': 'application/json',
                        'X-Internal-Request': 'true'
                    }
                });

                if (response.ok()) {
                    const data = await response.json();
                    const expiresIn = data.expiresIn ?? data.expires_in ?? 3600;
                    const newAccessToken = data.accessToken || data.token;

                    if (!newAccessToken) {
                        throw new Error('Refresh response missing accessToken');
                    }

                    console.log(`[AuthManager] ✓ Token refreshed successfully (New access token: ${newAccessToken.substring(0, 10)}...)`);
                    return {
                        accessToken: newAccessToken,
                        refreshToken: data.refreshToken || refreshToken,
                        expiresIn: expiresIn
                    };
                } else {
                    const errorStatus = response.status();
                    const errorText = await response.text();
                    console.error(`[AuthManager] ❌ Token refresh failed with status ${errorStatus}: ${errorText}`);
                    throw new Error(`Refresh failed: ${errorStatus} - ${errorText}`);
                }
            } catch (e) {
                console.error('[AuthManager] Refresh error:', e);
                throw e;
            }
        });
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
                    // [ENHANCE] Adaptive Jitter: Reduce wait if queue is large and no recent 429s
                    const baseJitter = Date.now() < this.rateLimitUntil ? 10000 : 1000;
                    const jitter = baseJitter + Math.random() * 2000;
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

        const scraper = new Scraper(this.config, this.outputDir, this.networkManager);
        this.searchedCount++;
        this.log(`[Runner] [${this.searchedCount}/${this.config.limit}] Worker started for: ${job.url}`);

        // [OPTIMIZATION] Reuse authenticated page for single-tab mode (concurrency=1)
        let page: Page | null = null;
        const shouldReuseTab = this.concurrency === 1;

        try {
            // [AUTH-FIX] Ensure tokens are fresh BEFORE creating/using page
            let accessToken: string;
            try {
                accessToken = await this.authManager.getAccessToken(); // Triggers refresh if expiring, returns valid token
                console.log(`[Runner-Debug] Received accessToken: ${accessToken ? accessToken.substring(0, 10) + '...' : 'EMPTY'}`);
            } catch (e) {
                console.error(`[Runner] Token refresh failed for ${job.url}. Aborting worker.`, e);
                return;
            }

            if (!accessToken) {
                console.error(`[Runner] No access token available for ${job.url}. Aborting worker.`);
                return;
            }

            const { refreshToken } = this.authManager.getTokens();

            if (shouldReuseTab) {
                // Reuse the authenticated page (single tab mode)
                page = this.authenticatedPage;
                this.log('[Runner] Reusing authenticated tab for next URL...');
            } else {
                // Create new page for parallel processing
                page = await this.context!.newPage();

                // Inject tokens IMMEDIATELY after page creation, before any navigation
                await page.addInitScript((tokens: { access: string, refresh: string }) => {
                    localStorage.setItem('accessToken', tokens.access);
                    localStorage.setItem('refreshToken', tokens.refresh);
                    try {
                        sessionStorage.setItem('accessToken', tokens.access);
                        sessionStorage.setItem('refreshToken', tokens.refresh);
                    } catch {
                        /* ignored */
                    }
                }, { access: accessToken, refresh: refreshToken });
            }

            const browserPage = new PlaywrightPage(page);
            const result = await scraper.scrape(browserPage, job);

            if (!result.error && result.discoveredLinks) {
                // [ENHANCE] Prioritize Sidebar Links
                const sidebarUrls = new Set(result.sidebarLinks || []);
                
                const newJobs = result.discoveredLinks
                    .filter(link => !this.queueManager.isVisited(link.url))
                    .map(link => ({
                        url: link.url,
                        depth: job.depth + 1,
                        sourceUrl: job.url,
                        actionChain: result.actionChain,
                        functionalPath: result.functionalPath ? [result.functionalPath] : job.functionalPath,
                        priority: sidebarUrls.has(link.url) ? JobPriority.HIGH : JobPriority.NORMAL
                    }));

                const added = this.queueManager.addJobs(newJobs);
                if (added > 0) {
                    this.log(`[Runner] Discovered ${added} new links from ${job.url}`);
                    this.queueManager.saveCheckpoint(); // [USER-REQUEST] Save immediately after discovery
                }
            }

            if (!result.error) {
                this.log(`[Runner] Page analyzed: ${result.pageTitle} (${result.elements.length} elements)`);
                this.queueManager.saveCheckpoint(); // [USER-REQUEST] Save immediately after analysis
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
            try {
                await this.context.tracing.stop({ path: tracePath }).catch(() => { });
            } catch { /* ignore */ }

            await this.context?.close().catch(() => { });
        }
        if (this.browser) await this.browser?.close().catch(() => { });
        this.browser = null;
        this.context = null;
        this.authenticatedPage = null;
    }

    private updatePrintLabelDictionary(module: string, data: TransactionPayload) {
        const labelFile = path.join(this.labelsDir, `${module}.json`);
        let existingKeys: string[] = [];

        if (fs.existsSync(labelFile)) {
            try {
                existingKeys = JSON.parse(fs.readFileSync(labelFile, 'utf-8'));
            } catch { /* ignore */ }
        }

        const newKeys = extractAllKeys(data);
        const combinedKeys = Array.from(new Set([...existingKeys, ...newKeys])).sort();

        fs.writeFileSync(labelFile, JSON.stringify(combinedKeys, null, 2));
    }


}
