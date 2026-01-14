import { BrowserContext, Route } from 'playwright';

export class NetworkManager {
    /**
     * Sets up selective header injection for target domains only.
     * Prevents CORS errors on 3rd party services (e.g. Cloudflare) by not injecting unknown headers.
     */
    async enableHeaderInjection(context: BrowserContext, companyId: string): Promise<void> {
        console.log(`[NetworkManager] 🛡️ Enabling safe header injection for Company: ${companyId}`);

        await context.route('**/*', async (route: Route) => {
            const request = route.request();
            const url = request.url();

            // Only inject for our endpoints
            // Matches: api-dev.ianai.co, stage.ianai.co, dev.ianai.co, etc.
            if (url.includes('ianai.co') || url.includes('localhost')) {
                const headers = await request.allHeaders();

                // Inject if not present (or overwrite if needed)
                headers['company-id'] = companyId;

                try {
                    await route.continue({ headers });
                } catch (e) {
                    // Ignore errors if request is already handled/closed
                }
            } else {
                // Pass through 3rd party requests untouched
                try {
                    await route.continue();
                } catch (e) { }
            }
        });
    }
}
