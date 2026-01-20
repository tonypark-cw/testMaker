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
        previousPath: string[], // [FIX]
        outputDir: string,
        timestamp: string,
        capturedModalHashes: Set<string>,
        networkManager?: any // [NEW]
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
                        await UISettler.smartClick(page, button, actionChain, networkManager);
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
        previousPath: string[],
        networkManager?: any // [NEW]
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
                            await UISettler.smartClick(page, el, actionChain, networkManager);
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
<<<<<<< Updated upstream
=======
    }

    /**
     * Phase 8: Transaction Detail Discovery
     * Clicks on table rows to trigger detail API requests (WO, PO, etc.)
     */
    static async discoverTransactionDetails(
        page: Page,
        targetUrl: string,
        actionChain: ActionRecord[],
        networkManager?: any // [NEW]
    ): Promise<void> {
        console.log('[ActionExplorer] 🔍 Searching for tables to discover transaction details...');

        // Find visible tables
        const tables = await page.locator('table, .mantine-Table-root, [role="grid"]').all();

        for (const table of tables) {
            try {
                if (!(await table.isVisible())) continue;

                // Find rows (excluding header)
                // Support both standard tables and role-based grids
                const rows = await table.locator('tbody tr, [role="row"]:not([aria-rowindex="1"]), .mantine-Table-tbody tr').all();

                if (rows.length === 0) {
                    console.log('[ActionExplorer] ⚠️ No rows found in table.');
                    continue;
                }

                // Click first 3-5 rows to trigger API calls (captured by NetworkManager)
                const limit = Math.min(rows.length, 5);
                console.log(`[ActionExplorer] Found ${rows.length} rows, will attempt to click ${limit}.`);

                for (let i = 0; i < limit; i++) {
                    const row = rows[i];
                    try {
                        if (await row.isVisible()) {
                            console.log(`[ActionExplorer] 🖱️ Clicking row ${i + 1} to trigger transaction API...`);
                            await UISettler.smartClick(page, row, actionChain, networkManager);

                            // Wait for API response (stabilization)
                            await page.waitForTimeout(2000);

                            // If it navigated away, go back to continue discovery
                            if (page.url() !== targetUrl) {
                                console.log('[ActionExplorer] Navigated away after row click, returning...');
                                await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => { });
                            }
                        }
                    } catch (innerE) {
                        console.error(`[ActionExplorer] Failed to click row ${i + 1}:`, innerE);
                    }
                }
            } catch (e) {
                console.error('[ActionExplorer] Error during row discovery:', e);
            }
        }
>>>>>>> Stashed changes
    }
}
