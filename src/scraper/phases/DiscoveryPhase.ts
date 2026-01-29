import { NavExplorer } from '../explorers/NavExplorer.js';
import { TabExplorer } from '../explorers/TabExplorer.js';
import { FilterExplorer } from '../explorers/FilterExplorer.js';
import { ActionExplorer } from '../explorers/ActionExplorer.js';
import { ContentExplorer } from '../explorers/ContentExplorer.js';
import { BrowserPage } from '../adapters/BrowserPage.js';
import { IExplorationPhase, PhaseResult } from './IExplorationPhase.js';
import { ExplorationContext } from './ExplorationContext.js';

export class DiscoveryPhase implements IExplorationPhase {
    readonly name = 'Discovery';

    async execute(context: ExplorationContext): Promise<PhaseResult> {
        const { page, actionChain, outputDir, timestamp, pageName } = context;
        console.log('[DiscoveryPhase] 🔍 Starting exploration phases...');

        const targetUrl = context.results.targetUrl;
        const discoveredLinks = context.results.links;
        const modalDiscoveries = context.results.modalDiscoveries;
        const previousPath = context.results.links.length > 0 ? context.results.links[0].path : []; // This is a bit arbitrary, but matches previous behavior

        const baseCtx = { page, targetUrl, actionChain, networkManager: undefined }; // networkManager handled in Scraper constructor

        const discoveryCtx = {
            ...baseCtx,
            discoveredLinks,
            modalDiscoveries,
            previousPath,
            outputDir,
            timestamp,
            capturedModalHashes: context.state.capturedModalHashes
        };

        // 1. Menu Expansion
        const expandedCount = await NavExplorer.expandMenus({
            ...baseCtx,
            visitedExpansionButtons: context.state.visitedExpansionButtons,
            visitedSidebarButtons: context.state.visitedSidebarButtons,
            outputDir,
            discoveredLinks
        });
        if (expandedCount > 0) console.log(`[DiscoveryPhase] Expanded ${expandedCount} NEW menu items.`);

        // 2. Tab Exploration
        const tabCount = await TabExplorer.exploreTabs({
            ...baseCtx,
            outputDir,
            timestamp,
            screenshotBaseName: pageName
        });
        if (tabCount > 0) console.log(`[DiscoveryPhase] Explored ${tabCount} tabs.`);

        // 3. Filter Exploration
        const filterCtx = { ...baseCtx, outputDir, timestamp, screenshotBaseName: pageName };
        const selectCount = await FilterExplorer.exploreSelects(filterCtx);
        const checkboxCount = await FilterExplorer.exploreCheckboxes(filterCtx);
        const toggleCount = await FilterExplorer.exploreToggles(filterCtx);
        const radioCount = await FilterExplorer.exploreRadios(filterCtx);
        if (selectCount + checkboxCount + toggleCount + radioCount > 0) {
            console.log(`[DiscoveryPhase] Filters: ${selectCount} selects, ${checkboxCount} checks, ${toggleCount} toggles, ${radioCount} radios.`);
        }

        // 4. Row Click Discovery (Transaction details)
        await ActionExplorer.discoverTransactionDetails(baseCtx);

        // 5. Auto-Scroll
        await this.autoScroll(page);

        // 6. Sidebar Discovery
        await NavExplorer.discoverSidebar({
            ...discoveryCtx,
            visitedExpansionButtons: context.state.visitedExpansionButtons,
            visitedSidebarButtons: context.state.visitedSidebarButtons
        });

        // 7. View All
        await ActionExplorer.handleViewAll(discoveryCtx);

        // 8. Detail Page Discovery (Table rows)
        await ContentExplorer.discoverDetailPages({
            ...discoveryCtx,
            clickedRowTexts: context.state.clickedRowTexts
        });

        // 9. Pagination
        await ContentExplorer.handlePagination(discoveryCtx);

        // 10. Global Actions
        await ActionExplorer.discoverGlobalActions(discoveryCtx);

        return { success: true };
    }

    private async autoScroll(page: BrowserPage): Promise<void> {
        console.log('[DiscoveryPhase] Scrolling to discover more content...');
        try {
            await page.evaluate(() => {
                return new Promise<void>((resolve) => {
                    let totalHeight = 0;
                    const distance = 200;
                    const timer = setInterval(() => {
                        const root = document.body;
                        if (!root) { clearInterval(timer); resolve(); return; }
                        const scrollHeight = root.scrollHeight;
                        window.scrollBy(0, distance);
                        totalHeight += distance;
                        if (totalHeight >= scrollHeight || totalHeight > 10000) { clearInterval(timer); resolve(); }
                    }, 30);
                });
            }, undefined);
            await page.waitForTimeout(500);
        } catch { /* ignore */ }
    }
}
