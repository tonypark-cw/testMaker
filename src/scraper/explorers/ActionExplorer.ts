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
                    const text = (await button.innerText().catch(() => '')).trim();
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
                    if (await el.isVisible() && await el.isEnabled()) {
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

                // [SEMANTIC-DISCOVERY] 1. Collect all rows first
                const rows = await table.locator('tbody tr, [role="row"]:not([aria-rowindex="1"]), .mantine-Table-tbody tr').all();
                if (rows.length === 0) {
                    console.log('[ActionExplorer] ⚠️ No rows found in table.');
                    continue;
                }

                console.log(`[ActionExplorer] Found ${rows.length} total rows. Analyzing usage of "Status"/"State" columns...`);

                // [SEMANTIC-DISCOVERY] 2. Analyze Headers to find meaningful columns
                // We try to find which column index corresponds to "Status", "State", "Type"
                let statusColIndex = -1;
                const headers = await table.locator('thead th, [role="columnheader"]').all();

                for (let i = 0; i < headers.length; i++) {
                    const text = (await headers[i].innerText().catch(() => '')).toLowerCase();
                    if (['status', 'state', 'type', 'stage', 'category'].some(k => text.includes(k))) {
                        statusColIndex = i;
                        console.log(`[ActionExplorer] 🎯 Identified semantic column "${text}" at index ${i}`);
                        break;
                    }
                }

                // [SEMANTIC-DISCOVERY] 3. Group Rows by Semantic State
                const rowGroups: Record<string, typeof rows> = {};
                const rowsToClick: typeof rows = [];

                if (statusColIndex !== -1) {
                    // Group by identified column
                    for (const row of rows) {
                        try {
                            const cells = await row.locator('td, [role="gridcell"]').all();
                            if (cells[statusColIndex]) {
                                const statusText = (await cells[statusColIndex].innerText().catch(() => 'Unknown')).trim();
                                if (!rowGroups[statusText]) rowGroups[statusText] = [];
                                rowGroups[statusText].push(row);
                            }
                        } catch { /* ignore row read error */ }
                    }

                    console.log(`[ActionExplorer] 📊 Row Groups: ${JSON.stringify(Object.keys(rowGroups).map(k => `${k}: ${rowGroups[k].length}`))}`);

                    // Select representatives (1 from each group, up to LIMITS)
                    for (const status of Object.keys(rowGroups)) {
                        const group = rowGroups[status];
                        // Prioritize rare states? For now just take the first one or random one
                        if (group.length > 0) {
                            rowsToClick.push(group[0]);
                            // If we want more coverage for this state, maybe add a second one if available
                            if (group.length > 5) rowsToClick.push(group[Math.floor(group.length / 2)]);
                        }
                    }
                } else {
                    // Fallback: Default first N rows
                    console.log('[ActionExplorer] ℹ️ No semantic column found. Using default sampling.');
                    for (let i = 0; i < Math.min(rows.length, LIMITS.ROW_CLICK_SAMPLES); i++) {
                        rowsToClick.push(rows[i]);
                    }
                }

                // [SEMANTIC-DISCOVERY] 4. Execute Clicks on Selected Rows
                console.log(`[ActionExplorer] 👉 Selected ${rowsToClick.length} representative rows for exploration.`);

                for (let i = 0; i < rowsToClick.length; i++) {
                    const row = rowsToClick[i];
                    try {
                        const isVisible = await row.isVisible({ timeout: 1000 }).catch(() => false);
                        const isEnabled = await row.isEnabled({ timeout: 1000 }).catch(() => false);
                        const text = (await row.innerText().catch(() => '')).trim();

                        if (isVisible && isEnabled && text.length > 0) {
                            console.log(`[ActionExplorer] 🖱️ Clicking representative row ${i + 1} ("${text.substring(0, 30)}...")`);

                            const command = new ClickCommand(row, { label: `Row Rep ${i + 1}` });
                            await executor.execute(command);

                            await page.waitForTimeout(TIMING.NAVIGATION_DELAY);

                            if (page.url() !== targetUrl) {
                                await page.goBack().catch(() => page.goto(targetUrl));
                                await page.waitForTimeout(TIMING.NAVIGATION_DELAY);
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
    }
}
