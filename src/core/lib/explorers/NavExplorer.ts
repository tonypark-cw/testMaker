import { Page } from 'playwright';
import { ActionRecord, ModalDiscovery } from '../../../../types/index.js';
import { UISettler } from '../UISettler.js';

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
        const expansionLocators = [
            'button:has-text("more")',
            'button:has-text("expand")',
            'button:has-text("show more")',
            'aside button[aria-expanded="false"]',
            '.sidebar button[aria-expanded="false"]',
            'nav button[aria-expanded="false"]'
        ];

        let expandedCount = 0;
        for (const selector of expansionLocators) {
            const buttons = await page.locator(selector).all();
            for (const button of buttons) {
                try {
                    const text = (await button.innerText()).trim().toLowerCase();
                    const id = await button.getAttribute('id') || `btn-${text}`;

                    if (visitedExpansionButtons.has(id)) continue;
                    visitedExpansionButtons.add(id);

                    if (await button.isVisible()) {
                        await button.click({ timeout: 2000 });
                        await page.waitForTimeout(500);
                        expandedCount++;

                        actionChain.push({
                            type: 'click',
                            selector: selector,
                            label: `Expand Menu: ${text}`,
                            url: page.url(),
                            timestamp: new Date().toISOString()
                        });
                    }
                } catch { /* ignore */ }
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
        const sidebarItems = await page.locator('aside a, .sidebar a, nav a, .nav-item, [role="menuitem"]').all();

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

                    // If no href, try clicking to see if it's a SPA route trigger
                    await item.click({ timeout: 2000 });
                    await page.waitForTimeout(1000);

                    const newUrl = page.url();
                    if (newUrl !== targetUrl) {
                        discoveredLinks.push({ url: newUrl, path: [...previousPath, cleanText] });
                        await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => { });
                    } else {
                        // Check for modal
                        const discovery = await UISettler.extractModalContent(page, cleanText, targetUrl, outputDir, timestamp, capturedModalHashes);
                        if (discovery) modalDiscoveries.push(discovery);
                    }
                }
            } catch { /* ignore */ }
        }
    }
}
