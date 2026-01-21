import { Page } from 'playwright';
import sharp from 'sharp';

export class TabExplorer {
    /**
     * Phase 4.5: Tab Exploration
     * Clicks on tab buttons to discover different page states.
     */
    static async exploreTabs(
        page: Page,
        targetUrl: string,
        outputDir: string,
        timestamp: string,
        screenshotBaseName: string
    ): Promise<number> {
        console.log('[TabExplorer] Starting tab exploration...');

        // Find all tab buttons
        const tabSelectors = [
            '[role="tab"]',
            '.tab',
            '.mantine-Tabs-tab',
            'button[data-tab]',
            '.ant-tabs-tab'
        ];

        const tabs = await page.locator(tabSelectors.join(', ')).all();
        console.log(`[TabExplorer] Found ${tabs.length} potential tabs`);

        if (tabs.length === 0) {
            console.log('[TabExplorer] No tabs found, skipping');
            return 0;
        }

        let capturedCount = 0;
        const capturedTabs = new Set<string>();

        for (let i = 0; i < tabs.length; i++) {
            try {
                const tab = tabs[i];
                if (!await tab.isVisible()) continue;

                const tabText = (await tab.innerText().catch(() => '')).trim();
                const tabLabel = tabText || `Tab${i + 1}`;

                // Skip duplicates
                if (capturedTabs.has(tabLabel)) continue;

                console.log(`[TabExplorer] Clicking tab: "${tabLabel}"`);

                // Click and wait for content change
                await tab.click();
                await page.waitForTimeout(800);

                // Capture screenshot
                const screenshotPath = `${outputDir}/${screenshotBaseName}_tab-${tabLabel.toLowerCase().replace(/\s+/g, '-')}_${timestamp}.webp`;

                const pngBuffer = await page.screenshot({ fullPage: true });
                await sharp(pngBuffer).webp({ quality: 80 }).toFile(screenshotPath);

                console.log(`[TabExplorer] ✓ Captured: ${tabLabel}`);
                capturedTabs.add(tabLabel);
                capturedCount++;

            } catch (e) {
                console.error(`[TabExplorer] Error on tab ${i}:`, e);
            }
        }

        console.log(`[TabExplorer] Captured ${capturedCount} tab states`);

        // Reload to reset state
        if (capturedCount > 0) {
            await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => { });
        }

        return capturedCount;
    }
}
