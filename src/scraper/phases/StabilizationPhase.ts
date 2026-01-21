import { IExplorationPhase, PhaseResult } from './IExplorationPhase.js';
import { ExplorationContext } from './ExplorationContext.js';
import { TIMING } from '../config/constants.js';

export class StabilizationPhase implements IExplorationPhase {
    readonly name = 'Stabilization';

    async execute(context: ExplorationContext): Promise<PhaseResult> {
        const { page } = context;
        console.log('[StabilizationPhase] ⏳ Waiting for page stability...');

        // 1. Wait for root element and minimum content length
        await page.waitForFunction(() => {
            const root = document.querySelector('#root');
            return !!(root && root.innerHTML.length > 1000);
        }, undefined).catch(() => { });

        // 2. Wait for navigation markers
        await page.waitForSelector('aside, nav, [class*="sidebar"], [class*="nav"]', { timeout: 15000 }).catch(() => {
            console.warn('[StabilizationPhase] ⚠️ Warning: Navigation markers (aside/nav) not found.');
        });

        // 3. Wait for loaders to disappear
        await page.waitForFunction(() => {
            const loaders = ['.mantine-Loader-root', '.loader', '.spinner', '.loading', '[aria-busy="true"]', '.ant-spin', '.nprogress-bar'];
            for (const selector of loaders) {
                const el = document.querySelector(selector);
                if (el) {
                    const style = window.getComputedStyle(el);
                    if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0) {
                        return false;
                    }
                }
            }
            return true;
        }, { timeout: 5000 }).catch(() => { });

        // 4. DOM mutation stability (wait for silence)
        await page.evaluate((delay) => {
            return new Promise<void>(resolve => {
                let timer: ReturnType<typeof setTimeout>;
                const observer = new MutationObserver(() => {
                    clearTimeout(timer);
                    timer = setTimeout(() => { observer.disconnect(); resolve(); }, delay ?? 500);
                });
                observer.observe(document.body, { childList: true, subtree: true });
                timer = setTimeout(() => { observer.disconnect(); resolve(); }, 4000); // Max wait
            });
        }, TIMING.DOM_STABILITY_WAIT);

        return { success: true };
    }
}
