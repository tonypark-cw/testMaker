import { IExplorationPhase, PhaseResult } from './IExplorationPhase.js';
import { ExplorationContext } from './ExplorationContext.js';

export class NavigationPhase implements IExplorationPhase {
    readonly name = 'Navigation';

    async execute(context: ExplorationContext): Promise<PhaseResult> {
        const { page, url } = context;
        console.log(`[NavigationPhase] 🌐 Navigating to: ${url}`);

        try {
            // Initial Navigation
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });

            context.results.targetUrl = page.url();

            // SPA Route Interception
            console.log('[NavigationPhase] Setting up SPA route interception...');
            await page.evaluate(() => {
                if (!window.__discoveredRoutes) {
                    window.__discoveredRoutes = new Set<string>();
                }
                const methods = ['pushState', 'replaceState'] as const;
                for (const m of methods) {
                    const original = history[m];
                    history[m] = function (...args: any[]) {
                        if (args[2]) window.__discoveredRoutes?.add(args[2].toString());
                        return original.apply(this, args);
                    };
                }
            }, undefined);

            return { success: true };
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error(`[NavigationPhase] Navigation failed: ${errorMessage}`);
            return { success: false, error: errorMessage };
        }
    }
}
