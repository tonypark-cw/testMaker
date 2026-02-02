import { BrowserContext, Route } from 'playwright';
import { TransactionPayload } from '../../types/index.js';

export interface AuthProvider {
    getTokens(): { accessToken: string; refreshToken: string };
    getAccessToken(): Promise<string>;
}

export class NetworkManager {
    private rateLimitUntil: number = 0;
    private consecutive429Count: number = 0;
    private consecutiveSuccessCount: number = 0;

    // Token caching to reduce SessionManager queries
    private cachedToken: string = '';
    private lastTokenCheckTime: number = 0;
    private readonly TOKEN_CACHE_DURATION_MS = 5000; // 5 seconds

    private authProvider: AuthProvider | null = null;

    public setAuthProvider(provider: AuthProvider): void {
        this.authProvider = provider;
    }

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
                try {
                    const now = Date.now();

                    // Only check token if we don't have one or cache expired
                    if (!this.cachedToken || (now - this.lastTokenCheckTime > this.TOKEN_CACHE_DURATION_MS)) {
                        if (this.authProvider) {
                            const tokens = this.authProvider.getTokens();

                            // Only call getAccessToken if tokens are initialized
                            if (tokens.accessToken && tokens.refreshToken) {
                                this.cachedToken = await this.authProvider.getAccessToken();
                                this.lastTokenCheckTime = now;
                            }
                        }
                    }

                    if (this.cachedToken) {
                        // [FIX] Prevent duplicate headers by checking case-insensitively
                        const authKey = Object.keys(headers).find(k => k.toLowerCase() === 'authorization') || 'Authorization';
                        const companyKey = Object.keys(headers).find(k => k.toLowerCase() === 'company-id') || 'company-id';

                        // Only inject if not already present or if we want to force-override (currently force-overriding to ensure validity)
                        headers[authKey] = `Bearer ${this.cachedToken}`;
                        headers[companyKey] = companyId;
                    }
                } catch (_e) { /* Token may not be available yet */ }

                try {
                    await route.continue({ headers });
                } catch (_e) { /* Continue fails if already handled */ }
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
    /**
     * [Phase 8] Block specifically failing requests (e.g. invalid refresh tokens)
     * [DEPRECATED] Removed legacy BLOCK_REFRESH_TOKEN logic.
     */
    async setupRequestBlocking(context: BrowserContext) {
        // Legacy blocking logic removed as AuthManager now handles refreshes robustly.
    }

    private currentAction: string | null = null;

    public setCurrentAction(action: string | null) {
        this.currentAction = action;
    }

    /**
     * [Phase 2] Capture transaction-like API requests and responses for schema extraction.
     */
    setupTransactionCapturer(context: BrowserContext, onCapture: (type: 'req' | 'res', module: string, uuid: string, data: TransactionPayload, triggerAction?: string | null) => void) {
        // 1. Capture Requests (POST/PUT/PATCH)
        context.on('request', async request => {
            const url = request.url();
            const method = request.method();

            if (['POST', 'PUT', 'PATCH'].includes(method) && (url.includes('ianai-dev.com') || url.includes('ianai.co'))) {
                // Ignore noise like audit logs
                if (url.includes('auditlog')) return;

                const match = url.match(/\/v2\/(.+)\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(\?.*)?$/i);
                if (match) {
                    const module = match[1];
                    const uuid = match[2];
                    try {
                        const postData = request.postDataJSON();
                        if (postData) {
                            onCapture('req', module, uuid, postData, this.currentAction);
                        }
                    } catch (e) { /* Not JSON or no data */ }
                }
            }
        });

        // 2. Capture Responses (GET/POST/PUT 200 OK)
        context.on('response', async response => {
            const url = response.url();
            const status = response.status();

            if (status === 200 && (url.includes('ianai-dev.com') || url.includes('ianai.co'))) {
                if (url.includes('auditlog')) return;

                const match = url.match(/\/v2\/(.+)\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(\?.*)?$/i);

                if (match) {
                    const module = match[1];
                    const uuid = match[2];

                    try {
                        const contentType = response.headers()['content-type'] || '';
                        if (contentType.includes('application/json')) {
                            const data = await response.json();
                            onCapture('res', module, uuid, data, this.currentAction);
                        }
                    } catch (e) { /* ignore */ }
                }
            }
        });
    }
}
