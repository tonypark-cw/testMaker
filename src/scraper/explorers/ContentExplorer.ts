import { ActionRecord, ModalDiscovery } from '../../../types/index.js';
import { UISettler } from '../lib/UISettler.js';
import { CommandExecutor, ClickCommand } from '../commands/index.js';
import { TIMING } from '../config/constants.js';
import { NetworkManager } from '../../shared/network/NetworkManager.js';
import { BrowserPage } from '../adapters/BrowserPage.js';

/**
 * Context for content exploration.
 */
export interface ContentExplorationContext {
    page: BrowserPage;
    targetUrl: string;
    actionChain: ActionRecord[];
    networkManager?: NetworkManager;
    discoveredLinks: Array<{ url: string; path: string[] }>;
    modalDiscoveries: ModalDiscovery[];
    previousPath: string[];
    outputDir: string;
    timestamp: string;
    capturedModalHashes: Set<string>;
    clickedRowTexts: Set<string>;
}

export class ContentExplorer {
    /**
     * Phase 6: Table-based Row-Click Discovery
     * Clicks on table rows to find detail pages.
     */
    static async discoverDetailPages(ctx: ContentExplorationContext): Promise<void> {
        const { page, targetUrl, actionChain, networkManager, discoveredLinks, modalDiscoveries, previousPath, outputDir, timestamp, capturedModalHashes, clickedRowTexts } = ctx;

        const rows = await page.locator('table tr, .table-row, [role="row"]').all();
        const limit = 5; // Sample limit
        let clickedInThisPage = 0;

        const executor = new CommandExecutor(
            { page, actionChain, networkManager },
            { maxRetries: 1, retryDelayMs: 200 }
        );

        for (const row of rows) {
            if (clickedInThisPage >= limit) break;
            try {
                const text = (await row.innerText()).trim();
                const cleanText = text.split('\t')[0].split('\n')[0].trim().substring(0, 30);
                if (!cleanText || clickedRowTexts.has(cleanText)) continue;

                if (await row.isVisible()) {
                    clickedRowTexts.add(cleanText);

                    // Use ClickCommand
                    const command = new ClickCommand(row, { label: `Row: ${cleanText}` });
                    await executor.execute(command);

                    await page.waitForTimeout(TIMING.NAVIGATION_DELAY);

                    const newUrl = page.url();
                    if (newUrl !== targetUrl) {
                        discoveredLinks.push({ url: newUrl, path: [...previousPath, `Row: ${cleanText}`] });
                        await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => { });
                        await page.waitForTimeout(TIMING.NAVIGATION_DELAY);
                    } else {
                        const discovery = await UISettler.extractModalContent(page, `Row: ${cleanText}`, targetUrl, outputDir, timestamp, capturedModalHashes);
                        if (discovery) modalDiscoveries.push(discovery);
                    }

                    clickedInThisPage++;
                }
            } catch { /* ignore */ }
        }
    }

    /**
     * Phase 6.5: Pagination Discovery
     */
    static async handlePagination(
        ctx: Pick<ContentExplorationContext, 'page' | 'discoveredLinks' | 'actionChain' | 'networkManager' | 'previousPath'>
    ): Promise<void> {
        const { page, discoveredLinks, actionChain, networkManager, previousPath } = ctx;

        const nextButtons = await page.locator('button[aria-label*="next"], .pagination-next, button:has-text(">")').all();

        const executor = new CommandExecutor({ page, actionChain, networkManager });

        for (const btn of nextButtons) {
            try {
                if (await btn.isVisible() && await btn.isEnabled()) {
                    const command = new ClickCommand(btn, { label: 'Next Page' });
                    await executor.execute(command);

                    await page.waitForTimeout(TIMING.NAVIGATION_DELAY);
                    const newUrl = page.url();
                    discoveredLinks.push({ url: newUrl, path: [...previousPath, 'Next Page'] });
                    break; // Only click one "next" per analysis epoch
                }
            } catch { /* ignore */ }
        }
    }
}
