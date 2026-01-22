import type { ActionRecord, ModalDiscovery } from '../../types/index.js';
import { UISettler } from '../lib/UISettler.js';
import { CommandExecutor, ClickCommand } from '../commands/index.js';
import { TIMING, THRESHOLDS } from '../config/constants.js';
import { NetworkManager } from '../../shared/network/NetworkManager.js';
import { BrowserPage } from '../adapters/BrowserPage.js';

/**
 * Context for navigation exploration.
 */
export interface NavExplorationContext {
    page: BrowserPage;
    targetUrl: string;
    actionChain: ActionRecord[];
    networkManager?: NetworkManager;
    visitedExpansionButtons: Set<string>;
    visitedSidebarButtons: Set<string>;
}

export class NavExplorer {
    /**
     * Phase 4: Menu Expansion (Cache-aware)
     * Finds and clicks sidebar/navigation expansion buttons to reveal more links.
     */
    static async expandMenus(
        ctx: NavExplorationContext
    ): Promise<number> {
        const { page, visitedExpansionButtons, actionChain, networkManager } = ctx;

        const executor = new CommandExecutor(
            { page, actionChain, networkManager },
            { maxRetries: 1, retryDelayMs: 200 }
        );

        // Broaden search to include Mantine buttons and position-based sidebar items
        const expandableButtons = await page.locator('aside button, .sidebar button, nav button, .nav-item[role="button"], .mantine-UnstyledButton-root, button[aria-expanded]').all();
        let expandedCount = 0;

        for (const button of expandableButtons) {
            try {
                const text = (await button.innerText().catch(() => '')).trim();
                const isExpanded = await button.getAttribute('aria-expanded');
                const id = await button.getAttribute('id') || `btn-${text}`;

                if (visitedExpansionButtons.has(id)) continue;

                // Known headers in ianaiERP that might benefit from expansion
                const isNavHeader = ['Inventory', 'Manufacturing', 'Purchase', 'Sales', 'Settings', 'Shipping', 'Accounting', 'Service', 'Reports', 'Support', 'Help', 'Admin', 'System', 'Configuration', 'User', 'Finance', 'HR', 'Logistics'].some(h => text.includes(h));

                // ONLY click if aria-expanded is specifically 'false' OR it's a known header with missing expanded state
                if (isExpanded === 'false' || (isNavHeader && (isExpanded === null || isExpanded === ''))) {
                    if (await button.isVisible() && await button.isEnabled()) {
                        visitedExpansionButtons.add(id);

                        // Use ClickCommand
                        const command = new ClickCommand(button, { label: `Expand: ${text}` });
                        await executor.execute(command);

                        await page.waitForTimeout(TIMING.MENU_ANIMATION_DELAY);
                        expandedCount++;
                    }
                }
            } catch {
                /* ignored */
            }
        }
        return expandedCount;
    }

    /**
     * Phase 5: Active Sidebar Discovery (Cache-aware)
     * Clicks all navigation items in sidebars or nav bars.
     */
    static async discoverSidebar(
        ctx: NavExplorationContext & {
            discoveredLinks: Array<{ url: string; path: string[] }>,
            modalDiscoveries: ModalDiscovery[],
            previousPath: string[],
            outputDir: string,
            timestamp: string,
            capturedModalHashes: Set<string>
        }
    ): Promise<void> {
        const {
            page, targetUrl, visitedSidebarButtons, actionChain, networkManager,
            discoveredLinks, modalDiscoveries, previousPath, outputDir, timestamp, capturedModalHashes
        } = ctx;

        const executor = new CommandExecutor(
            { page, actionChain, networkManager },
            { maxRetries: 1, retryDelayMs: 200 }
        );

        // Broaden sidebar items to include all links and buttons on the left side, or with specific classes
        const sidebarItems = await page.locator('aside a, .sidebar a, nav a, .nav-item, [role="menuitem"], .mantine-NavLink-root, a[href^="/app/"]').all();

        // Add position-based discovery for Mantine/Ghost sidebars
        const allButtons = await page.locator('button, .mantine-UnstyledButton-root').all();
        for (const btn of allButtons) {
            try {
                const rect = await btn.boundingBox();
                // Sidebar items are consistently on the left and have a reasonable width/height
                if (rect && rect.x < THRESHOLDS.SIDEBAR_X_THRESHOLD && rect.width < THRESHOLDS.SIDEBAR_BUTTON_MAX_WIDTH && rect.height > THRESHOLDS.SIDEBAR_ELEMENT_MIN_HEIGHT) {
                    sidebarItems.push(btn);
                }
            } catch {
                /* ignored */
            }
        }

        for (const item of sidebarItems) {
            try {
                const text = (await item.innerText().catch(() => '')).trim();
                const cleanText = text.split('\n')[0].trim();
                if (!cleanText || visitedSidebarButtons.has(cleanText)) continue;

                if (await item.isVisible() && await item.isEnabled()) {
                    visitedSidebarButtons.add(cleanText);

                    const href = await item.getAttribute('href');
                    if (href && (href.startsWith('http') || href.startsWith('/'))) {
                        discoveredLinks.push({ url: new URL(href, targetUrl).toString(), path: [...previousPath, cleanText] });
                        continue;
                    }

                    // If no href, only click if it's NOT an expandable menu (to avoid toggling)
                    const isExpanded = await item.getAttribute('aria-expanded');
                    if (isExpanded === null || isExpanded === '') { // Not an expandable menu header

                        // Use ClickCommand
                        const command = new ClickCommand(item, { label: `Nav: ${cleanText}` });
                        await executor.execute(command);

                        await page.waitForTimeout(TIMING.NAVIGATION_DELAY);

                        const newUrl = page.url();
                        const normalizedTarget = targetUrl.replace(/\/$/, '');
                        const normalizedNew = newUrl.replace(/\/$/, '');

                        if (normalizedNew !== normalizedTarget) {
                            discoveredLinks.push({ url: newUrl, path: [...previousPath, cleanText] });
                            // Go back to target if it navigated away
                            await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => { });
                            await page.waitForTimeout(TIMING.NAVIGATION_DELAY);
                        } else {
                            // Check for modal if no navigation occurred
                            const discovery = await UISettler.extractModalContent(page, cleanText, targetUrl, outputDir, timestamp, capturedModalHashes);
                            if (discovery) modalDiscoveries.push(discovery);
                        }
                    }
                }
            } catch {
                /* ignored */
            }
        }
    }
}
