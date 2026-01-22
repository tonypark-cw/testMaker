
import * as fs from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';

interface ActionStep {
    type: 'click' | 'nav' | 'input';
    selector: string;
    label: string;
    timestamp: string;
    url: string;
}

interface PageMetadata {
    url: string;
    timestamp: string;
    hash: string;
    actionChain?: ActionStep[];
}

export class GoldenGenerator {
    // [CLEANUP] Data folder removed as per user request
    // private tagsPath = path.join(process.cwd(), 'data/qa-tags.json');
    private tagsPath = '';
    private outputBase = path.join(process.cwd(), 'output/screenshots');
    private testsOutputDir = path.join(process.cwd(), 'tests/golden_paths');

    constructor() {
        if (!fs.existsSync(this.testsOutputDir)) {
            fs.mkdirSync(this.testsOutputDir, { recursive: true });
        }
    }

    async generate() {
        console.log('[GoldenGenerator] Starting Golden Path Generation...');

        if (!fs.existsSync(this.tagsPath)) {
            console.error(`[GoldenGenerator] Tags file not found: ${this.tagsPath}`);
            return;
        }

        const tags = JSON.parse(fs.readFileSync(this.tagsPath, 'utf-8'));
        const passItems = Object.entries(tags).filter(([_, status]) => status === 'PASS');

        console.log(`[GoldenGenerator] Found ${passItems.length} PASS items.`);

        for (const [key, _] of passItems) {
            await this.processItem(key);
        }
    }

    private async processItem(screenshotRelPath: string) {
        // key format: "/output/screenshots/domain-com/filename.webp"
        // Target json: "output/screenshots/json/domain-com/filename.json"

        try {
            const parts = screenshotRelPath.split('/');
            const filename = parts.pop();
            const screenshotDomainDir = parts.pop(); // e.g., 'stage-ianai-co'

            if (!filename || !screenshotDomainDir) return;

            // Heuristic: Convert dash-based directory back to dot-based if needed, 
            // or search for the matching directory in json/ output.
            // Scraper saves JSON in `hostname` dir (with dots usually).
            const jsonBaseDir = path.join(this.outputBase, 'json');
            const availableDirs = fs.readdirSync(jsonBaseDir);
            console.log(`[DEBUG] JSON Base Dir: ${jsonBaseDir}`);
            console.log(`[DEBUG] Available Dirs: ${availableDirs.join(', ')}`);
            console.log(`[DEBUG] Target Domain (Screenshot): ${screenshotDomainDir}`);

            // Find a directory that fuzzy matches the screenshot directory
            const matchedDir = availableDirs.find(d => d.replace(/\./g, '-') === screenshotDomainDir) || screenshotDomainDir;
            console.log(`[DEBUG] Matched Dir: ${matchedDir}`);

            // Scraper also prefixes the json filename with the domain: "domain.com-filename.json"
            const jsonFilename = `${matchedDir}-${filename.replace(/\.webp$/, '.json')}`;
            const jsonPath = path.join(jsonBaseDir, matchedDir, jsonFilename);

            if (!fs.existsSync(jsonPath)) {
                console.log(`[GoldenGenerator] Metadata not found for ${screenshotRelPath} (Expected: ${jsonPath})`);
                return;
            }

            const metadata: PageMetadata = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

            if (!metadata.actionChain || metadata.actionChain.length === 0) {
                console.log(`[GoldenGenerator] No action chain recorded for ${screenshotRelPath}`);
                return;
            }

            this.createTestFile(metadata, matchedDir, jsonFilename.replace('.json', ''));

        } catch (e) {
            console.error(`[GoldenGenerator] Error processing ${screenshotRelPath}:`, e);
        }
    }

    private createTestFile(metadata: PageMetadata, domain: string, id: string) {
        const chain = metadata.actionChain!;
        const testName = `Golden Path: ${metadata.url}`;
        const cleanId = id.replace(/[^a-zA-Z0-9]/g, '_');
        const filename = path.join(this.testsOutputDir, `${domain}_${cleanId}.spec.ts`);

        // Simple synthesis logic
        const steps = chain.map(step => {
            let selector = step.selector || 'body';
            // Basic heuristic to improve selector quality if it's just a class
            if (selector === 'unknown' || (selector.split(' ').length > 2 && !selector.includes('#'))) {
                selector = `text="${step.label}"`;
            } else if (!selector.startsWith('#') && !selector.startsWith('[') && !selector.includes('=')) {
                selector = `.${selector.replace(/ /g, '.')}`;
            }

            if (step.type === 'click') {
                return `    // Click ${step.label}\n    await page.locator('${selector}').first().click();`;
            } else if (step.type === 'nav') {
                return `    // Navigate\n    await page.goto('${step.url}');`;
            } else if (step.type === 'input') {
                return `    // Input ${step.label}\n    await page.locator('${selector}').fill('SAMPLE');`;
            }
            return '';
        }).join('\n\n');

        const content = `
import { test, expect } from '@playwright/test';

test('${testName}', async ({ page }) => {
    // Generated by Curation Agent
    // Source: ${metadata.url}
    // Timestamp: ${metadata.timestamp}

${steps}

    // Validation
    await expect(page).toHaveURL('${metadata.url}');
    await expect(page).toHaveScreenshot('${id}.png');
});
        `;

        fs.writeFileSync(filename, content);
        console.log(`[GoldenGenerator] Generated test: ${filename}`);
    }
}

// CLI entry point
import { fileURLToPath } from 'url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    (async () => {
        const generator = new GoldenGenerator();
        await generator.generate();
    })();
}
