import { Page, Request } from 'playwright';
import { ActionRecord, ModalDiscovery } from '../../../../types/index.js';
import { UISettler } from '../UISettler.js';

export class ContentExplorer {
    /**
     * Phase 6: Table-based Row-Click Discovery
     * Clicks on table rows to find detail pages.
     */
    static async discoverDetailPages(
        page: Page,
        targetUrl: string,
        actionChain: ActionRecord[],
        discoveredLinks: Array<{ url: string; path: string[] }>,
        modalDiscoveries: ModalDiscovery[],
        previousPath: string[],
        outputDir: string,
        timestamp: string,
        capturedModalHashes: Set<string>,
        clickedRowTexts: Set<string>
    ): Promise<void> {
        const rows = await page.locator('table tr, .table-row, [role="row"]').all();
        const limit = 5; // Sample limit
        let clickedInThisPage = 0;

        for (const row of rows) {
            if (clickedInThisPage >= limit) break;
            try {
                const text = (await row.innerText()).trim();
                const cleanText = text.split('\t')[0].split('\n')[0].trim().substring(0, 30);
                if (!cleanText || clickedRowTexts.has(cleanText)) continue;

                if (await row.isVisible()) {
                    clickedRowTexts.add(cleanText);

                    // [NEW] Network Listener for SPA Transitions
                    let detectedUrl: string | null = null;
                    const networkListener = (req: Request) => {
                        const u = req.url();
                        if (u.includes('/api/v2/') && (u.includes('/detail') || u.match(/\/[0-9a-f-]{36}/))) {
                            // detectedUrl = u; (Wait, we need page URL)
                        }
                    };
                    page.on('request', networkListener);

                    await UISettler.smartClick(page, row, actionChain);
                    await page.waitForTimeout(2000);

                    const newUrl = page.url();
                    if (newUrl !== targetUrl) {
                        discoveredLinks.push({ url: newUrl, path: [...previousPath, `Row: ${cleanText}`] });
                        await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => { });
                    } else {
                        const discovery = await UISettler.extractModalContent(page, `Row: ${cleanText}`, targetUrl, outputDir, timestamp, capturedModalHashes);
                        if (discovery) modalDiscoveries.push(discovery);
                    }

                    page.off('request', networkListener);
                    clickedInThisPage++;
                }
            } catch { /* ignore */ }
        }
    }

    /**
     * Phase 6.5: Pagination Discovery
     */
    static async handlePagination(
        page: Page,
        discoveredLinks: Array<{ url: string; path: string[] }>,
        actionChain: ActionRecord[],
        previousPath: string[]
    ): Promise<void> {
        const nextButtons = await page.locator('button[aria-label*="next"], .pagination-next, button:has-text(">")').all();
        for (const btn of nextButtons) {
            try {
                if (await btn.isVisible() && await btn.isEnabled()) {
                    await UISettler.smartClick(page, btn, actionChain);
                    await page.waitForTimeout(1000);
                    const newUrl = page.url();
                    discoveredLinks.push({ url: newUrl, path: [...previousPath, 'Next Page'] });
                    break; // Only click one "next" per analysis epoch
                }
            } catch { /* ignore */ }
        }
    }
}
