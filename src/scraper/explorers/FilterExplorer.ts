import sharp from 'sharp';
import { CommandExecutor, CommandContext, SelectCommand, CheckCommand, ClickCommand } from '../commands/index.js';
import { ActionRecord } from '../../../types/index.js';
import { NetworkManager } from '../../shared/network/NetworkManager.js';
import { LIMITS, TIMING } from '../config/constants.js';
import { BrowserPage } from '../adapters/BrowserPage.js';

/**
 * Context for filter exploration operations.
 */
export interface FilterExplorationContext {
    page: BrowserPage;
    targetUrl: string;
    outputDir: string;
    timestamp: string;
    screenshotBaseName: string;
    actionChain: ActionRecord[];
    networkManager?: NetworkManager;
}

export class FilterExplorer {
    /**
     * Phase 4.6: Filter Exploration
     * Samples filter controls (Select, Checkbox, Toggle, Radio).
     * Now integrated with Command Pattern for Golden Path tracking.
     */

    /**
     * Explore Select/Combobox options
     */
    static async exploreSelects(ctx: FilterExplorationContext): Promise<number> {
        const { page, targetUrl, outputDir, timestamp, screenshotBaseName, actionChain, networkManager } = ctx;
        console.log('[FilterExplorer] Exploring Select/Combobox...');

        const selects = await page.locator('select, [role="combobox"]').all();
        console.log(`[FilterExplorer] Found ${selects.length} select controls`);

        const executor = new CommandExecutor(
            { page, actionChain, networkManager },
            { maxRetries: 2, retryDelayMs: 300 }
        );

        let capturedCount = 0;

        for (let i = 0; i < Math.min(selects.length, 2); i++) {
            try {
                const select = selects[i];
                if (!await select.isVisible()) continue;

                const options = await select.locator('option').all();
                const sampleCount = Math.min(options.length, LIMITS.SELECT_OPTION_SAMPLES);

                for (let j = 0; j < sampleCount; j++) {
                    try {
                        // Use SelectCommand instead of direct selectOption
                        const command = new SelectCommand(select, {
                            index: j,
                            label: `Select option ${j + 1}`
                        });
                        await executor.execute(command);
                        await page.waitForTimeout(TIMING.FILTER_INTERACTION_DELAY);

                        const optionText = await options[j].innerText().catch(() => `option${j}`);
                        const screenshotPath = `${outputDir}/${screenshotBaseName}_select${i + 1}-${optionText.toLowerCase().replace(/\s+/g, '-')}_${timestamp}.webp`;

                        const pngBuffer = await page.screenshot({ fullPage: true });
                        await sharp(pngBuffer).webp({ quality: 80 }).toFile(screenshotPath);

                        console.log(`[FilterExplorer] ✓ Select: ${optionText}`);
                        capturedCount++;
                    } catch { /* skip */ }
                }

                // Reset page state
                await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => { });

            } catch (e) {
                console.error(`[FilterExplorer] Error on select ${i}:`, e);
            }
        }

        return capturedCount;
    }

    /**
     * Explore Checkboxes
     */
    static async exploreCheckboxes(ctx: FilterExplorationContext): Promise<number> {
        const { page, targetUrl, outputDir, timestamp, screenshotBaseName, actionChain, networkManager } = ctx;
        console.log('[FilterExplorer] Exploring Checkboxes...');

        const checkboxes = await page.locator('input[type="checkbox"]:visible').all();
        console.log(`[FilterExplorer] Found ${checkboxes.length} checkboxes`);

        const executor = new CommandExecutor(
            { page, actionChain, networkManager },
            { maxRetries: 2, retryDelayMs: 300 }
        );

        let capturedCount = 0;

        for (let i = 0; i < Math.min(checkboxes.length, LIMITS.CHECKBOX_SAMPLES); i++) {
            try {
                const checkbox = checkboxes[i];

                // Use CheckCommand instead of direct check()
                const command = new CheckCommand(checkbox, {
                    check: true,
                    label: `Checkbox ${i + 1}`
                });
                await executor.execute(command);
                await page.waitForTimeout(TIMING.FILTER_INTERACTION_DELAY);

                const screenshotPath = `${outputDir}/${screenshotBaseName}_checkbox${i + 1}-on_${timestamp}.webp`;

                const pngBuffer = await page.screenshot({ fullPage: true });
                await sharp(pngBuffer).webp({ quality: 80 }).toFile(screenshotPath);

                console.log(`[FilterExplorer] ✓ Checkbox ${i + 1}: ON`);
                capturedCount++;

                // Reset page state
                await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => { });

            } catch (e) {
                console.error(`[FilterExplorer] Error on checkbox ${i}:`, e);
            }
        }

        return capturedCount;
    }

    /**
     * Explore Toggle switches
     */
    static async exploreToggles(ctx: FilterExplorationContext): Promise<number> {
        const { page, targetUrl, outputDir, timestamp, screenshotBaseName, actionChain, networkManager } = ctx;
        console.log('[FilterExplorer] Exploring Toggles...');

        const toggles = await page.locator('[role="switch"], .toggle, .switch').all();
        console.log(`[FilterExplorer] Found ${toggles.length} toggles`);

        const executor = new CommandExecutor(
            { page, actionChain, networkManager },
            { maxRetries: 2, retryDelayMs: 300 }
        );

        let capturedCount = 0;

        for (let i = 0; i < Math.min(toggles.length, LIMITS.TOGGLE_SAMPLES); i++) {
            try {
                const toggle = toggles[i];
                if (!await toggle.isVisible()) continue;

                // Use ClickCommand for toggles (they're clicked to toggle)
                const command = new ClickCommand(toggle, {
                    label: `Toggle ${i + 1}`
                });
                await executor.execute(command);
                await page.waitForTimeout(TIMING.FILTER_INTERACTION_DELAY);

                const screenshotPath = `${outputDir}/${screenshotBaseName}_toggle${i + 1}_${timestamp}.webp`;

                const pngBuffer = await page.screenshot({ fullPage: true });
                await sharp(pngBuffer).webp({ quality: 80 }).toFile(screenshotPath);

                console.log(`[FilterExplorer] ✓ Toggle ${i + 1}`);
                capturedCount++;

                // Reset page state
                await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => { });

            } catch (e) {
                console.error(`[FilterExplorer] Error on toggle ${i}:`, e);
            }
        }

        return capturedCount;
    }

    /**
     * Explore Radio buttons
     */
    static async exploreRadios(ctx: FilterExplorationContext): Promise<number> {
        const { page, targetUrl, outputDir, timestamp, screenshotBaseName, actionChain, networkManager } = ctx;
        console.log('[FilterExplorer] Exploring Radio buttons...');

        const radios = await page.locator('input[type="radio"]:visible').all();
        console.log(`[FilterExplorer] Found ${radios.length} radio buttons`);

        const executor = new CommandExecutor(
            { page, actionChain, networkManager },
            { maxRetries: 2, retryDelayMs: 300 }
        );

        let capturedCount = 0;

        for (let i = 0; i < Math.min(radios.length, LIMITS.RADIO_SAMPLES); i++) {
            try {
                const radio = radios[i];

                // Use CheckCommand for radio buttons
                const command = new CheckCommand(radio, {
                    check: true,
                    label: `Radio ${i + 1}`
                });
                await executor.execute(command);
                await page.waitForTimeout(TIMING.FILTER_INTERACTION_DELAY);

                const screenshotPath = `${outputDir}/${screenshotBaseName}_radio${i + 1}_${timestamp}.webp`;

                const pngBuffer = await page.screenshot({ fullPage: true });
                await sharp(pngBuffer).webp({ quality: 80 }).toFile(screenshotPath);

                console.log(`[FilterExplorer] ✓ Radio ${i + 1}`);
                capturedCount++;

                // Reset page state
                await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => { });

            } catch (e) {
                console.error(`[FilterExplorer] Error on radio ${i}:`, e);
            }
        }

        return capturedCount;
    }
}
