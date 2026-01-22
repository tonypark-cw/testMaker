import * as fs from 'fs';
import * as path from 'path';
import * as lockfile from 'proper-lockfile';

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
    private sessionFilePath: string = path.join(process.cwd(), 'output', 'temp-auth.json');

    private constructor() {
<<<<<<< HEAD
        this.loadFromFile();
=======
        // In-memory only: Do not load from file
>>>>>>> 2fa101f ([Update] Revert internal phase authority changes and prepare for AI Agent authority config)
    }

    public static getInstance(): SessionManager {
        if (!SessionManager.instance) {
            SessionManager.instance = new SessionManager();
        }
        return SessionManager.instance;
    }

<<<<<<< HEAD
    /**
     * Acquire a global lock on the session file.
     * Use this to synchronize login or refresh operations across processes.
     */
    public async acquireLock(): Promise<() => Promise<void>> {
        const dir = path.dirname(this.sessionFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(this.sessionFilePath)) {
            fs.writeFileSync(this.sessionFilePath, JSON.stringify({}));
        }

        const MAX_RETRIES = 300; // Wait up to 60 seconds (300 * 200ms)
        let attempts = 0;

        while (attempts < MAX_RETRIES) {
            try {
                const release = await lockfile.lock(this.sessionFilePath, { retries: 0 });
                // [FIX] Immediately reload state after acquiring lock to get tokens from other processes
                this.loadFromFile();
                return release;
            } catch (e: any) {
                if (e.code === 'ELOCKED') {
                    if (attempts % 10 === 0) console.log('[SessionManager] ⏳ Waiting for global session lock...');
                    await new Promise(r => setTimeout(r, 200)); // Optimized: 200ms polling instead of 1000ms
                    attempts++;
                    continue;
                }
                throw e;
            }
        }
        throw new Error('Timeout waiting for global session lock');
    }

    /**
     * Set the handler function that performs the actual API call to refresh tokens.
     */
=======
    // Removed: setRefreshHandler (Not used in in-memory mode if we don't persist refresh tokens across restarts)
    // Actually, we usually need it for runtime refresh. Keeping consistent with previous interface.
>>>>>>> 2fa101f ([Update] Revert internal phase authority changes and prepare for AI Agent authority config)
    public setRefreshHandler(handler: RefreshHandler): void {
        this.refreshHandler = handler;
    }

    public setTokens(accessToken: string, refreshToken: string, expiresInSeconds: number): void {
        const expiresAt = Date.now() + (expiresInSeconds * 1000);
        this.state = {
            accessToken,
            refreshToken,
            expiresAt,
            isRefreshing: false
        };
        const expiresInMinutes = Math.floor(expiresInSeconds / 60);
<<<<<<< HEAD
        console.log(`[SessionManager] Tokens set (expires in ${expiresInMinutes}m, at ${new Date(expiresAt).toLocaleTimeString()})`);
        this.saveToFile();
    }

    private storageStatePath: string = '';

    /**
     * Set the file path for session persistence.
     */
    public setSessionFilePath(filePath: string): void {
        this.sessionFilePath = filePath;
        // storageState is saved as .storage.json in the same directory
        this.storageStatePath = filePath.replace('.json', '.storage.json');

        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        this.loadFromFile();
    }

    /**
     * Get the path for the Playwright storageState file.
     */
    public getStorageStatePath(): string | null {
        return this.storageStatePath || null;
    }

    /**
     * Check if a valid storageState file exists.
     */
    public hasStorageState(): boolean {
        return !!this.storageStatePath && fs.existsSync(this.storageStatePath);
=======
        console.log(`[SessionManager] Tokens set (In-Memory) (expires in ${expiresInMinutes}m)`);
>>>>>>> 2fa101f ([Update] Revert internal phase authority changes and prepare for AI Agent authority config)
    }

    public getTokens(): { accessToken: string; refreshToken: string } {
        return {
            accessToken: this.state.accessToken,
            refreshToken: this.state.refreshToken
        };
    }

    public async getAccessToken(): Promise<string> {
        if (this.refreshPromise) {
            return this.refreshPromise;
        }

        if (this.isExpiringSoon()) {
            return this.refreshTokens();
        }

        return this.state.accessToken;
    }

<<<<<<< HEAD
    /**
     * Force a token refresh (or join an existing one).
     * Uses file locking to prevent multiple processes from refreshing simultaneously.
     */
    public async refreshTokens(): Promise<string> {
        // Deduping within the same process
=======
    public async refreshTokens(): Promise<string> {
>>>>>>> 2fa101f ([Update] Revert internal phase authority changes and prepare for AI Agent authority config)
        if (this.refreshPromise) {
            return this.refreshPromise;
        }

<<<<<<< HEAD
=======
        if (!this.state.refreshToken) {
            // In-Memory mode: If we don't have a token, we can't refresh.
            // Caller should handle login.
            throw new Error('No refresh token available (In-Memory). Login required.');
        }

        if (!this.refreshHandler) {
            throw new Error('Refresh handler not configured');
        }

        this.state.isRefreshing = true;

>>>>>>> 2fa101f ([Update] Revert internal phase authority changes and prepare for AI Agent authority config)
        this.refreshPromise = (async () => {
            let release: (() => Promise<void>) | null = null;
            try {
                // Ensure output directory exists before locking
                const dir = path.dirname(this.sessionFilePath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                if (!fs.existsSync(this.sessionFilePath)) {
                    fs.writeFileSync(this.sessionFilePath, JSON.stringify({}));
                }

                // 1. Try to acquire the lock
                try {
                    release = await lockfile.lock(this.sessionFilePath, { retries: 5 });
                } catch (e) {
                    // If we can't get the lock, someone else is refreshing.
                    // Wait a bit and then reload from file.
                    console.log('[SessionManager] Concurrent refresh detected, waiting for lock...');
                    await new Promise(r => setTimeout(r, 2000));
                    this.loadFromFile();
                    if (!this.isExpiringSoon()) {
                        return this.state.accessToken;
                    }
                    // If still expiring soon after waiting, we might need to try again or fail
                    throw new Error('Concurrent session refresh took too long or failed');
                }

                // 2. Double check after getting lock - did someone already refresh?
                this.loadFromFile();
                if (!this.isExpiringSoon()) {
                    return this.state.accessToken;
                }

                // 3. Perform actual refresh
                if (!this.state.refreshToken) {
                    throw new Error('No refresh token available.');
                }

                if (!this.refreshHandler) {
                    throw new Error('Refresh handler not configured');
                }

                this.state.isRefreshing = true;
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
                            const delay = 1000 * Math.pow(2, attempt - 1);
                            console.warn(`[SessionManager] Refresh attempt ${attempt} failed. Retrying in ${delay}ms...`);
                            await new Promise(r => setTimeout(r, delay));
                        }
                    }
                }
                throw lastError;
            } finally {
                if (release) await release();
                this.state.isRefreshing = false;
                this.refreshPromise = null;
            }
        })();

        return this.refreshPromise;
    }

    private saveToFile(): void {
        try {
            const data = {
                accessToken: this.state.accessToken,
                refreshToken: this.state.refreshToken,
                expiresAt: this.state.expiresAt
            };
            fs.writeFileSync(this.sessionFilePath, JSON.stringify(data, null, 2), { mode: 0o600 });
        } catch (e) {
            console.error('[SessionManager] Failed to save session to file:', e);
        }
    }

    private loadFromFile(): void {
        try {
            if (fs.existsSync(this.sessionFilePath)) {
                const content = fs.readFileSync(this.sessionFilePath, 'utf8');
                const data = JSON.parse(content);
                if (data.accessToken) {
                    this.state.accessToken = data.accessToken;
                    this.state.refreshToken = data.refreshToken;
                    this.state.expiresAt = data.expiresAt;
                    console.log(`[SessionManager] Loaded session from file (Expires at: ${new Date(this.state.expiresAt).toLocaleTimeString()})`);
                }
            }
        } catch (e) {
            console.warn('[SessionManager] Failed to load session from file:', e);
        }
    }

    public hasValidSession(): boolean {
        this.loadFromFile(); // Always check latest state
        return this.state.accessToken !== '' && !this.isExpiringSoon();
    }

    public isExpiringSoon(): boolean {
        if (!this.state.accessToken) return true;
        const now = Date.now();
        // const timeRemaining = this.state.expiresAt - now;
        const isExpiring = now + this.REFRESH_THRESHOLD_MS >= this.state.expiresAt;
        return isExpiring;
    }

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
