/**
 * BatchRunner
 *
 * Runs regression tests across multiple pages.
 * Compares current state against registered baselines.
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { BaselineManager } from './BaselineManager.js';
import { VisualComparator } from './VisualComparator.js';
import { ContentComparator } from './ContentComparator.js';
import { ContentExtractor } from './ContentExtractor.js';
import { AnomalyDetector } from './AnomalyDetector.js';
import { AuthHandler } from './AuthHandler.js';
import * as fs from 'fs';

export interface PageTestResult {
    url: string;
    status: 'PASS' | 'FAIL' | 'ERROR' | 'SKIP';
    visual?: {
        diffPercentage: number;
        status: 'PASS' | 'FAIL';
        diffImagePath?: string;
    };
    content?: {
        score: number;
        changes: {
            buttonsAdded: string[];
            buttonsRemoved: string[];
            inputsAdded: number;
            inputsRemoved: number;
            tablesAdded: number;
            tablesRemoved: number;
        };
    };
    anomaly?: {
        severity: string;
        score: number;
        issues: string[];
    };
    error?: string;
    duration: number;
}

export interface BatchResult {
    urlPrefix: string;
    timestamp: string;
    totalPages: number;
    passed: number;
    failed: number;
    errors: number;
    skipped: number;
    duration: number;
    pages: PageTestResult[];
}

export interface BatchRunnerOptions {
    headless?: boolean;
    threshold?: number;
    outputDir?: string;
    concurrency?: number;
    timeout?: number;
    visualOnly?: boolean;
    contentOnly?: boolean;
    // Authentication options
    auth?: {
        username?: string;
        password?: string;
    };
}

export class BatchRunner {
    private baselineManager: BaselineManager;
    private visualComparator: VisualComparator;
    private contentComparator: ContentComparator;
    private contentExtractor: ContentExtractor;
    private anomalyDetector: AnomalyDetector;
    private options: Omit<Required<BatchRunnerOptions>, 'auth'> & Pick<BatchRunnerOptions, 'auth'>;

    constructor(options: BatchRunnerOptions = {}) {
        this.options = {
            headless: options.headless ?? true,
            threshold: options.threshold ?? 0.1,
            outputDir: options.outputDir ?? './output',
            concurrency: options.concurrency ?? 1,
            timeout: options.timeout ?? 60000,
            visualOnly: options.visualOnly ?? false,
            contentOnly: options.contentOnly ?? false,
            auth: options.auth
        };

        this.baselineManager = new BaselineManager(this.options.outputDir);
        this.visualComparator = new VisualComparator(this.options.threshold, this.options.outputDir);
        this.contentComparator = new ContentComparator();
        this.contentExtractor = new ContentExtractor();
        this.anomalyDetector = new AnomalyDetector();
    }

    /**
     * Run regression tests for all pages under a URL prefix
     */
    async run(urlPrefix: string, onProgress?: (current: number, total: number, url: string) => void): Promise<BatchResult> {
        const startTime = Date.now();
        const urlObj = new URL(urlPrefix);
        const domain = urlObj.hostname;

        // Get all testable URLs
        const baselines = this.baselineManager.listBaselines(domain);
        const urls = baselines
            .filter(b => b.url.startsWith(urlPrefix))
            .map(b => b.url);

        const result: BatchResult = {
            urlPrefix,
            timestamp: new Date().toISOString(),
            totalPages: urls.length,
            passed: 0,
            failed: 0,
            errors: 0,
            skipped: 0,
            duration: 0,
            pages: []
        };

        if (urls.length === 0) {
            result.duration = Date.now() - startTime;
            return result;
        }

        // Initialize authentication if configured
        let authHandler: AuthHandler | null = null;
        let context: BrowserContext | null = null;
        let tokens = { accessToken: '', refreshToken: '' };
        let browser: Browser | null = null;

        if (this.options.auth?.username && this.options.auth?.password) {
            authHandler = new AuthHandler({
                url: urlPrefix,
                username: this.options.auth.username,
                password: this.options.auth.password,
                outputDir: this.options.outputDir,
                headless: this.options.headless
            });

            const authResult = await authHandler.initialize();
            if (authResult.success) {
                console.log('[BatchRunner] ✅ Authenticated');
                context = authResult.context;
                tokens = authResult.tokens;
            } else {
                console.log('[BatchRunner] ⚠️ Auth failed, running without authentication');
            }
        } else {
            // Try to load existing session
            authHandler = new AuthHandler({
                url: urlPrefix,
                outputDir: this.options.outputDir,
                headless: this.options.headless
            });

            const authResult = await authHandler.initialize();
            if (authResult.success) {
                console.log('[BatchRunner] ✅ Session restored');
                context = authResult.context;
                tokens = authResult.tokens;
            }
        }

        // Fallback to unauthenticated browser if no context
        if (!context) {
            browser = await chromium.launch({ headless: this.options.headless });
            context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
        }

        try {
            for (let i = 0; i < urls.length; i++) {
                const url = urls[i];

                if (onProgress) {
                    onProgress(i + 1, urls.length, url);
                }

                const pageResult = await this.testPage(context, url, tokens);
                result.pages.push(pageResult);

                switch (pageResult.status) {
                    case 'PASS':
                        result.passed++;
                        break;
                    case 'FAIL':
                        result.failed++;
                        break;
                    case 'ERROR':
                        result.errors++;
                        break;
                    case 'SKIP':
                        result.skipped++;
                        break;
                }
            }
        } finally {
            if (authHandler) {
                await authHandler.close();
            }
            if (browser) {
                await browser.close();
            }
        }

        result.duration = Date.now() - startTime;
        return result;
    }

    /**
     * Test a single page
     */
    private async testPage(
        context: BrowserContext,
        url: string,
        tokens: { accessToken: string; refreshToken: string }
    ): Promise<PageTestResult> {
        const startTime = Date.now();
        const result: PageTestResult = {
            url,
            status: 'PASS',
            duration: 0
        };

        // Find baseline
        const baseline = this.baselineManager.findBaseline(url);
        if (!baseline) {
            result.status = 'SKIP';
            result.error = 'No baseline found';
            result.duration = Date.now() - startTime;
            return result;
        }

        let page: Page | null = null;

        try {
            // Create page with token injection
            page = await context.newPage();

            // Inject tokens before navigation
            if (tokens.accessToken) {
                await page.addInitScript((t) => {
                    localStorage.setItem('accessToken', t.accessToken);
                    localStorage.setItem('refreshToken', t.refreshToken);
                    sessionStorage.setItem('accessToken', t.accessToken);
                    sessionStorage.setItem('refreshToken', t.refreshToken);
                }, tokens);
            }

            await page.goto(url, { waitUntil: 'networkidle', timeout: this.options.timeout });

            const runVisual = !this.options.contentOnly;
            const runContent = !this.options.visualOnly;

            // Visual comparison
            if (runVisual) {
                const currentScreenshot = `/tmp/batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.png`;
                await page.screenshot({ path: currentScreenshot, fullPage: true, type: 'png' });

                try {
                    const visualDiff = await this.visualComparator.compare(
                        baseline.screenshotPath,
                        currentScreenshot,
                        url
                    );

                    result.visual = {
                        diffPercentage: visualDiff.diffPercentage,
                        status: visualDiff.status,
                        diffImagePath: visualDiff.diffImagePath
                    };

                    if (visualDiff.status === 'FAIL') {
                        result.status = 'FAIL';
                    }
                } finally {
                    if (fs.existsSync(currentScreenshot)) {
                        fs.unlinkSync(currentScreenshot);
                    }
                }
            }

            // Content comparison
            if (runContent) {
                const baselineContent = this.baselineManager.loadBaselineContent(url);

                if (baselineContent) {
                    const currentContent = await this.contentExtractor.extract(page);
                    const contentDiff = this.contentComparator.compare(baselineContent, currentContent);
                    const anomalyReport = this.anomalyDetector.detect(contentDiff);

                    result.content = {
                        score: contentDiff.score,
                        changes: {
                            buttonsAdded: contentDiff.buttons.added,
                            buttonsRemoved: contentDiff.buttons.removed,
                            inputsAdded: contentDiff.inputs.added.length,
                            inputsRemoved: contentDiff.inputs.removed.length,
                            tablesAdded: contentDiff.tables.added.length,
                            tablesRemoved: contentDiff.tables.removed.length
                        }
                    };

                    result.anomaly = {
                        severity: anomalyReport.severity,
                        score: anomalyReport.score,
                        issues: anomalyReport.issues.map(i => i.description)
                    };

                    // Determine pass/fail based on content
                    if (contentDiff.score < 80) {
                        result.status = 'FAIL';
                    }

                    if (anomalyReport.severity === 'CRITICAL') {
                        result.status = 'FAIL';
                    }
                }
            }
        } catch (err) {
            result.status = 'ERROR';
            result.error = String(err);
        } finally {
            if (page) {
                await page.close();
            }
        }

        result.duration = Date.now() - startTime;
        return result;
    }

    /**
     * Generate summary report
     */
    generateReport(result: BatchResult): string {
        const lines: string[] = [];

        lines.push('═══════════════════════════════════════════════════════════════');
        lines.push('📊 BATCH REGRESSION TEST REPORT');
        lines.push('═══════════════════════════════════════════════════════════════');
        lines.push('');
        lines.push(`URL Prefix: ${result.urlPrefix}`);
        lines.push(`Timestamp:  ${result.timestamp}`);
        lines.push(`Duration:   ${(result.duration / 1000).toFixed(1)}s`);
        lines.push('');
        lines.push('───────────────────────────────────────────────────────────────');
        lines.push('SUMMARY');
        lines.push('───────────────────────────────────────────────────────────────');
        lines.push(`Total Pages: ${result.totalPages}`);
        lines.push(`✅ Passed:   ${result.passed}`);
        lines.push(`❌ Failed:   ${result.failed}`);
        lines.push(`⚠️  Errors:   ${result.errors}`);
        lines.push(`⏭️  Skipped:  ${result.skipped}`);
        lines.push('');

        // Failed pages detail
        const failed = result.pages.filter(p => p.status === 'FAIL');
        if (failed.length > 0) {
            lines.push('───────────────────────────────────────────────────────────────');
            lines.push('FAILED PAGES');
            lines.push('───────────────────────────────────────────────────────────────');

            for (const page of failed) {
                lines.push('');
                lines.push(`❌ ${page.url}`);

                if (page.visual && page.visual.status === 'FAIL') {
                    lines.push(`   Visual: ${page.visual.diffPercentage.toFixed(2)}% diff`);
                    if (page.visual.diffImagePath) {
                        lines.push(`   Diff:   ${page.visual.diffImagePath}`);
                    }
                }

                if (page.content && page.content.score < 80) {
                    lines.push(`   Content: ${page.content.score}% similarity`);
                    if (page.content.changes.buttonsRemoved.length > 0) {
                        lines.push(`   Buttons removed: ${page.content.changes.buttonsRemoved.join(', ')}`);
                    }
                }

                if (page.anomaly && page.anomaly.severity === 'CRITICAL') {
                    lines.push(`   Anomaly: ${page.anomaly.severity} (score: ${page.anomaly.score})`);
                    for (const issue of page.anomaly.issues) {
                        lines.push(`   - ${issue}`);
                    }
                }
            }
        }

        // Error pages detail
        const errors = result.pages.filter(p => p.status === 'ERROR');
        if (errors.length > 0) {
            lines.push('');
            lines.push('───────────────────────────────────────────────────────────────');
            lines.push('ERROR PAGES');
            lines.push('───────────────────────────────────────────────────────────────');

            for (const page of errors) {
                lines.push(`⚠️  ${page.url}`);
                lines.push(`   Error: ${page.error}`);
            }
        }

        lines.push('');
        lines.push('═══════════════════════════════════════════════════════════════');

        const passRate = result.totalPages > 0
            ? ((result.passed / result.totalPages) * 100).toFixed(1)
            : '0';

        const overallStatus = result.failed === 0 && result.errors === 0 ? '✅ PASS' : '❌ FAIL';
        lines.push(`${overallStatus} | Pass Rate: ${passRate}% (${result.passed}/${result.totalPages})`);
        lines.push('═══════════════════════════════════════════════════════════════');

        return lines.join('\n');
    }
}
