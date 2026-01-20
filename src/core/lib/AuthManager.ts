import { Page, BrowserContext } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { ScraperConfig } from '../types.js';
import { NetworkManager } from '../NetworkManager.js';
import { RecoveryManager } from '../RecoveryManager.js';

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
        // 1. Setup Network Listeners for Error Detection
        this.setupListeners(page);

        console.log('[AuthManager] Navigating to target for login...');
        await page.goto(this.config.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(e => {
            console.error(`[AuthManager] Navigation failed: ${e.message}`);
            if (e.message.includes('ERR_CONNECTION_REFUSED')) {
                console.warn('[AuthManager] ⚠️ Server reachable check failed (Connection Refused). Proceeding anyway.');
            }
            throw e;
        });

        // [OPTIMIZATION] Replaced fixed 2s wait with dynamic element wait
        // await page.waitForTimeout(2000); // REMOVED

        try {
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
                    // [OPTIMIZATION] Removed unnecessary 500ms wait after blur
                    // await page.waitForTimeout(500); // REMOVED

                    await passwordLocator.fill(this.config.password);
                    // [OPTIMIZATION] Removed unnecessary 500ms wait after blur
                    // await page.waitForTimeout(500); // REMOVED

                    const submitBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("Log in"), button:has-text("Sign in"), button:has-text("로그인")').first();

                    if (await submitBtn.isVisible().catch(() => false)) {
                        // [REVERSE ENGINEERING WORKAROUND]
                        if (process.env.INJECT_CUSTOM_HEADERS === 'true') {
                            await this.injectCompanyId(context);
                        }

                        // [OPTIMIZATION] Reduced wait before submit from 1s to 300ms
                        await page.waitForTimeout(300);
                        await submitBtn.click();
                        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });

                        if (process.env.CLEAR_LOGIN_FIELDS === 'true') {
                            await emailLocator.fill('').catch(() => { });
                            await passwordLocator.fill('').catch(() => { });
                            console.log('[AuthManager] ✓ Cleared login form fields');
                        }

                        // [OPTIMIZATION] Reduced post-login wait from 3s to 1s
                        await page.waitForTimeout(1000);
                        return await this.verifyLogin(page, context, passwordLocator);
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
                console.log('[AuthManager] No login form detected, assuming already logged in.');
                return true;
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
}
