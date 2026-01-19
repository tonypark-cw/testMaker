import { BrowserContext, Route } from 'playwright';
import { SessionManager } from './SessionManager.js';

export class NetworkManager {
    private rateLimitUntil: number = 0;
    private consecutive429Count: number = 0;
    private consecutiveSuccessCount: number = 0;

    // Token caching to reduce SessionManager queries
    private cachedToken: string = '';
    private lastTokenCheckTime: number = 0;
    private readonly TOKEN_CACHE_DURATION_MS = 5000; // 5 seconds

    public getRateLimitUntil(): number { return this.rateLimitUntil; }
    public resetRateLimit(): void {
        this.rateLimitUntil = 0;
        this.consecutive429Count = 0;
    }
    /**
     * Sets up selective header injection for target domains only.
     * Prevents CORS errors on 3rd party services (e.g. Cloudflare) by not injecting unknown headers.
     */
    /**
     * Sets up selective header injection for target domains only.
     */
    async enableHeaderInjection(context: BrowserContext, companyId: string): Promise<void> {
        console.log(`[NetworkManager] 🛡️ Enabling safe header injection for Company: ${companyId}`);

        await context.route('**/*', async (route: Route) => {
            // [NEW] Global Request Stalling
            while (Date.now() < this.rateLimitUntil) {
                await new Promise(r => setTimeout(r, 1000));
            }

            const request = route.request();
            const url = request.url();

            if (url.includes('ianai-dev.com') || url.includes('ianai.co') || url.includes('localhost')) {
                const headers = await request.allHeaders();
                headers['company-id'] = companyId;

                try {
                    // Use cached token to reduce SessionManager queries
                    const now = Date.now();

                    // Only check token if we don't have one or cache expired
                    if (!this.cachedToken || (now - this.lastTokenCheckTime > this.TOKEN_CACHE_DURATION_MS)) {
                        const sessionMgr = SessionManager.getInstance();
                        const tokens = sessionMgr.getTokens();

                        // Only call getAccessToken if tokens are initialized
                        if (tokens.accessToken && tokens.refreshToken) {
                            this.cachedToken = await sessionMgr.getAccessToken();
                            this.lastTokenCheckTime = now;
                        }
                    }

                    if (this.cachedToken) {
                        headers['Authorization'] = `Bearer ${this.cachedToken}`;
                    }
                } catch (e) { /* Token may not be available yet */ }

                try {
                    await route.continue({ headers });
                } catch (e) { /* Continue fails if already handled */ }
            } else {
                try {
                    await route.continue();
                } catch (e) { /* Route might be closed */ }
            }
        });
    }

    /**
     * [Phase 8] Centralized 429 Error Handler
     */
    setupRateLimitHandler(context: BrowserContext, callbacks: {
        on429: (url: string, method: string, delay: number, count: number, isDeepSleep: boolean) => void,
        onRecovery: (count: number) => void
    }) {
        context.on('response', async response => {
            const url = response.url();
            const status = response.status();
            const method = response.request().method();

            if (status === 429) {
                this.consecutive429Count++;
                this.consecutiveSuccessCount = 0;

                // [TIERED BACKOFF]
                const baseDelay = 30000; // Start with 30s
                const multiplier = Math.pow(2, this.consecutive429Count - 1);
                const delay = Math.min(baseDelay * multiplier, 1800000); // Max 30 mins

                const isDeepSleep = this.consecutive429Count >= 8;
                const finalDelay = isDeepSleep ? 1800000 : delay;

                this.rateLimitUntil = Date.now() + finalDelay;

                callbacks.on429(url, method, finalDelay, this.consecutive429Count, isDeepSleep);
            } else if (status >= 200 && status < 400) {
                const isStatic = /\.(png|jpg|jpeg|gif|webp|svg|css|woff|woff2|ttf|ico)$/i.test(url);
                if (!isStatic) {
                    this.consecutiveSuccessCount++;
                }

                // [RECOVERY] Reset after 10 clean successes (was 50)
                if (this.consecutive429Count > 0 && this.consecutiveSuccessCount >= 10) {
                    this.consecutive429Count = 0;
                    this.consecutiveSuccessCount = 0;
                    this.rateLimitUntil = 0;
                    callbacks.onRecovery(10);
                }
            }
        });
    }

    /**
     * [Phase 8] Block specifically failing requests (e.g. invalid refresh tokens)
     */
    async setupRequestBlocking(context: BrowserContext) {
        if (process.env.BLOCK_REFRESH_TOKEN !== 'false') {
            let tokenRequestCount = 0;
            const tokenRequestTimestamps: number[] = [];

            await context.route('**/v2/user/token', route => {
                tokenRequestCount++;
                const now = Date.now();
                tokenRequestTimestamps.push(now);

                const timeSinceLastRequest = tokenRequestTimestamps.length > 1
                    ? now - tokenRequestTimestamps[tokenRequestTimestamps.length - 2]
                    : 0;

                console.log(`[NetworkManager] 🔄 Blocked refresh token request #${tokenRequestCount} (${(timeSinceLastRequest / 1000).toFixed(1)}s since last)`);
                route.abort();
            });
        }
    }
}
