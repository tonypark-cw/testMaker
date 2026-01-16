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
        this.state = {
            accessToken,
            refreshToken,
            expiresAt: Date.now() + (expiresInSeconds * 1000),
            isRefreshing: false
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
                const result = await this.refreshHandler!(this.state.refreshToken);
                this.setTokens(result.accessToken, result.refreshToken, result.expiresIn);
                return result.accessToken;
            } finally {
                this.state.isRefreshing = false;
                this.refreshPromise = null;
            }
        })();

        return this.refreshPromise;
    }

    public isExpiringSoon(): boolean {
        if (!this.state.accessToken) return true;
        return Date.now() + this.REFRESH_THRESHOLD_MS >= this.state.expiresAt;
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
