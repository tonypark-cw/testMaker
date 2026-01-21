import { Page } from 'playwright';
import sharp from 'sharp';

export class FilterExplorer {
    /**
     * Phase 4.6: Filter Exploration
     * Samples filter controls (Select, Checkbox, Toggle, Radio).
     */

    /**
     * Explore Select/Combobox options (max 3 samples)
     */
    static async exploreSelects(
        page: Page,
        targetUrl: string,
        outputDir: string,
        timestamp: string,
        screenshotBaseName: string
    ): Promise<number> {
        console.log('[FilterExplorer] Exploring Select/Combobox...');

        const selects = await page.locator('select, [role="combobox"]').all();
        console.log(`[FilterExplorer] Found ${selects.length} select controls`);

        let capturedCount = 0;
        const maxSamples = 3;

        for (let i = 0; i < Math.min(selects.length, 2); i++) {
            try {
                const select = selects[i];
                if (!await select.isVisible()) continue;

                const options = await select.locator('option').all();
                const sampleCount = Math.min(options.length, maxSamples);

                for (let j = 0; j < sampleCount; j++) {
                    try {
                        await select.selectOption({ index: j });
                        await page.waitForTimeout(500);

                        const optionText = await options[j].innerText();
                        const screenshotPath = `${outputDir}/${screenshotBaseName}_select${i + 1}-${optionText.toLowerCase().replace(/\s+/g, '-')}_${timestamp}.webp`;

                        const pngBuffer = await page.screenshot({ fullPage: true });
                        await sharp(pngBuffer).webp({ quality: 80 }).toFile(screenshotPath);

                        console.log(`[FilterExplorer] ✓ Select: ${optionText}`);
                        capturedCount++;
                    } catch { /* skip */ }
                }

                // Reset
                await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => { });

            } catch (e) {
                console.error(`[FilterExplorer] Error on select ${i}:`, e);
            }
        }

        return capturedCount;
    }

    /**
     * Explore Checkboxes (max 3 samples)
     */
    static async exploreCheckboxes(
        page: Page,
        targetUrl: string,
        outputDir: string,
        timestamp: string,
        screenshotBaseName: string
    ): Promise<number> {
        console.log('[FilterExplorer] Exploring Checkboxes...');

        const checkboxes = await page.locator('input[type="checkbox"]:visible').all();
        console.log(`[FilterExplorer] Found ${checkboxes.length} checkboxes`);

        let capturedCount = 0;
        const maxSamples = 3;

        for (let i = 0; i < Math.min(checkboxes.length, maxSamples); i++) {
            try {
                const checkbox = checkboxes[i];

                // Toggle ON
                await checkbox.check();
                await page.waitForTimeout(500);

                const screenshotPath = `${outputDir}/${screenshotBaseName}_checkbox${i + 1}-on_${timestamp}.webp`;

                const pngBuffer = await page.screenshot({ fullPage: true });
                await sharp(pngBuffer).webp({ quality: 80 }).toFile(screenshotPath);

                console.log(`[FilterExplorer] ✓ Checkbox ${i + 1}: ON`);
                capturedCount++;

                // Reset
                await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => { });

            } catch (e) {
                console.error(`[FilterExplorer] Error on checkbox ${i}:`, e);
            }
        }

        return capturedCount;
    }

    /**
     * Explore Toggle switches (max 2 samples)
     */
    static async exploreToggles(
        page: Page,
        targetUrl: string,
        outputDir: string,
        timestamp: string,
        screenshotBaseName: string
    ): Promise<number> {
        console.log('[FilterExplorer] Exploring Toggles...');

        const toggles = await page.locator('[role="switch"], .toggle, .switch').all();
        console.log(`[FilterExplorer] Found ${toggles.length} toggles`);

        let capturedCount = 0;
        const maxSamples = 2;

        for (let i = 0; i < Math.min(toggles.length, maxSamples); i++) {
            try {
                const toggle = toggles[i];
                if (!await toggle.isVisible()) continue;

                await toggle.click();
                await page.waitForTimeout(500);

                const screenshotPath = `${outputDir}/${screenshotBaseName}_toggle${i + 1}_${timestamp}.webp`;

                const pngBuffer = await page.screenshot({ fullPage: true });
                await sharp(pngBuffer).webp({ quality: 80 }).toFile(screenshotPath);

                console.log(`[FilterExplorer] ✓ Toggle ${i + 1}`);
                capturedCount++;

                // Reset
                await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => { });

            } catch (e) {
                console.error(`[FilterExplorer] Error on toggle ${i}:`, e);
            }
        }

        return capturedCount;
    }

    /**
     * Explore Radio buttons (max 2 samples)
     */
    static async exploreRadios(
        page: Page,
        targetUrl: string,
        outputDir: string,
        timestamp: string,
        screenshotBaseName: string
    ): Promise<number> {
        console.log('[FilterExplorer] Exploring Radio buttons...');

        const radios = await page.locator('input[type="radio"]:visible').all();
        console.log(`[FilterExplorer] Found ${radios.length} radio buttons`);

        let capturedCount = 0;
        const maxSamples = 2;

        for (let i = 0; i < Math.min(radios.length, maxSamples); i++) {
            try {
                const radio = radios[i];

                await radio.check();
                await page.waitForTimeout(500);

                const screenshotPath = `${outputDir}/${screenshotBaseName}_radio${i + 1}_${timestamp}.webp`;

                const pngBuffer = await page.screenshot({ fullPage: true });
                await sharp(pngBuffer).webp({ quality: 80 }).toFile(screenshotPath);

                console.log(`[FilterExplorer] ✓ Radio ${i + 1}`);
                capturedCount++;

                // Reset
                await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => { });

            } catch (e) {
                console.error(`[FilterExplorer] Error on radio ${i}:`, e);
            }
        }

        return capturedCount;
    }
}
