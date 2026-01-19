export interface TokenState {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    isRefreshing: boolean;
}

export type TokenRefreshResult = {
    accessToken: string;
    refreshToken: string;
    expiresIn: number; // Seconds
};

export type RefreshHandler = (refreshToken: string) => Promise<TokenRefreshResult>;

export class SessionManager {
    private static instance: SessionManager;

    private state: TokenState = {
        accessToken: '',
        refreshToken: '',
        expiresAt: 0,
        isRefreshing: false
    };

    private refreshPromise: Promise<string> | null = null;
    private refreshHandler: RefreshHandler | null = null;
    private readonly REFRESH_THRESHOLD_MS = 60 * 1000; // Refresh 60s before expiry

    private constructor() { }

    public static getInstance(): SessionManager {
        if (!SessionManager.instance) {
            SessionManager.instance = new SessionManager();
        }
        return SessionManager.instance;
    }

    /**
     * Set the handler function that performs the actual API call to refresh tokens.
     */
    public setRefreshHandler(handler: RefreshHandler): void {
        this.refreshHandler = handler;
    }

    /**
     * Initialize or update tokens manually.
     * @param accessToken New access token
     * @param refreshToken New refresh token
     * @param expiresInSeconds Expiration time in seconds from now
     */
    public setTokens(accessToken: string, refreshToken: string, expiresInSeconds: number): void {
        const expiresAt = Date.now() + (expiresInSeconds * 1000);
        this.state = {
            accessToken,
            refreshToken,
            expiresAt,
            isRefreshing: false
        };
        const expiresInMinutes = Math.floor(expiresInSeconds / 60);
        console.log(`[SessionManager] Tokens set (expires in ${expiresInMinutes}m, at ${new Date(expiresAt).toLocaleTimeString()})`);
    }

    /**
     * Get current raw tokens.
     */
    public getTokens(): { accessToken: string; refreshToken: string } {
        return {
            accessToken: this.state.accessToken,
            refreshToken: this.state.refreshToken
        };
    }

    /**
     * Get a valid access token. Triggers refresh if expiring soon.
     * Waits for pending refresh if one is in progress.
     */
    public async getAccessToken(): Promise<string> {
        // 1. If refreshing, wait for it
        if (this.refreshPromise) {
            return this.refreshPromise;
        }

        // 2. Check if expired or expiring soon
        if (this.isExpiringSoon()) {
            return this.refreshTokens();
        }

        // 3. Return valid token
        return this.state.accessToken;
    }

    /**
     * Force a token refresh (or join an existing one).
     */
    public async refreshTokens(): Promise<string> {
        // Deduping: Return existing promise if already refreshing
        if (this.refreshPromise) {
            return this.refreshPromise;
        }

        if (!this.state.refreshToken) {
            throw new Error('No refresh token available');
        }

        if (!this.refreshHandler) {
            throw new Error('Refresh handler not configured');
        }

        this.state.isRefreshing = true;

        // Create the promise that subsequent callers will await
        this.refreshPromise = (async () => {
            try {
                let lastError: any;
                const maxAttempts = 3;

                for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                    try {
                        const result = await this.refreshHandler!(this.state.refreshToken);
                        this.setTokens(result.accessToken, result.refreshToken, result.expiresIn);
                        return result.accessToken;
                    } catch (e) {
                        lastError = e;
                        if (attempt < maxAttempts) {
                            const delay = 1000 * Math.pow(2, attempt - 1); // 1s, 2s
                            console.warn(`[SessionManager] Refresh attempt ${attempt} failed. Retrying in ${delay}ms...`);
                            await new Promise(r => setTimeout(r, delay));
                        }
                    }
                }
                console.error('[SessionManager] All refresh attempts failed.');
                throw lastError;
            } finally {
                this.state.isRefreshing = false;
                this.refreshPromise = null;
            }
        })();

        return this.refreshPromise;
    }

    public isExpiringSoon(): boolean {
        if (!this.state.accessToken) return true;
        const now = Date.now();
        const timeRemaining = this.state.expiresAt - now;
        const isExpiring = now + this.REFRESH_THRESHOLD_MS >= this.state.expiresAt;
        if (isExpiring) {
            console.log(`[SessionManager] Token expiring soon (${Math.floor(timeRemaining / 1000)}s remaining)`);
        }
        return isExpiring;
    }

    /**
     * For testing purposes: Reset singleton state
     */
    public _reset(): void {
        this.state = {
            accessToken: '',
            refreshToken: '',
            expiresAt: 0,
            isRefreshing: false
        };
        this.refreshPromise = null;
        this.refreshHandler = null;
    }
}
