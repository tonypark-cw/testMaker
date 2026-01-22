import { ActionRecord, ModalDiscovery } from '../../types/index.js';
import { UISettler } from '../lib/UISettler.js';
import { CommandExecutor, ClickCommand } from '../commands/index.js';
import { TIMING, LIMITS } from '../config/constants.js';
import { NetworkManager } from '../../shared/network/NetworkManager.js';
import { BrowserPage } from '../adapters/BrowserPage.js';

/**
 * Context for action exploration.
 */
export interface ActionExplorationContext {
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
}

export class ActionExplorer {
    /**
     * Phase 7: Global Action Discovery
     * Clicks on common global actions like "Create", "Post", "Add".
     */
    static async discoverGlobalActions(ctx: ActionExplorationContext): Promise<void> {
        const { page, targetUrl, actionChain, networkManager, discoveredLinks, modalDiscoveries, previousPath, outputDir, timestamp, capturedModalHashes } = ctx;

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

        const executor = new CommandExecutor(
            { page, actionChain, networkManager },
            { maxRetries: 1, retryDelayMs: 300 }
        );

        for (const selector of actionLocators) {
            const buttons = await page.locator(selector).all();
            for (const button of buttons) {
                try {
                    const text = (await button.innerText()).trim();
                    if (!text || text.length > 20) continue;

                    if (await button.isVisible() && await button.isEnabled()) {
                        const command = new ClickCommand(button, { label: `Action: ${text}` });
                        await executor.execute(command);

                        await page.waitForTimeout(TIMING.NAVIGATION_DELAY);

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
    static async handleViewAll(ctx: ActionExplorationContext): Promise<void> {
        const { page, targetUrl, actionChain, networkManager, discoveredLinks, previousPath } = ctx;

        const viewAllLocators = [
            'a:has-text("view all")',
            'a:has-text("see all")',
            'button:has-text("view all")',
            '.view-all'
        ];

        const executor = new CommandExecutor(
            { page, actionChain, networkManager },
            { maxRetries: 1, retryDelayMs: 300 }
        );

        for (const selector of viewAllLocators) {
            const elements = await page.locator(selector).all();
            for (const el of elements) {
                try {
                    if (await el.isVisible()) {
                        const href = await el.getAttribute('href');
                        if (href) {
                            discoveredLinks.push({ url: new URL(href, targetUrl).toString(), path: [...previousPath, 'View All'] });
                        } else {
                            const command = new ClickCommand(el, { label: 'View All' });
                            await executor.execute(command);

                            await page.waitForTimeout(TIMING.NAVIGATION_DELAY);
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

    /**
     * Phase 8: Transaction Detail Discovery
     * Clicks on table rows to trigger detail API requests (WO, PO, etc.)
     */
    static async discoverTransactionDetails(
        ctx: Pick<ActionExplorationContext, 'page' | 'targetUrl' | 'actionChain' | 'networkManager'>
    ): Promise<void> {
        const { page, targetUrl, actionChain, networkManager } = ctx;
        console.log('[ActionExplorer] 🔍 Searching for tables to discover transaction details...');

        // Find visible tables
        const tables = await page.locator('table, .mantine-Table-root, [role="grid"]').all();

        const executor = new CommandExecutor(
            { page, actionChain, networkManager },
            { maxRetries: 0 } // No retries for row clicks to keep it fast
        );

        for (const table of tables) {
            try {
                if (!(await table.isVisible())) continue;

                const rows = await table.locator('tbody tr, [role="row"]:not([aria-rowindex="1"]), .mantine-Table-tbody tr').all();

                if (rows.length === 0) {
                    console.log('[ActionExplorer] ⚠️ No rows found in table.');
                    continue;
                }

                // Click first N rows based on constants
                const limit = Math.min(rows.length, LIMITS.ROW_CLICK_SAMPLES);
                console.log(`[ActionExplorer] Found ${rows.length} rows, will attempt to click ${limit}.`);

                for (let i = 0; i < limit; i++) {
                    const row = rows[i];
                    try {
                        // Enhanced validation: check visibility, enablement, and content
                        const isVisible = await row.isVisible();
                        const isEnabled = await row.isEnabled();
                        const text = (await row.innerText()).trim();

                        if (isVisible && isEnabled && text.length > 0) {
                            console.log(`[ActionExplorer] 🖱️ Clicking row ${i + 1} ("${text.substring(0, 30)}...") to trigger transaction API...`);

                            const command = new ClickCommand(row, { label: `Row ${i + 1}` });
                            await executor.execute(command);

                            // Wait for API response (stabilization)
                            await page.waitForTimeout(TIMING.NAVIGATION_DELAY);

                            // If it navigated away, go back to continue discovery
                            if (page.url() !== targetUrl) {
                                console.log('[ActionExplorer] Navigated away after row click, returning...');
                                await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => { });
                                await page.waitForTimeout(TIMING.NAVIGATION_DELAY);
                            }
                        } else {
                            console.log(`[ActionExplorer] ⏭️ Skipping row ${i + 1}: isVisible=${isVisible}, isEnabled=${isEnabled}, hasText=${text.length > 0}`);
                        }
                    } catch (innerE) {
                        console.error(`[ActionExplorer] Failed to validate or click row ${i + 1}:`, innerE);
                    }
                }
            } catch (e) {
                console.error('[ActionExplorer] Error during row discovery:', e);
            }
        }
    }
}
