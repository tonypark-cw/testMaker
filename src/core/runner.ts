import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { Scraper } from './scraper.js';
import { Analyzer } from '../../scripts/analyzer.js';
import { Generator } from '../../scripts/generator.js';
import { AnalysisResult } from '../../types/index.js';
import { ScrapeJob, ScraperConfig } from './types.js';

export class Runner {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private queue: ScrapeJob[] = [];
    private visitedUrls = new Set<string>();
    private activeWorkers = 0;
    private isRunning = false;

    // Components
    private analyzer = new Analyzer();
    private generator = new Generator();

    // Stats
    private analyzedCount = 0;
    private startTime = 0;

    constructor(private config: ScraperConfig, private outputDir: string, private concurrency: number = 3) { }

    async start() {
        console.log(`[Runner] Starting Multi-Tab Scraper (Concurrency: ${this.concurrency})...`);
        this.startTime = Date.now();
        this.isRunning = true;

        if (!fs.existsSync(this.outputDir)) fs.mkdirSync(this.outputDir, { recursive: true });

        // 1. Launch & Auth
        this.browser = await chromium.launch({ headless: this.config.headless });
        this.context = await this.browser.newContext({ viewport: { width: 1920, height: 1080 } });

        // Start Tracing
        await this.context.tracing.start({ screenshots: true, snapshots: true, sources: true });

        // Login (Single Session)
        const page = await this.context.newPage();
        await this.performLogin(page);

        // Initial Job
        this.queue.push({ url: this.config.url, depth: 0 });
        this.visitedUrls.add(this.config.url);

        // 2. Start Worker Loop
        await this.processQueue();

        // 3. Cleanup
        await this.stop();
    }

    private async performLogin(page: Page) {
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

                    // Fill credentials
                    await emailLocator.fill(this.config.username);
                    await passwordLocator.fill(this.config.password);

                    // Click submit button
                    const submitBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("Log in"), button:has-text("Sign in"), button:has-text("로그인")').first();
                    if (await submitBtn.isVisible().catch(() => false)) {
                        await submitBtn.click();
                        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
                        await page.waitForTimeout(3000);

                        // Check login success - should be redirected away from login page
                        const currentUrl = page.url();
                        console.log(`[Runner] Post-login URL: ${currentUrl}`);

                        // Force navigation to /app/home if stuck on transition page
                        if (currentUrl.includes('/app/logged-in') || currentUrl.endsWith('/app') || currentUrl.endsWith('/app/')) {
                            console.log('[Runner] Detected transition page, forcing navigation to /app/home...');
                            await page.goto(new URL('/app/home', this.config.url).toString(), { waitUntil: 'networkidle', timeout: 30000 }).catch(() => { });
                            await page.waitForTimeout(2000);
                            console.log(`[Runner] Now at: ${page.url()}`);
                        }

                        // Verify we're logged in (not on login page anymore)
                        const stillOnLogin = await passwordLocator.isVisible().catch(() => false);
                        if (stillOnLogin) {
                            console.log('[Runner] WARNING: Still on login page. Login may have failed.');
                        } else {
                            console.log('[Runner] Login successful!');
                        }
                    } else {
                        console.log('[Runner] Submit button not found.');
                    }
                } else if (!this.config.headless) {
                    console.log('[Runner] No credentials provided. Waiting for manual login...');
                    await page.pause();
                } else {
                    console.log('[Runner] No credentials provided and running headless. Skipping login.');
                }
            } else {
                console.log('[Runner] No login form detected, proceeding...');
            }
        } catch (e) {
            console.log(`[Runner] Login error: ${(e as Error).message}`);
        }
        await page.waitForTimeout(1000);
        await page.close();
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
        if (!this.context) return;

        const page = await this.context.newPage();
        try {
            console.log(`[Runner] Worker started for: ${job.url}`);
            const result = await Scraper.processPage(page, job.url, this.config, this.outputDir);

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
                    byType: stats as any,
                    domain: new URL(job.url).hostname,
                    bySection: { 0: result.elements.length }
                }
            };

            // --- GENERATE ---
            // Determine output folder based on domain
            const urlParsed = new URL(job.url);
            const pageDomain = urlParsed.hostname.replace(/\./g, '-');
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
                for (const link of result.links) {
                    // Check visited
                    if (!this.visitedUrls.has(link)) {
                        try {
                            const linkHost = new URL(link).hostname;
                            const baseHost = new URL(this.config.url).hostname;
                            if (linkHost === baseHost) {
                                this.visitedUrls.add(link);
                                this.queue.push({ url: link, depth: job.depth + 1, sourceUrl: job.url });
                            }
                        } catch (e) { }
                    }
                }
            }
        } catch (e) {
            console.error(`[Runner] Worker failed on ${job.url}:`, e);
        } finally {
            await page.close();
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
}
