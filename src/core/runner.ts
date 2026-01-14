import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { Scraper } from './scraper.js';
import { Analyzer } from '../../scripts/analyzer.js';
import { Generator } from '../../scripts/generator.js';
import { AnalysisResult } from '../../types/index.js';
import { ScrapeJob, ScraperConfig } from './types.js';
import { RecoveryManager } from './RecoveryManager.js';
import { NetworkManager } from './NetworkManager.js';

export class Runner {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private queue: ScrapeJob[] = [];
    private visitedUrls = new Set<string>();
    private activeWorkers = 0;
    private authenticatedPage: Page | null = null;
    private isRunning = false;

    // Components
    private analyzer = new Analyzer();
    private generator = new Generator();
    private recoveryManager = new RecoveryManager(50); // [RECOVERY] Modular error handling
    private networkManager = new NetworkManager(); // [NETWORK] CORS-safe header injection
    private normalizedUrlMap = new Map<string, string>(); // [CACHE] URL normalization results

    // Stats
    private analyzedCount = 0;
    private startTime = 0;

    constructor(private config: ScraperConfig, private outputDir: string, private concurrency: number = 3) { }

    async start() {
        console.log(`[Runner] Starting Multi-Tab Scraper (Concurrency: ${this.concurrency})...`);
        this.startTime = Date.now();
        this.isRunning = true;

        if (!fs.existsSync(this.outputDir)) fs.mkdirSync(this.outputDir, { recursive: true });

        // [NEW] Multi-Epoch Accumulation Logic
        this.loadHealthyVisitedUrls();

        // 1. Launch & Auth
        this.browser = await chromium.launch({ headless: this.config.headless });
        this.context = await this.browser.newContext({ viewport: { width: 1920, height: 1080 } });

        // [TEMPORARY WORKAROUND] Block failing refresh token requests
        // Backend doesn't issue valid refresh tokens on stage.ianai.co
        // TODO: Remove when backend is fixed - controlled by BLOCK_REFRESH_TOKEN env var
        if (process.env.BLOCK_REFRESH_TOKEN === 'true') {
            console.log('[Runner] ⚠️  Refresh token blocking enabled (BLOCK_REFRESH_TOKEN=true)');
            await this.context.route('**/v2/user/token', route => {
                console.log('[Runner] 🚫 Blocked refresh token request');
                route.abort('blockedbyclient');
            });
        }

        // Start Tracing
        await this.context.tracing.start({ screenshots: true, snapshots: true, sources: true });

        // Login (Single Session)
        const loginPage = await this.context.newPage();
        // [NEW] Strict Login Check
        const loginSuccess = await this.performLogin(loginPage);
        if (!loginSuccess && (this.config.username && this.config.password)) {
            console.error('[Runner] Login failed or could not be verified. Aborting exploration as per strict safety rules.');
            await this.stop();
            return;
        }

        // Initial Job - [FIX] Use current page URL if it changed (e.g. redirect to /app/home)
        // Initial Job - [FIX] Use current page URL if it changed (e.g. redirect to /app/home)
        const startUrl = loginPage.url();
        const normalizedStart = this.normalizeUrl(startUrl);
        const safeStartUrl = normalizedStart.replace(/\/\/.*@/, '//***@');
        console.log(`[Runner] Starting exploration from: ${safeStartUrl}`);
        this.queue.push({ url: normalizedStart, depth: 0, actionChain: [] });
        this.visitedUrls.add(normalizedStart);

        // [CRITICAL FIX] Store authenticated page for ALL workers to reuse
        // This preserves the login session throughout the entire crawl
        this.authenticatedPage = loginPage;

        // 2. Start Worker Loop (now ALL workers use same page)
        await this.processQueue();

        // 3. Cleanup
        await this.stop();
    }

    private async performLogin(page: Page): Promise<boolean> {


        page.on('response', async response => {
            if (response.status() >= 400 && (response.url().includes('login') || response.url().includes('auth') || response.url().includes('api'))) {
                console.log(`[Network] ${response.status()} Error on: ${response.url()}`);

                // [RECOVERY] Delegate to RecoveryManager
                await this.recoveryManager.checkAndTriggerRecovery(page);

                try {
                    const body = await response.text();
                    console.log(`[Network] Error Body: ${body.substring(0, 500)}`);
                } catch { /* ignore */ }
            }
        });

        console.log('[Runner] Navigating to target...');
        await page.goto(this.config.url, { waitUntil: 'load' });

        // Wait for SPA to render
        await page.waitForTimeout(2000);

        // Auto-login if credentials are provided
        try {
            // Use locator with wait for better SPA support
            const emailLocator = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i], input[type="text"]').first();
            const passwordLocator = page.locator('input[type="password"], input[name="password"], input[placeholder*="password" i]').first();

            // Wait for email field to appear (indicates login form is rendered)
            await emailLocator.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });

            const emailVisible = await emailLocator.isVisible().catch(() => false);
            const passwordVisible = await passwordLocator.isVisible().catch(() => false);

            if (emailVisible && passwordVisible) {
                console.log('[Runner] Login form detected.');

                if (this.config.username && this.config.password) {
                    console.log('[Runner] Attempting auto-login...');
                    console.log(`[Runner] Username: ${this.config.username}`);

                    // Fill credentials and trigger blur to ensure React state update
                    await emailLocator.fill(this.config.username);
                    await emailLocator.blur();
                    await page.waitForTimeout(500);

                    await passwordLocator.fill(this.config.password);
                    await passwordLocator.blur();
                    await page.waitForTimeout(500);



                    // Click submit button
                    const submitBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("Log in"), button:has-text("Sign in"), button:has-text("로그인")').first();
                    if (await submitBtn.isVisible().catch(() => false)) {
                        // [REVERSE ENGINEERING WORKAROUND] Force inject missing session headers
                        // Inject BEFORE clicking to ensure even the very first redirect APIs are covered
                        if (process.env.INJECT_CUSTOM_HEADERS === 'true') {
                            let targetCompanyId = '';

                            if (this.config.url.includes('stage.ianai.co')) {
                                targetCompanyId = process.env.COMPANY_ID_STAGE || '';
                                console.log('[Runner] Environment: STAGE detected');
                            } else if (this.config.url.includes('dev.ianai.co')) {
                                targetCompanyId = process.env.COMPANY_ID_DEV || '';
                                console.log('[Runner] Environment: DEV detected');
                            }

                            if (targetCompanyId) {
                                // [FIX] Use NetworkManager for safe, selective injection (Avoids CORS errors)
                                await this.networkManager.enableHeaderInjection(this.context!, targetCompanyId);
                            } else {
                                console.log('[Runner] ⚠️ No matching Company ID found for this environment.');
                            }
                        }

                        // [FIX] Wait for state to settle
                        await page.waitForTimeout(1000);

                        // Try clicking, then pressing Enter as backup
                        await submitBtn.click();
                        // await page.keyboard.press('Enter'); 
                        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });

                        // [TEMPORARY WORKAROUND] Clear form fields to prevent auto-resubmit
                        // TODO: Remove when SPA is fixed - controlled by CLEAR_LOGIN_FIELDS env var
                        if (process.env.CLEAR_LOGIN_FIELDS === 'true') {
                            await emailLocator.fill('').catch(() => { });
                            await passwordLocator.fill('').catch(() => { });
                            console.log('[Runner] ✓ Cleared login form fields (CLEAR_LOGIN_FIELDS=true)');
                        }

                        await page.waitForTimeout(3000);

                        // Check login success - should be redirected away from login page
                        const currentUrl = page.url();
                        const safeLogUrl = currentUrl.replace(/\/\/.*@/, '//***@'); // [SECURITY] Sanitize credentials
                        console.log(`[Runner] Post-login URL: ${safeLogUrl}`);



                        // [RE-ENABLED] Force navigation to /app/home after login
                        // User confirmed manual login works, so we need to navigate properly
                        if (currentUrl.includes('/app/logged-in') || currentUrl.endsWith('/app') || currentUrl.endsWith('/app/')) {
                            console.log('[Runner] Forcing navigation to /app/home...');
                            await page.goto(new URL('/app/home', this.config.url).toString(), { waitUntil: 'networkidle', timeout: 30000 }).catch(() => { });
                            await page.waitForTimeout(3000);
                            console.log(`[Runner] Now at: ${page.url()}`);
                        }

                        // Verify we're logged in
                        const stillOnLogin = await passwordLocator.isVisible().catch(() => false);
                        const hasDashboard = await page.locator('nav, aside, .sidebar, [role="navigation"], .navBar').first().isVisible().catch(() => false);

                        // "Welcome" text usually appears on the dashboard landing page
                        const hasWelcomeText = await page.getByText('Welcome', { exact: false }).isVisible().catch(() => false);
                        const hasLoginSuccess = await page.getByText('Login successful', { exact: false }).isVisible().catch(() => false);

                        if (stillOnLogin && !hasWelcomeText && !hasLoginSuccess) {
                            console.log('[Runner] WARNING: Login check failed (Still on login page).');
                            const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 100));
                            console.log(`[Runner] Page state: ${bodyText.replace(/\n/g, ' ')}...`);
                            return false;
                        } else {
                            if (!hasDashboard) {
                                console.log('[Runner] ⚠️ Login passed auth wall ("Welcome/Login successful" found), but Dashboard UI not detected. APIs might be failing.');
                            } else {
                                console.log('[Runner] Login successful and Dashboard detected!');
                            }

                            // [FIX] Save session after successful login (was missing after cherry-pick)
                            // This prevents session loss that causes redirect back to login
                            if (this.context) {
                                const tempAuthFile = path.join(this.outputDir, 'temp-auth.json');
                                await this.context.storageState({ path: tempAuthFile });
                                console.log(`[Runner] Session saved to ${tempAuthFile}`);
                            }

                            return true;
                        }
                    } else {
                        console.log('[Runner] Submit button not found.');
                        return false;
                    }
                } else if (!this.config.headless) {
                    console.log('[Runner] No credentials provided. Waiting for manual login...');
                    await page.pause();
                    return true; // Assume success for manual intervention
                } else {
                    console.log('[Runner] No credentials provided and running headless. Skipping login.');
                    return true; // Skip login but proceed
                }
            } else {
                console.log('[Runner] No login form detected, proceeding...');
                return true; // Already logged in or no login needed
            }
        } catch (e) {
            console.log(`[Runner] Login error: ${(e as Error).message}`);
            return false;
        }
        // [FIX] Do NOT close the page - we'll reuse it for the first worker
        // Page will be closed by runWorker after processing
    }

    private async processQueue() {
        while ((this.queue.length > 0 || this.activeWorkers > 0) && this.analyzedCount < this.config.limit && this.isRunning) {
            if (this.queue.length > 0 && this.activeWorkers < this.concurrency) {
                const job = this.queue.shift();
                if (job) {
                    this.activeWorkers++;
                    this.runWorker(job).finally(() => { this.activeWorkers--; });
                }
            } else {
                await new Promise(r => setTimeout(r, 100)); // Sleep 100ms
            }
        }
    }

    private async runWorker(job: ScrapeJob) {
        if (!this.authenticatedPage) {
            console.error('[Runner] No authenticated page available');
            return;
        }

        // [FIX] Zombie Page Recovery
        if (this.authenticatedPage.isClosed()) {
            console.warn('[Runner] ⚠️ Authenticated page is CLOSED (Zombie). Attempting to recover session...');
            try {
                const newPage = await this.context!.newPage();
                const success = await this.performLogin(newPage);
                if (success) {
                    console.log('[Runner] ✓ Session recovered successfully!');
                    this.authenticatedPage = newPage;
                } else {
                    console.error('[Runner] ❌ Recovery failed. Aborting worker.');
                    return;
                }
            } catch (e) {
                console.error(`[Runner] Critical Error during recovery: ${e}`);
                return;
            }
        }

        const page = this.authenticatedPage;

        // [DEBUG] Forward browser logs to node console
        page.on('console', msg => {
            if (msg.type() === 'log' || msg.type() === 'warning' || msg.type() === 'error') {
                const text = msg.text();
                const truncated = text.length > 300 ? text.substring(0, 300) + '... (truncated)' : text;
                console.log(`[Browser] ${truncated}`);
            }
        });

        try {
            console.log(`[Runner] Worker started for: ${job.url}`);
            const result = await Scraper.processPage(page, job.url, this.config, this.outputDir, job.actionChain || [], job.functionalPath || []);

            // [NEW] Golden Path Logging
            if (result.goldenPath) {
                const { isStable, confidence, reasons } = result.goldenPath;
                const status = isStable ? '✓ STABLE' : '⚠ UNSTABLE';
                const confidencePercent = (confidence * 100).toFixed(0);

                console.log(`[Runner] Golden Path: ${status} (${confidencePercent}%)`);
                reasons.forEach(reason => console.log(`[Runner]   - ${reason}`));
            }

            // --- ANALYZE ---
            const scenarios = this.analyzer.analyze(result.elements);
            const stats: Record<string, number> = {};
            result.elements.forEach(el => { stats[el.type] = (stats[el.type] || 0) + 1; });

            const analysisResult: AnalysisResult = {
                success: !result.error,
                url: job.url,
                timestamp: new Date().toISOString(),
                pageTitle: result.pageTitle,
                elements: result.elements,
                scenarios,
                discoveredLinks: result.links,
                sidebarLinks: result.sidebarLinks || [],
                modalDiscoveries: result.modalDiscoveries,
                actionChain: result.actionChain, // [NEW] Pass action chain
                metadata: {
                    totalElements: result.elements.length,
                    byType: stats as Record<string, number>,
                    domain: new URL(job.url).hostname,
                    bySection: { 0: result.elements.length }
                }
            };

            // Determine output folder based on domain
            const subDir = path.join(this.outputDir, '..'); // Assuming outputDir is the screenshots folder

            await this.generator.generate(analysisResult, {
                outputDir: subDir, // Pass base output dir (scripts/generator handles subdir logic hopefully)
                formats: ['markdown', 'playwright', 'json'],
                includeScreenshots: true
            });

            this.analyzedCount++;
            console.log(`[Runner] Completed (${this.analyzedCount}): ${job.url} (${result.newlyDiscoveredCount} links)`);

            // --- QUEUE DISCOVERY ---
            if (job.depth < this.config.depth) {
                const resultsWithLinks = result.discoveredLinks || [];
                for (const discovery of resultsWithLinks) {
                    const link = discovery.url;
                    const path = discovery.path;
                    const normalizedLink = this.normalizeUrl(link);
                    // Check visited
                    if (!this.visitedUrls.has(normalizedLink)) {
                        try {
                            const linkHost = new URL(normalizedLink).hostname;
                            const baseHost = new URL(this.config.url).hostname;
                            if (linkHost === baseHost) {
                                this.visitedUrls.add(normalizedLink);
                                this.queue.push({
                                    url: normalizedLink,
                                    depth: job.depth + 1,
                                    sourceUrl: job.url,
                                    actionChain: result.actionChain, // Cumulative path
                                    functionalPath: path // Inherited breadcrumbs
                                });
                            }
                        } catch { /* ignore */ }
                    }
                }
            }
        } catch (e) {
            console.error(`[Runner] Worker failed on ${job.url}:`, e);
        }
        // [FIX] Don't close authenticatedPage - it's shared across all workers
        // Page will be cleaned up when context.close() is called in stop()
    }


    private loadHealthyVisitedUrls() {
        const initialDomain = new URL(this.config.url).hostname.replace(/\./g, '-');
        const jsonDir = path.join(this.outputDir, '..', 'json', initialDomain);

        if (fs.existsSync(jsonDir)) {
            const files = fs.readdirSync(jsonDir).filter(f => f.endsWith('.json'));
            console.log(`[Runner] Pre-scanning ${files.length} pages for cumulative health check...`);

            for (const file of files) {
                try {
                    const content = JSON.parse(fs.readFileSync(path.join(jsonDir, file), 'utf-8'));
                    const normalizedUrl = this.normalizeUrl(content.url);
                    const isHealthy = (content.metadata?.totalElements || 0) > 10;

                    if (isHealthy) {
                        this.visitedUrls.add(normalizedUrl);
                        console.log(`[Runner] Accumulated Healthy: ${normalizedUrl}`);
                    } else {
                        // Mark as NOT visited so we retry the zombie page
                        this.visitedUrls.delete(normalizedUrl);
                        console.log(`[Runner] Marked Zombie for Retry: ${normalizedUrl}`);
                    }
                } catch { /* ignore */ }
            }
        }
    }

    async stop() {
        if (!this.isRunning) return;
        this.isRunning = false;
        const duration = ((Date.now() - this.startTime) / 1000).toFixed(1);
        console.log(`[Runner] Finished. Analyzed ${this.analyzedCount} pages in ${duration}s.`);

        if (this.context) {
            const tracePath = path.join(this.outputDir, '..', `trace-${Date.now()}.zip`);
            await this.context.tracing.stop({ path: tracePath });
            console.log(`[Runner] Trace saved to ${tracePath}`);
            await this.context.close();
        }
        if (this.browser) await this.browser.close();
    }

    private normalizeUrl(url: string): string {
        try {
            const u = new URL(url);
            let p = u.pathname;
            // Alias /app and /app/ to /app/home
            if (p === '/app' || p === '/app/' || p === '/app/home') {
                u.pathname = '/app/home';
            }
            // Remove trailing slash for consistency (e.g. /app/users/ -> /app/users)
            if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
                u.pathname = u.pathname.slice(0, -1);
            }
            return u.toString();
        } catch {
            return url;
        }
    }
}
