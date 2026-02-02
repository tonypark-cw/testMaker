import * as fs from 'fs';
import * as path from 'path';
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
    outputDir: string;
    discoveredLinks?: Array<{ url: string; path: string[] }>;
    sidebarLinks?: string[];
}

export class NavExplorer {
    static async expandMenus(ctx: NavExplorationContext): Promise<number> {
        const { page, visitedExpansionButtons, actionChain, networkManager, targetUrl, outputDir, discoveredLinks } = ctx;
        const executor = new CommandExecutor({ page, actionChain, networkManager }, { maxRetries: 1 });

        // Optimized: Support both buttons and anchor tags serving as expanders
        const expanderSelector = [
            'aside button[aria-expanded="false"]',
            '.sidebar button[aria-expanded="false"]',
            'nav button[aria-expanded="false"]',
            'aside a[aria-expanded="false"]',    // [New] Support clickable links that also expand
            '.sidebar a[aria-expanded="false"]', // [New]
            'nav a[aria-expanded="false"]'       // [New]
        ].join(', ');

        const expandableItems = await page.locator(expanderSelector).all();
        let expandedCount = 0;

        for (const item of expandableItems) {
            try {
                const text = (await item.innerText().catch(() => '')).trim();
                const id = await item.getAttribute('id') || `expand-${text}`;

                // [Exclude] Skip profile/settings related items to avoid UI theme changes or irrelevant navigation
                if (/profile|settings|theme|logout/i.test(text)) continue;

                // Allow re-visiting if we suspect it might be a navigating-parent (e.g. <a> tag)
                // but generally prevent spamming the same toggle
                if (!text || visitedExpansionButtons.has(id)) continue;

                if (await item.isVisible()) {
                    visitedExpansionButtons.add(id);
                    const currentUrl = page.url();

                    await executor.execute(new ClickCommand(item, { label: `Expand/Nav: ${text}` }));
                    await page.waitForTimeout(TIMING.MENU_ANIMATION_DELAY);

                    // If it navigated away, we should go back to preserve context for pending items
                    if (page.url() !== currentUrl) {
                        // [New] Save HTML snapshot for analysis
                        try {
                            const html = await page.content();
                            const safeText = text.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
                            const fileName = `expansion_nav_${safeText}_${Date.now()}.html`;
                            const saveDir = path.join(outputDir, 'html');
                            if (!fs.existsSync(saveDir)) {
                                fs.mkdirSync(saveDir, { recursive: true });
                            }
                            const savePath = path.join(saveDir, fileName);
                            fs.writeFileSync(savePath, html);
                            console.log(`[NavExplorer] 📸 Saved expansion page source: ${fileName}`);
                        } catch (e) {
                            console.error('[NavExplorer] Failed to save HTML:', e);
                        }

                        // [New] Capture the navigated URL as a discovery
                        const newUrl = page.url();
                        if (discoveredLinks && newUrl !== targetUrl) {
                            // Avoid duplicates
                            if (!discoveredLinks.find(l => l.url === newUrl)) {
                                discoveredLinks.push({
                                    url: newUrl,
                                    path: ['Expansion', text] // Simple path indication
                                });
                                console.log(`[NavExplorer] 🔗 Discovered link via expansion: ${text} -> ${newUrl}`);
                            }
                        }

                        // Attempt to capture the navigated URL as a discovery if we can (NavExplorer logic does this generally, but here we are in expandMenus)
                        // For now, prioritize returning to state
                        await page.goBack().catch(() => page.goto(targetUrl));
                        await page.waitForTimeout(TIMING.NAVIGATION_DELAY);
                    }

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
                if (/profile|settings|theme|logout/i.test(text)) continue;

                if (href) {
                    const abs = new URL(href, targetUrl).toString();
                    if (!discoveredLinks.find(l => l.url === abs)) {
                        discoveredLinks.push({ url: abs, path: [...previousPath, text] });
                    }
                    // [ENHANCE] Explicitly mark as sidebar link for prioritization
                    if (!ctx.sidebarLinks) ctx.sidebarLinks = [];
                    if (!ctx.sidebarLinks.includes(abs)) {
                        ctx.sidebarLinks.push(abs);
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
