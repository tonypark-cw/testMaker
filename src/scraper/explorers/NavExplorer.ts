import type { ActionRecord, ModalDiscovery } from '../../types/index.js';
import { UISettler } from '../lib/UISettler.js';
import { CommandExecutor, ClickCommand } from '../commands/index.js';
import { TIMING } from '../config/constants.js';
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

                const isNavHeader = ['Inventory', 'Manufacturing', 'Purchase', 'Sales', 'Settings', 'Shipping', 'Accounting', 'Reports', 'Admin', '재고', '생산', '구매', '영업', '설정', '배송', '회계', '보고서', '관리', '기준정보', '서비스', '고객지원'].some(h => text.includes(h));

                if (isExpanded === 'false' || (isNavHeader && (isExpanded === null || isExpanded === ''))) {
                    if (await button.isVisible() && await button.isEnabled()) {
                        visitedExpansionButtons.add(id);
                        const command = new ClickCommand(button, { label: `Expand: ${text}` });
                        await executor.execute(command);
                        await page.waitForTimeout(TIMING.MENU_ANIMATION_DELAY);
                        expandedCount++;
                    }
                }
            } catch (_e) {
                // Ignore expansion error
            }
        }
        return expandedCount;
    }

    /**
     * Phase 5: Active Sidebar Discovery (Cache-aware)
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

        const sidebarLocator = 'aside a, .sidebar a, nav a, .nav-item, [role="menuitem"], .mantine-NavLink-root, a[href^="/app/"]';
        const items = await page.locator(sidebarLocator).all();
        const itemIdentifierList: { text: string; index: number }[] = [];

        // INITIAL BULK EXTRACTION
        for (const item of items) {
            try {
                const href = await item.getAttribute('href');
                const text = (await item.innerText().catch(() => '')).trim().split('\n')[0];
                if (href) {
                    const absoluteUrl = new URL(href, targetUrl).toString();
                    if (!discoveredLinks.find(l => l.url === absoluteUrl)) {
                        discoveredLinks.push({ url: absoluteUrl, path: [...previousPath, text || 'Link'] });
                    }
                }
            } catch (_e) {
                /* ignore */
            }
        }

        for (let i = 0; i < items.length; i++) {
            const text = (await items[i].innerText().catch(() => '')).trim().split('\n')[0];
            if (text) itemIdentifierList.push({ text, index: i });
        }

        for (const ident of itemIdentifierList) {
            try {
                if (visitedSidebarButtons.has(ident.text)) continue;

                const currentItems = await page.locator(sidebarLocator).all();
                const item = currentItems[ident.index];
                if (!item) continue;

                const text = (await item.innerText().catch(() => '')).trim().split('\n')[0];
                if (text !== ident.text) continue;

                if (await item.isVisible() && await item.isEnabled()) {
                    visitedSidebarButtons.add(text);

                    const currentUrl = page.url();
                    const command = new ClickCommand(item, { label: `Nav: ${text}` });
                    await executor.execute(command);
                    await page.waitForTimeout(TIMING.NAVIGATION_DELAY);

                    const newUrl = page.url();

                    // COLLECT NEWLY VISIBLE LINKS after click
                    const subLinks = await page.locator(sidebarLocator).all();
                    for (const sl of subLinks) {
                        try {
                            const shref = await sl.getAttribute('href');
                            if (shref) {
                                const abs = new URL(shref, targetUrl).toString();
                                if (!discoveredLinks.find(l => l.url === abs)) {
                                    discoveredLinks.push({ url: abs, path: [...previousPath, text] });
                                }
                            }
                        } catch (_e) {
                            /* ignore */
                        }
                    }

                    // SPA Interceptor capture
                    const routes = await page.evaluate(() => {
                        const r = Array.from((window as any).__discoveredRoutes || []) as string[];
                        (window as any).__discoveredRoutes = new Set<string>();
                        return r;
                    }, undefined) as string[];

                    for (const route of routes) {
                        try {
                            const absoluteUrl = new URL(route, targetUrl).toString();
                            if (!discoveredLinks.find(l => l.url === absoluteUrl)) {
                                discoveredLinks.push({ url: absoluteUrl, path: [...previousPath, ident.text] });
                            }
                        } catch (_e) {
                            /* ignore */
                        }
                    }

                    if (newUrl !== currentUrl) {
                        if (!discoveredLinks.find(l => l.url === newUrl)) {
                            discoveredLinks.push({ url: newUrl, path: [...previousPath, ident.text] });
                        }
                        await page.goBack().catch(() => page.goBack()).catch(() => page.goto(targetUrl));
                        await page.waitForTimeout(TIMING.NAVIGATION_DELAY);
                        await NavExplorer.expandMenus(ctx);
                    } else {
                        const discovery = await UISettler.extractModalContent(page, ident.text, targetUrl, outputDir, timestamp, capturedModalHashes);
                        if (discovery) modalDiscoveries.push(discovery);
                    }
                }
            } catch (_e) {
                /* ignore */
            }
        }
    }
}
