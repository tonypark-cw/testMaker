import { Page } from 'playwright';
import { ActionRecord, ModalDiscovery } from '../../../types/index.js';
import { UISettler } from '../lib/UISettler.js';

export class NavExplorer {
    /**
     * Phase 4: Menu Expansion (Cache-aware)
     * Finds and clicks sidebar/navigation expansion buttons to reveal more links.
     */
    static async expandMenus(
        page: Page,
        targetUrl: string,
        visitedExpansionButtons: Set<string>,
        actionChain: ActionRecord[],
        discoveredLinks: Array<{ url: string; path: string[] }>,
        previousPath: string[]
    ): Promise<number> {
        // Broaden search to include Mantine buttons and position-based sidebar items
        const expandableButtons = await page.locator('aside button, .sidebar button, nav button, .nav-item[role="button"], .mantine-UnstyledButton-root, button[aria-expanded]').all();
        let expandedCount = 0;

        for (const button of expandableButtons) {
            try {
                const text = (await button.innerText()).trim();
                const isExpanded = await button.getAttribute('aria-expanded');
                const id = await button.getAttribute('id') || `btn-${text}`;

                if (visitedExpansionButtons.has(id)) continue;

                // Known headers in ianaiERP that might benefit from expansion
                const isNavHeader = ['Inventory', 'Manufacturing', 'Purchase', 'Sales', 'Settings', 'Shipping', 'Accounting', 'Service', 'Reports'].some(h => text.includes(h));

                // ONLY click if aria-expanded is specifically 'false' OR it's a known header with missing expanded state
                if (isExpanded === 'false' || (isNavHeader && (isExpanded === null || isExpanded === ''))) {
                    if (await button.isVisible()) {
                        visitedExpansionButtons.add(id);
                        await UISettler.smartClick(page, button, actionChain);
                        await page.waitForTimeout(1000); // Wait for menu animation
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
        page: Page,
        targetUrl: string,
        visitedSidebarButtons: Set<string>,
        actionChain: ActionRecord[],
        discoveredLinks: Array<{ url: string; path: string[] }>,
        modalDiscoveries: ModalDiscovery[],
        previousPath: string[],
        outputDir: string,
        timestamp: string,
        capturedModalHashes: Set<string>
    ): Promise<void> {
        // Broaden sidebar items to include all links and buttons on the left side, or with specific classes
        const sidebarItems = await page.locator('aside a, .sidebar a, nav a, .nav-item, [role="menuitem"], .mantine-NavLink-root, a[href^="/app/"]').all();

        // Add position-based discovery for Mantine/Ghost sidebars
        const allButtons = await page.locator('button, .mantine-UnstyledButton-root').all();
        for (const btn of allButtons) {
            try {
                const rect = await btn.boundingBox();
                // Sidebar items are consistently on the left (x < 300) and have a reasonable width/height
                if (rect && rect.x < 300 && rect.width < 400 && rect.height > 10) {
                    sidebarItems.push(btn);
                }
            } catch {
                /* ignored */
            }
        }

        for (const item of sidebarItems) {
            try {
                const text = (await item.innerText()).trim();
                const cleanText = text.split('\n')[0].trim();
                if (!cleanText || visitedSidebarButtons.has(cleanText)) continue;

                if (await item.isVisible()) {
                    visitedSidebarButtons.add(cleanText);

                    const href = await item.getAttribute('href');
                    if (href && (href.startsWith('http') || href.startsWith('/'))) {
                        discoveredLinks.push({ url: new URL(href, targetUrl).toString(), path: [...previousPath, cleanText] });
                        continue;
                    }

                    // If no href, only click if it's NOT an expandable menu (to avoid toggling)
                    const isExpanded = await item.getAttribute('aria-expanded');
                    if (isExpanded === null || isExpanded === '') { // Not an expandable menu header
                        await UISettler.smartClick(page, item, actionChain);
                        await page.waitForTimeout(1000);

                        const newUrl = page.url();
                        const normalizedTarget = targetUrl.replace(/\/$/, '');
                        const normalizedNew = newUrl.replace(/\/$/, '');

                        if (normalizedNew !== normalizedTarget) {
                            discoveredLinks.push({ url: newUrl, path: [...previousPath, cleanText] });
                            // Go back to target if it navigated away
                            await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => { });
                            await page.waitForTimeout(1000);
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
