import { Page, BrowserContext } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { ScraperConfig } from '../types.js';
import { NetworkManager } from '../network/NetworkManager.js';
import { RecoveryManager } from '../network/RecoveryManager.js';
import { SessionManager } from './SessionManager.js';

/**
 * AuthManager
 * Handles the logic for logging into the application and validating the session.
 */
export class AuthManager {
    constructor(
        private config: ScraperConfig,
        private networkManager: NetworkManager,
        private recoveryManager: RecoveryManager,
        private outputDir: string
    ) { }

    /**
     * Performs login on the target page.
     */
    public async performLogin(page: Page, context: BrowserContext): Promise<boolean> {
        const sessionManager = SessionManager.getInstance();

        // [PHASE 4] Global Auth Mutex: Ensure only one process logs in at a time
        const release = await sessionManager.acquireLock().catch(() => null);

        try {
            // Check again after acquiring lock (another process might have logged in while we waited)
            const tokens = sessionManager.getTokens();

            if (sessionManager.hasValidSession()) {
                console.log('[AuthManager] ✓ Valid session found after lock acquisition. Restoring browser state...');

                // Session is already restored via Runner.ts context creation
                console.log('[AuthManager] ✓ Session detected. Skipping login flow.');

                if (process.env.INJECT_CUSTOM_HEADERS === 'true') {
                    await this.injectCompanyId(context);
                }
                return true;
            }

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
        } finally {
            if (release) await release();
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
        console.log('[AuthManager] Capturing session state to shared file...');
        const sessionManager = SessionManager.getInstance();

        try {
            // 1. Save full storage state (Cookies + LocalStorage)
            const storagePath = sessionManager.getStorageStatePath();
            if (storagePath) {
                await context.storageState({ path: storagePath });
                console.log(`[AuthManager] ✓ Full storage state saved to ${storagePath}`);
            }

            // 2. Also update in-memory tokens if cookie-based
            const cookies = await context.cookies();
            const refreshCookie = cookies.find(c => c.name === 'refresh_token');

            if (refreshCookie) {
                sessionManager.setTokens(refreshCookie.value, refreshCookie.value, 3600);
                return true;
            }

            return !!storagePath;
        } catch (e) {
            console.error('[AuthManager] Failed to capture session state:', e);
            return false;
        }
    }
    private async captureTokens(page: Page): Promise<boolean> {
        console.log('[AuthManager] Starting token capture from browser storage...');
        const sessionManager = SessionManager.getInstance();
        let attempts = 0;
        const maxAttempts = 15; // Increased from 5 to 15 (15 seconds total)

        while (attempts < maxAttempts) {
            const tokens = await page.evaluate(() => {
                return {
                    access: localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken') || '',
                    refresh: localStorage.getItem('refreshToken') || sessionStorage.getItem('refreshToken') || ''
                };
            }).catch(() => ({ access: '', refresh: '' }));

            // 1. Success via LocalStorage
            if (tokens.access && tokens.refresh) {
                sessionManager.setTokens(tokens.access, tokens.refresh, 3600);
                console.log('[AuthManager] ✓ Tokens successfully captured from LocalStorage');
                return true;
            }

            // 2. Fallback: Check Cookies immediately
            const cookies = await page.context().cookies();

            // [DEBUG] Log all cookie names to find the correct token
            const cookieNames = cookies.map(c => `${c.name}=${c.value.substring(0, 10)}...`);
            console.log(`[AuthManager] Available Cookies: ${cookieNames.join(', ')}`);

            const refreshCookie = cookies.find(c => c.name === 'refresh_token' || c.name.includes('refresh') || c.name.includes('token'));

            if (refreshCookie) {
                sessionManager.setTokens(refreshCookie.value, refreshCookie.value, 3600);
                console.log(`[AuthManager] ✓ Refresh Token captured from Cookie: ${refreshCookie.name}`);
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
