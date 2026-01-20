import * as fs from 'fs';
import * as path from 'path';
import { BaselineData, BaselineIndex } from './types.js';

export class BaselineManager {
    private baselinesDir: string;

    constructor(outputDir: string = './output') {
        this.baselinesDir = path.join(outputDir, 'baselines');
        if (!fs.existsSync(this.baselinesDir)) {
            fs.mkdirSync(this.baselinesDir, { recursive: true });
        }
    }

    /**
     * Find baseline for a given URL
     */
    findBaseline(url: string): BaselineData | null {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;
        const domainDir = path.join(this.baselinesDir, domain);

        if (!fs.existsSync(domainDir)) return null;

        const indexPath = path.join(domainDir, 'index.json');
        if (!fs.existsSync(indexPath)) return null;

        const index: BaselineIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        const baseline = index.pages[url];

        return baseline || null;
    }

    /**
   * Save new baseline
   */
    saveBaseline(url: string, screenshotPath: string, metadata: any, content?: any): BaselineData {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;
        const domainDir = path.join(this.baselinesDir, domain);
        const pagesDir = path.join(domainDir, 'pages');

        if (!fs.existsSync(pagesDir)) {
            fs.mkdirSync(pagesDir, { recursive: true });
        }

        // Create page-specific directory
        const pageName = this.getPageName(url);
        const pageDir = path.join(pagesDir, pageName);
        if (!fs.existsSync(pageDir)) {
            fs.mkdirSync(pageDir, { recursive: true });
        }

        // Copy screenshot to baseline
        const goldenPath = path.join(pageDir, 'golden.webp');
        fs.copyFileSync(screenshotPath, goldenPath);

        // Save metadata
        const metadataPath = path.join(pageDir, 'metadata.json');
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

        // Save content if provided
        if (content) {
            const contentPath = path.join(pageDir, 'content.json');
            fs.writeFileSync(contentPath, JSON.stringify(content, null, 2));
        }

        // Update index
        this.updateIndex(domain, url, goldenPath, metadata);

        return {
            url,
            domain,
            screenshotPath: goldenPath,
            screenshotHash: metadata.hash || '',
            metadata,
            isGolden: true
        };
    }

    /**
     * Load baseline content for a URL
     */
    loadBaselineContent(url: string): any | null {
        const baseline = this.findBaseline(url);
        if (!baseline) return null;

        const contentPath = baseline.screenshotPath.replace('golden.webp', 'content.json');
        if (!fs.existsSync(contentPath)) return null;

        return JSON.parse(fs.readFileSync(contentPath, 'utf-8'));
    }

    /**
     * List all baselines for a domain
     */
    listBaselines(domain: string): BaselineData[] {
        const indexPath = path.join(this.baselinesDir, domain, 'index.json');
        if (!fs.existsSync(indexPath)) return [];

        const index: BaselineIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        return Object.values(index.pages);
    }

    private getPageName(url: string): string {
        const urlObj = new URL(url);
        return urlObj.pathname.replace(/\//g, '-').replace(/^-|-$/g, '') || 'index';
    }

    private updateIndex(domain: string, url: string, screenshotPath: string, metadata: any) {
        const domainDir = path.join(this.baselinesDir, domain);
        if (!fs.existsSync(domainDir)) {
            fs.mkdirSync(domainDir, { recursive: true });
        }

        const indexPath = path.join(domainDir, 'index.json');
        let index: BaselineIndex = { domain, pages: {} };

        if (fs.existsSync(indexPath)) {
            index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        }

        index.pages[url] = {
            url,
            domain,
            screenshotPath,
            screenshotHash: metadata.hash || '',
            metadata,
            isGolden: true
        };

        fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
    }
}
