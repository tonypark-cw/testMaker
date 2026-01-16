import { Page } from 'playwright';
import { ActionRecord, ModalDiscovery } from '../../../../types/index.js';
import { UISettler } from '../UISettler.js';

export class ActionExplorer {
    /**
     * Phase 7: Global Action Discovery
     * Clicks on common global actions like "Create", "Post", "Add".
     */
    static async discoverGlobalActions(
        page: Page,
        targetUrl: string,
        actionChain: ActionRecord[],
        discoveredLinks: Array<{ url: string; path: string[] }>,
        modalDiscoveries: ModalDiscovery[],
        previousPath: string[],
        outputDir: string,
        timestamp: string,
        capturedModalHashes: Set<string>
    ): Promise<void> {
        const actionLocators = [
            'button:has-text("create")',
            'button:has-text("add")',
            'button:has-text("post")',
            'button:has-text("upload")',
            'button:has-text("new")',
            '.btn-primary',
            '.btn-success',
            '.action-button'
        ];

        for (const selector of actionLocators) {
            const buttons = await page.locator(selector).all();
            for (const button of buttons) {
                try {
                    const text = (await button.innerText()).trim();
                    if (!text || text.length > 20) continue;

                    if (await button.isVisible() && await button.isEnabled()) {
                        await button.click({ timeout: 2000 });
                        await page.waitForTimeout(2000);

                        const newUrl = page.url();
                        if (newUrl !== targetUrl) {
                            discoveredLinks.push({ url: newUrl, path: [...previousPath, `Action: ${text}`] });
                            await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => { });
                        } else {
                            const discovery = await UISettler.extractModalContent(page, `Action: ${text}`, targetUrl, outputDir, timestamp, capturedModalHashes);
                            if (discovery) modalDiscoveries.push(discovery);
                        }
                    }
                } catch { /* ignore */ }
            }
        }
    }

    /**
     * Phase 5.5: View All triggers
     */
    static async handleViewAll(
        page: Page,
        targetUrl: string,
        discoveredLinks: Array<{ url: string; path: string[] }>,
        actionChain: ActionRecord[],
        previousPath: string[]
    ): Promise<void> {
        const viewAllLocators = [
            'a:has-text("view all")',
            'a:has-text("see all")',
            'button:has-text("view all")',
            '.view-all'
        ];

        for (const selector of viewAllLocators) {
            const elements = await page.locator(selector).all();
            for (const el of elements) {
                try {
                    if (await el.isVisible()) {
                        const href = await el.getAttribute('href');
                        if (href) {
                            discoveredLinks.push({ url: new URL(href, targetUrl).toString(), path: [...previousPath, 'View All'] });
                        } else {
                            await el.click({ timeout: 2000 });
                            await page.waitForTimeout(1000);
                            const newUrl = page.url();
                            if (newUrl !== targetUrl) {
                                discoveredLinks.push({ url: newUrl, path: [...previousPath, 'View All'] });
                                await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => { });
                            }
                        }
                    }
                } catch { /* ignore */ }
            }
        }
    }
}
