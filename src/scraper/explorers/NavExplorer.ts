import type { ActionRecord, ModalDiscovery } from '../../types/index.js';
import { UISettler } from '../lib/UISettler.js';
import { CommandExecutor, ClickCommand } from '../commands/index.js';
import { TIMING } from '../config/constants.js';
import { NetworkManager } from '../../shared/network/NetworkManager.js';
import { BrowserPage } from '../adapters/BrowserPage.js';

export interface NavExplorationContext {
    page: BrowserPage;
    targetUrl: string;
    actionChain: ActionRecord[];
    networkManager?: NetworkManager;
    visitedExpansionButtons: Set<string>;
    visitedSidebarButtons: Set<string>;
}

export class NavExplorer {
    static async expandMenus(ctx: NavExplorationContext): Promise<number> {
        const { page, visitedExpansionButtons, actionChain, networkManager } = ctx;
        const executor = new CommandExecutor({ page, actionChain, networkManager }, { maxRetries: 1 });

        // Optimized: Only fetch searchable expansion targets once per phase
        const expandableButtons = await page.locator('aside button[aria-expanded="false"], .sidebar button[aria-expanded="false"], nav button[aria-expanded="false"]').all();
        let expandedCount = 0;

        for (const button of expandableButtons) {
            try {
                const text = (await button.innerText().catch(() => '')).trim();
                const id = await button.getAttribute('id') || `btn-${text}`;
                if (!text || visitedExpansionButtons.has(id)) continue;

                if (await button.isVisible()) {
                    visitedExpansionButtons.add(id);
                    await executor.execute(new ClickCommand(button, { label: `Expand: ${text}` }));
                    await page.waitForTimeout(TIMING.MENU_ANIMATION_DELAY);
                    expandedCount++;
                }
            } catch (_e) { /* ignore */ }
        }
        return expandedCount;
    }

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
        const { page, targetUrl, visitedSidebarButtons, actionChain, networkManager, discoveredLinks, modalDiscoveries, previousPath, outputDir, timestamp, capturedModalHashes } = ctx;
        const executor = new CommandExecutor({ page, actionChain, networkManager }, { maxRetries: 1 });

        const sidebarLocator = 'aside a, .sidebar a, nav a, a[href^="/app/"]';

        // 1. Initial Scan (Bulk)
        const items = await page.locator(sidebarLocator).all();
        const targets: { text: string, href: string | null, index: number }[] = [];

        for (let i = 0; i < items.length; i++) {
            try {
                const href = await items[i].getAttribute('href');
                const text = (await items[i].innerText().catch(() => '')).trim().split('\n')[0];
                if (!text) continue;

                if (href) {
                    const abs = new URL(href, targetUrl).toString();
                    if (!discoveredLinks.find(l => l.url === abs)) {
                        discoveredLinks.push({ url: abs, path: [...previousPath, text] });
                    }
                }
                targets.push({ text, href, index: i });
            } catch (_e) { /* ignore */ }
        }

        // 2. Focused Interaction (Only unseen items)
        for (const target of targets) {
            try {
                if (visitedSidebarButtons.has(target.text)) continue;

                // Re-verify the item still exists and matches
                const currentItems = await page.locator(sidebarLocator).all();
                const item = currentItems[target.index];
                if (!item || (await item.innerText().catch(() => '')).trim().split('\n')[0] !== target.text) continue;

                if (await item.isVisible() && await item.isEnabled()) {
                    visitedSidebarButtons.add(target.text);
                    const currentUrl = page.url();

                    await executor.execute(new ClickCommand(item, { label: `Nav: ${target.text}` }));
                    await page.waitForTimeout(TIMING.NAVIGATION_DELAY);

                    const newUrl = page.url();

                    // Captured SPA routes
                    const routes = await page.evaluate(() => {
                        /* eslint-disable @typescript-eslint/no-explicit-any */
                        const r = Array.from((window as any).__discoveredRoutes || []) as string[];
                        (window as any).__discoveredRoutes = new Set<string>();
                        return r;
                        /* eslint-enable @typescript-eslint/no-explicit-any */
                    }, undefined) as string[];

                    for (const route of routes) {
                        const abs = new URL(route, targetUrl).toString();
                        if (!discoveredLinks.find(l => l.url === abs)) {
                            discoveredLinks.push({ url: abs, path: [...previousPath, target.text] });
                        }
                    }

                    if (newUrl !== currentUrl) {
                        if (!discoveredLinks.find(l => l.url === newUrl)) {
                            discoveredLinks.push({ url: newUrl, path: [...previousPath, target.text] });
                        }
                        // SPA-friendly back
                        await page.goBack().catch(() => page.goto(targetUrl));
                        await page.waitForTimeout(TIMING.NAVIGATION_DELAY);
                    } else {
                        const disc = await UISettler.extractModalContent(page, target.text, targetUrl, outputDir, timestamp, capturedModalHashes);
                        if (disc) modalDiscoveries.push(disc);
                    }
                }
            } catch (_e) { /* ignore */ }
        }
    }
}
