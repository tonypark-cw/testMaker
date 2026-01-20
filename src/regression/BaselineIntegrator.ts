/**
 * BaselineIntegrator
 *
 * Connects crawler output (screenshots + JSON) with regression testing system.
 * Registers crawled pages as baselines for future regression tests.
 */

import * as fs from 'fs';
import * as path from 'path';
import { BaselineManager } from './BaselineManager.js';
import { ContentExtractor, PageContent } from './ContentExtractor.js';

export interface CrawlerPageData {
    url: string;
    timestamp: string;
    pageTitle: string;
    elements: Array<{
        id: string;
        tag: string;
        type: string;
        label: string;
        state: {
            visible: boolean;
            enabled: boolean;
            required: boolean;
        };
        attributes: {
            href?: string;
            placeholder?: string;
            value?: string;
        };
    }>;
}

export interface IntegrationResult {
    totalPages: number;
    registered: number;
    skipped: number;
    errors: string[];
    pages: Array<{
        url: string;
        status: 'registered' | 'skipped' | 'error';
        reason?: string;
    }>;
}

export class BaselineIntegrator {
    private baselineManager: BaselineManager;
    private outputDir: string;

    constructor(outputDir: string = './output') {
        this.outputDir = outputDir;
        this.baselineManager = new BaselineManager(outputDir);
    }

    /**
     * Find all crawler output directories
     */
    findCrawlerOutputDirs(): string[] {
        const screenshotsBase = path.join(this.outputDir, 'stage', 'screenshots');
        if (!fs.existsSync(screenshotsBase)) {
            return [];
        }

        const entries = fs.readdirSync(screenshotsBase, { withFileTypes: true });
        return entries
            .filter(e => e.isDirectory() && !['json', 'markdown', 'playwright'].includes(e.name))
            .map(e => e.name);
    }

    /**
     * Load crawler JSON data for a domain
     */
    loadCrawlerData(domain: string): CrawlerPageData[] {
        const jsonDir = path.join(this.outputDir, 'stage', 'screenshots', 'json', domain);
        if (!fs.existsSync(jsonDir)) {
            return [];
        }

        const files = fs.readdirSync(jsonDir).filter(f => f.endsWith('.json'));
        const pages: CrawlerPageData[] = [];

        for (const file of files) {
            try {
                const content = fs.readFileSync(path.join(jsonDir, file), 'utf-8');
                const data = JSON.parse(content);
                if (data.url && data.success !== false) {
                    pages.push(data);
                }
            } catch (err) {
                // Skip invalid JSON files
            }
        }

        return pages;
    }

    /**
     * Find screenshot for a given URL
     */
    findScreenshotForUrl(url: string, domain: string): string | null {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;

        // Convert pathname to filename pattern
        const pageName = pathname.replace(/\//g, '-').replace(/^-/, '') || 'index';

        // Domain in screenshot dir uses dashes
        const domainDashed = domain.replace(/\./g, '-');
        const screenshotDir = path.join(this.outputDir, 'stage', 'screenshots', domainDashed);

        if (!fs.existsSync(screenshotDir)) {
            return null;
        }

        const files = fs.readdirSync(screenshotDir);

        // Find matching screenshot (exact match or with timestamp suffix)
        const pattern = new RegExp(`^${pageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(_\\d|$)`);
        const matches = files.filter(f => f.endsWith('.webp') && pattern.test(f));

        if (matches.length === 0) {
            return null;
        }

        // Return most recent
        matches.sort((a, b) => {
            const statA = fs.statSync(path.join(screenshotDir, a));
            const statB = fs.statSync(path.join(screenshotDir, b));
            return statB.mtime.getTime() - statA.mtime.getTime();
        });

        return path.join(screenshotDir, matches[0]);
    }

    /**
     * Convert crawler elements to PageContent format
     */
    convertToPageContent(data: CrawlerPageData): PageContent {
        const buttons: string[] = [];
        const inputs: Array<{ label: string; type: string; placeholder?: string; required?: boolean }> = [];
        const links: string[] = [];

        for (const el of data.elements) {
            if (el.type === 'button' && el.label) {
                buttons.push(el.label);
            } else if (el.type === 'input' || el.type === 'select' || el.type === 'textarea') {
                inputs.push({
                    label: el.label || el.attributes.placeholder || '',
                    type: el.type,
                    placeholder: el.attributes.placeholder,
                    required: el.state.required
                });
            } else if (el.type === 'link' && el.label) {
                links.push(el.label);
            }
        }

        return {
            url: data.url,
            pageTitle: data.pageTitle,
            headings: { h1: [], h2: [], h3: [] }, // Not available in crawler data
            tables: [], // Would need to extract from page
            buttons,
            inputs,
            links
        };
    }

    /**
     * Register all crawler output as baselines for a specific URL prefix
     */
    async registerBaselines(urlPrefix?: string): Promise<IntegrationResult> {
        const result: IntegrationResult = {
            totalPages: 0,
            registered: 0,
            skipped: 0,
            errors: [],
            pages: []
        };

        const domains = this.findCrawlerOutputDirs();

        for (const domainDashed of domains) {
            const domain = domainDashed.replace(/-/g, '.');
            const pages = this.loadCrawlerData(domain);

            for (const pageData of pages) {
                result.totalPages++;

                // Filter by URL prefix if specified
                if (urlPrefix && !pageData.url.startsWith(urlPrefix)) {
                    result.skipped++;
                    result.pages.push({
                        url: pageData.url,
                        status: 'skipped',
                        reason: 'URL prefix mismatch'
                    });
                    continue;
                }

                // Find screenshot
                const screenshot = this.findScreenshotForUrl(pageData.url, domain);
                if (!screenshot) {
                    result.skipped++;
                    result.pages.push({
                        url: pageData.url,
                        status: 'skipped',
                        reason: 'No screenshot found'
                    });
                    continue;
                }

                try {
                    // Convert to PageContent
                    const content = this.convertToPageContent(pageData);

                    // Create metadata
                    const metadata = {
                        timestamp: pageData.timestamp,
                        pageTitle: pageData.pageTitle,
                        elementCount: pageData.elements.length,
                        hash: '' // Will be computed if needed
                    };

                    // Save as baseline
                    this.baselineManager.saveBaseline(
                        pageData.url,
                        screenshot,
                        metadata,
                        content
                    );

                    result.registered++;
                    result.pages.push({
                        url: pageData.url,
                        status: 'registered'
                    });
                } catch (err) {
                    result.errors.push(`${pageData.url}: ${err}`);
                    result.pages.push({
                        url: pageData.url,
                        status: 'error',
                        reason: String(err)
                    });
                }
            }
        }

        return result;
    }

    /**
     * List all registered baselines for a URL prefix
     */
    listBaselinesForPrefix(urlPrefix: string): Array<{ url: string; timestamp: string }> {
        const urlObj = new URL(urlPrefix);
        const domain = urlObj.hostname;

        const baselines = this.baselineManager.listBaselines(domain);

        return baselines
            .filter(b => b.url.startsWith(urlPrefix))
            .map(b => ({
                url: b.url,
                timestamp: b.metadata.timestamp
            }));
    }

    /**
     * Get all URLs that should be tested for a given prefix
     */
    getTestableUrls(urlPrefix: string): string[] {
        const urlObj = new URL(urlPrefix);
        const domain = urlObj.hostname;

        const baselines = this.baselineManager.listBaselines(domain);

        return baselines
            .filter(b => b.url.startsWith(urlPrefix))
            .map(b => b.url);
    }
}
