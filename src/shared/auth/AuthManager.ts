import { Page, BrowserContext } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { ScraperConfig } from '../types.js';
import { NetworkManager } from '../network/NetworkManager.js';
import { RecoveryManager } from '../network/RecoveryManager.js';

export interface TokenRefreshResult {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}

export type RefreshHandler = (refreshToken: string) => Promise<TokenRefreshResult>;

interface TokenState {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    isRefreshing: boolean;
}

/**
 * AuthManager
 * Handles the logic for logging into the application and validating the session.
 */
export class AuthManager {
    private state: TokenState = {
        accessToken: '',
        refreshToken: '',
        expiresAt: 0,
        isRefreshing: false
    };

    private refreshPromise: Promise<string> | null = null;
    private refreshHandler: RefreshHandler | null = null;
    private readonly REFRESH_THRESHOLD_MS = 60 * 1000;

    constructor(
        private config: ScraperConfig,
        private networkManager: NetworkManager,
        private recoveryManager: RecoveryManager,
        private outputDir: string
    ) { }

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
        console.log(`[AuthManager] Tokens set in-memory (expires in ${expiresInMinutes}m)`);
    }

    public getTokens() {
        return {
            accessToken: this.state.accessToken,
            refreshToken: this.state.refreshToken
        };
    }

    public async getAccessToken(): Promise<string> {
        if (this.refreshPromise) return this.refreshPromise;
        if (this.isExpiringSoon()) return this.refreshTokens();
        return this.state.accessToken;
    }

    private isExpiringSoon(): boolean {
        if (!this.state.accessToken) return true;
        return Date.now() + this.REFRESH_THRESHOLD_MS >= this.state.expiresAt;
    }

    public async refreshTokens(): Promise<string> {
        if (this.refreshPromise) return this.refreshPromise;

        if (!this.state.refreshToken) {
            throw new Error('No refresh token available for in-memory refresh.');
        }

        if (!this.refreshHandler) {
            throw new Error('Refresh handler not configured in AuthManager');
        }

        this.state.isRefreshing = true;
        this.refreshPromise = (async () => {
            try {
                console.log('[AuthManager] Starting token refresh...');
                const result = await this.refreshHandler!(this.state.refreshToken);
                this.setTokens(result.accessToken, result.refreshToken, result.expiresIn);
                return result.accessToken;
            } catch (e) {
                console.error('[AuthManager] Token refresh failed:', e);
                throw e;
            } finally {
                this.state.isRefreshing = false;
                this.refreshPromise = null;
            }
        })();

        return this.refreshPromise;
    }

    /**
     * Performs login on the target page.
     */
    public async performLogin(page: Page, context: BrowserContext): Promise<boolean> {
        try {
            console.log('[AuthManager] Navigating to target for login...');
            await page.goto(this.config.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => {
                console.error(`[AuthManager] Initial navigation failed: ${e.message}`);
                if (e.message.includes('ERR_CONNECTION_REFUSED')) {
                    console.warn('[AuthManager] ⚠️ Server reachable check failed (Connection Refused).');
                }
                throw e;
            });

            // 1. Setup Network Listeners for Error Detection (After initial load to avoid interruption)
            this.setupListeners(page);

            const emailLocator = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i], input[type="text"]').first();
            const passwordLocator = page.locator('input[type="password"], input[name="password"], input[placeholder*="password" i]').first();

            await emailLocator.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });

            const emailVisible = await emailLocator.isVisible().catch(() => false);
            const passwordVisible = await passwordLocator.isVisible().catch(() => false);

            if (emailVisible && passwordVisible) {
                console.log('[AuthManager] Login form detected.');

                if (this.config.username && this.config.password) {
                    console.log(`[AuthManager] Attempting auto-login for: ${this.config.username}`);

                    await emailLocator.fill(this.config.username);
                    await passwordLocator.fill(this.config.password);

                    const submitBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("Log in"), button:has-text("Sign in"), button:has-text("로그인")').first();

                    if (await submitBtn.isVisible().catch(() => false)) {
                        if (process.env.INJECT_CUSTOM_HEADERS === 'true') {
                            await this.injectCompanyId(context);
                        }

                        await page.waitForTimeout(300);
                        await submitBtn.click();
                        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });

                        // [CRITICAL] Wait for SPA to process login and set tokens
                        console.log('[AuthManager] Waiting for post-login token generation...');
                        await page.waitForTimeout(5000);

                        // 1. First capture tokens (poll until available)
                        const tokensCaptured = await this.captureTokens(page);

                        // 2. Then capture full session state (includes cookies & now populated localStorage)
                        const cookieCaptured = await this.captureSessionState(context);

                        console.log(`[AuthManager] Session capture result: tokens=${tokensCaptured}, cookies=${cookieCaptured}`);

                        if (process.env.CLEAR_LOGIN_FIELDS === 'true') {
                            await emailLocator.fill('').catch(() => { });
                            await passwordLocator.fill('').catch(() => { });
                            console.log('[AuthManager] ✓ Cleared login form fields');
                        }

                        await page.waitForTimeout(1000);
                        const verified = await this.verifyLogin(page, context, passwordLocator);
                        return verified;
                    } else {
                        console.log('[AuthManager] Submit button not found.');
                        return false;
                    }
                } else if (!this.config.headless) {
                    console.log('[AuthManager] No credentials. Waiting for manual login...');
                    await page.pause();
                    return true;
                } else {
                    console.log('[AuthManager] No credentials and headless. Skipping login.');
                    return true;
                }
            } else {
                console.log('[AuthManager] No login form detected. Verifying active session...');
                const hasAppShell = await page.locator('nav, aside, .sidebar, [role="navigation"], .navBar').first().isVisible({ timeout: 5000 }).catch(() => false);

                if (hasAppShell) {
                    console.log('[AuthManager] ✓ Active session confirmed (App Shell detected).');
                    return true;
                } else {
                    console.error('[AuthManager] ❌ No login form AND no app shell detected. Possible 404 or unauthenticated state.');
                    // Take a debug screenshot
                    const debugPath = path.join(this.outputDir, 'auth-failed-debug.png');
                    await page.screenshot({ path: debugPath }).catch(() => { });
                    return false;
                }
            }
        } catch (e) {
            console.log(`[AuthManager] Login error: ${(e as Error).message}`);
            return false;
        }
    }

    /**
     * Setup network response/failure listeners
     */
    private setupListeners(page: Page) {
        page.on('response', async response => {
            if (response.status() >= 400 && (response.url().includes('login') || response.url().includes('auth') || response.url().includes('api'))) {
                console.log(`[Network] ${response.status()} Error on: ${response.url()}`);
                await this.recoveryManager.checkAndTriggerRecovery(page);

                try {
                    const body = await response.text();
                    if (body.includes('connection refused') || body.includes('dial tcp')) {
                        console.warn('\n[AuthManager] ⚠️ WARNING: Backend Connection Refused.');
                    }
                } catch { /* ignore */ }
            }
        });

        page.on('requestfailed', request => {
            const failure = request.failure();
            if (failure && (failure.errorText.includes('connection refused') || failure.errorText.includes('net::ERR_CONNECTION_REFUSED'))) {
                console.warn(`\n[AuthManager] ⚠️ WARNING: Network Request Failed: ${request.url()}`);
            }
        });
    }

    /**
     * Inject Company ID based on environment
     */
    private async injectCompanyId(context: BrowserContext) {
        let targetCompanyId = '';
        const url = this.config.url.toLowerCase();

        if (url.includes('stage.ianai.co')) {
            targetCompanyId = process.env.COMPANY_ID_STAGE || '';
            console.log('[AuthManager] Environment: STAGE detected');
        } else if (url.includes('dev.ianai.co')) {
            targetCompanyId = process.env.COMPANY_ID_DEV || '';
            console.log('[AuthManager] Environment: DEV detected');
        }

        if (targetCompanyId) {
            await this.networkManager.enableHeaderInjection(context, targetCompanyId);
        } else {
            console.log('[AuthManager] ⚠️ No matching Company ID found.');
        }
    }

    /**
     * Verify if login was successful
     */
    private async verifyLogin(page: Page, context: BrowserContext, passwordLocator: any): Promise<boolean> {
        // Ensure we have valid tokens (triggers refresh if we only have a refresh_token)
        try {
            const token = await this.getAccessToken();
            console.log(`[AuthManager] Token verification: ${token ? 'ACTIVE' : 'MISSING'}`);
        } catch (e) {
            console.error('[AuthManager] Token refresh failed during verification:', e);
            // Don't return false yet, the page shell might still be visible
        }

        const currentUrl = page.url();
        const safeLogUrl = currentUrl.replace(/\/\/.*@/, '//***@');
        console.log(`[AuthManager] Post-login URL: ${safeLogUrl}`);

        // Force navigation if stuck on intermediate pages
        if (currentUrl.includes('/app/logged-in') || currentUrl.endsWith('/app') || currentUrl.endsWith('/app/')) {
            console.log('[AuthManager] Forcing navigation to /app/home...');
            await page.goto(new URL('/app/home', this.config.url).toString(), { waitUntil: 'networkidle', timeout: 30000 }).catch(() => { });
            // [OPTIMIZATION] Reduced wait from 3s to 1s - networkidle already ensures page is ready
            await page.waitForTimeout(1000);
        }

        // [FIX] Re-query locators after potential navigation to avoid detached element errors
        const finalPasswordLocator = page.locator('input[type="password"], input[name="password"], input[placeholder*="password" i]').first();
        const stillOnLogin = await finalPasswordLocator.isVisible().catch(() => false);
        const hasDashboard = await page.locator('nav, aside, .sidebar, [role="navigation"], .navBar').first().isVisible().catch(() => false);

        const hasDashboardWelcome = await page.evaluate(() => {
            const headers = Array.from(document.querySelectorAll('h1, h2, h3, .welcome-text'));
            return headers.some(h => {
                const text = h.textContent?.trim() || '';
                return /^Welcome[, ]/i.test(text) || (text.toLowerCase() === 'welcome' && !text.includes('welcome to'));
            });
        }).catch(() => false);

        const hasLoginSuccess = await page.getByText('Login successful', { exact: false }).isVisible().catch(() => false);

        const isVerifyPassed = !stillOnLogin && (hasDashboard || (hasDashboardWelcome && hasLoginSuccess));

        if (!isVerifyPassed) {
            console.log('[AuthManager] WARNING: Login verification failed.');
            const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 150));
            console.log(`[AuthManager] Page state: ${bodyText.replace(/\n/g, ' ')}...`);
            return false;
        } else {
            console.log('[AuthManager] Login successful and verification passed!');
            const tempAuthFile = path.join(this.outputDir, 'temp-auth.json');
            await context.storageState({ path: tempAuthFile });
            console.log(`[AuthManager] Session saved to ${tempAuthFile}`);
            return true;
        }
    }

    /**
     * Restore session state to browser (both cookies and localStorage)
     */
    private async restoreSessionState(context: BrowserContext, page: Page, tokens: { accessToken: string, refreshToken: string }): Promise<void> {
        console.log('[AuthManager] Restoring session state (cookies + localStorage)...');

        try {
            // 1. Restore cookies (for cookie-based auth)
            if (tokens.refreshToken) {
                const urlObj = new URL(this.config.url);
                const apiDomain = urlObj.hostname.replace(/^(stage|dev)\./, '.api-$1.');

                await context.addCookies([{
                    name: 'refresh_token',
                    value: tokens.refreshToken,
                    domain: apiDomain,
                    path: '/v2/user',
                    httpOnly: true,
                    secure: true,
                    sameSite: 'None',
                    expires: Math.floor(Date.now() / 1000) + 86400 * 7
                }]);
                console.log('[AuthManager] ✓ Cookies restored');
            }

            // 2. Restore localStorage (for token-based auth) - only on valid app pages
            if (tokens.accessToken && page.url() !== 'about:blank' && !page.url().includes('chrome://')) {
                try {
                    await page.evaluate(({ access, refresh }) => {
                        localStorage.setItem('accessToken', access);
                        localStorage.setItem('refreshToken', refresh);
                        sessionStorage.setItem('accessToken', access);
                        sessionStorage.setItem('refreshToken', refresh);
                    }, { access: tokens.accessToken, refresh: tokens.refreshToken });
                    console.log('[AuthManager] ✓ localStorage restored');
                } catch (e) {
                    console.log('[AuthManager] ℹ️ localStorage not available on this page (cookies will be used)');
                }
            }
        } catch (e) {
            console.warn('[AuthManager] Failed to restore session:', e);
        }
    }

    /**
     * Capture session state (cookies + localStorage) and save to shared session file
     */
    private async captureSessionState(context: BrowserContext): Promise<boolean> {
        console.log('[AuthManager] Capturing session state to in-memory store...');

        try {
            const cookies = await context.cookies();
            const refreshCookie = cookies.find(c => c.name === 'refresh_token');

            if (refreshCookie) {
                // Tokens already handled by captureTokens. 
                // We just return true to indicate session state is present via cookies.
                return true;
            }

            return false;
        } catch (e) {
            console.error('[AuthManager] Failed to capture session state:', e);
            return false;
        }
    }
    private async captureTokens(page: Page): Promise<boolean> {
        console.log('[AuthManager] Starting token capture from browser storage...');
        let attempts = 0;
        const maxAttempts = 15;

        while (attempts < maxAttempts) {
            const tokens = await page.evaluate(() => {
                // 1. Check direct keys
                const directAccess = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken');
                const directRefresh = localStorage.getItem('refreshToken') || sessionStorage.getItem('refreshToken');
                if (directAccess && directRefresh) return { access: directAccess, refresh: directRefresh };

                // 2. Check nested keys (search all storage)
                const findInStorage = (storage: Storage) => {
                    for (let i = 0; i < storage.length; i++) {
                        const key = storage.key(i);
                        if (!key) continue;
                        try {
                            const val = JSON.parse(storage.getItem(key) || '');
                            if (val && typeof val === 'object') {
                                // Common nested patterns
                                const access = val.accessToken || val.access_token || val.token || (val.state && val.state.accessToken);
                                const refresh = val.refreshToken || val.refresh_token || (val.state && val.state.refreshToken);
                                if (access && refresh) return { access, refresh };
                            }
                        } catch (e) { /* not JSON */ }
                    }
                    return null;
                };

                return findInStorage(localStorage) || findInStorage(sessionStorage) || { access: '', refresh: '' };
            }).catch(() => ({ access: '', refresh: '' }));

            // 1. Success via Storage
            if (tokens.access && tokens.refresh) {
                this.setTokens(tokens.access, tokens.refresh, 3600);
                console.log('[AuthManager] ✓ Tokens successfully captured from Storage (nested or direct)');
                return true;
            }

            // [DEBUG] Capture all keys for analysis
            const allKeys = await page.evaluate(() => {
                return {
                    local: Object.keys(localStorage),
                    session: Object.keys(sessionStorage)
                };
            }).catch(() => ({ local: [], session: [] }));

            console.log(`[AuthManager-Debug] Attempt ${attempts + 1}: Local: [${allKeys.local.join(', ')}], Session: [${allKeys.session.join(', ')}]`);

            // 2. Fallback: Check Cookies immediately
            const cookies = await page.context().cookies();

            // [DEBUG] Log all cookie names and domains
            const cookieInfo = cookies.map(c => `${c.name} (${c.domain})`);
            console.log(`[AuthManager-Debug] Available Cookies: ${cookieInfo.join(', ')}`);

            const refreshCookie = cookies.find(c => c.name === 'refresh_token' || c.name.includes('refresh') || c.name.includes('token'));

            if (refreshCookie) {
                // If only refresh token found, set expires to 0 to force an immediate refresh attempt
                // during verification or first worker call.
                this.setTokens('', refreshCookie.value, 0);
                console.log(`[AuthManager] ✓ Refresh Token captured from Cookie: ${refreshCookie.name}. (Access token empty, refresh queued)`);
                return true;
            }

            console.log(`[AuthManager] Token capture attempt ${attempts + 1}: Waiting for tokens...`);
            await page.waitForTimeout(1000);
            attempts++;
        }

        console.warn('[AuthManager] ⚠️ Failed to capture tokens from Storage or Cookies after attempts');
        return false;
    }
}
