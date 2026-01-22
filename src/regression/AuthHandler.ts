/**
 * AuthHandler for Regression Testing
 *
 * Handles authentication for regression tests by:
 * 1. Reusing existing session from temp-auth.json
 * 2. Or performing fresh login if credentials provided
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

export interface AuthConfig {
    url: string;
    username?: string;
    password?: string;
    outputDir?: string;
    headless?: boolean;
}

export interface AuthResult {
    success: boolean;
    context: BrowserContext;
    tokens: {
        accessToken: string;
        refreshToken: string;
    };
    error?: string;
}

export class AuthHandler {
    private config: AuthConfig;
    private browser: Browser | null = null;

    constructor(config: AuthConfig) {
        this.config = {
            outputDir: './output',
            headless: true,
            ...config
        };
    }

    /**
     * Initialize authenticated browser context
     */
    async initialize(): Promise<AuthResult> {
        const authFile = path.join(this.config.outputDir!, 'temp-auth.json');

        this.browser = await chromium.launch({ headless: this.config.headless });

        // Try to load existing session
        if (fs.existsSync(authFile)) {
            console.log('[AuthHandler] Loading existing session...');
            try {
                const context = await this.browser.newContext({
                    storageState: authFile,
                    viewport: { width: 1920, height: 1080 }
                });

                // Validate session by extracting tokens
                const page = await context.newPage();
                await page.goto(this.config.url, { waitUntil: 'networkidle', timeout: 30000 });

                const tokens = await this.extractTokens(page);
                await page.close();

                if (tokens.accessToken) {
                    console.log('[AuthHandler] ✅ Session restored successfully');
                    return {
                        success: true,
                        context,
                        tokens
                    };
                } else {
                    console.log('[AuthHandler] ⚠️ Session expired, need re-login');
                    await context.close();
                }
            } catch (err) {
                console.log('[AuthHandler] ⚠️ Failed to restore session:', err);
            }
        }

        // Perform fresh login if credentials provided
        if (this.config.username && this.config.password) {
            return await this.performLogin();
        }

        // No session and no credentials - create unauthenticated context
        console.log('[AuthHandler] ⚠️ No authentication available');
        const context = await this.browser.newContext({
            viewport: { width: 1920, height: 1080 }
        });

        return {
            success: false,
            context,
            tokens: { accessToken: '', refreshToken: '' },
            error: 'No authentication available'
        };
    }

    /**
     * Perform fresh login
     */
    private async performLogin(): Promise<AuthResult> {
        console.log('[AuthHandler] Performing login...');

        const context = await this.browser!.newContext({
            viewport: { width: 1920, height: 1080 }
        });
        const page = await context.newPage();

        try {
            await page.goto(this.config.url, { waitUntil: 'domcontentloaded', timeout: 15000 });

            // Wait for login form
            const emailLocator = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i], input[type="text"]').first();
            const passwordLocator = page.locator('input[type="password"], input[name="password"]').first();

            await emailLocator.waitFor({ state: 'visible', timeout: 10000 });

            // Validate and fill credentials
            if (!await emailLocator.isEnabled()) {
                throw new Error('Email input is disabled');
            }
            await emailLocator.fill(this.config.username!);

            await passwordLocator.waitFor({ state: 'visible', timeout: 10000 });
            if (!await passwordLocator.isEnabled()) {
                throw new Error('Password input is disabled');
            }
            await passwordLocator.fill(this.config.password!);

            // Submit with validation
            const submitBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("Log in"), button:has-text("Sign in"), button:has-text("로그인")').first();
            await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
            if (!await submitBtn.isEnabled()) {
                throw new Error('Submit button is disabled');
            }
            await submitBtn.click();

            // Wait for login to complete
            await page.waitForLoadState('networkidle', { timeout: 15000 });
            await page.waitForTimeout(1000);

            // Navigate to app if stuck on intermediate page
            const currentUrl = page.url();
            if (currentUrl.includes('/app/logged-in') || currentUrl.endsWith('/app') || currentUrl.endsWith('/app/')) {
                await page.goto(new URL('/app/home', this.config.url).toString(), { waitUntil: 'networkidle', timeout: 30000 });
            }

            // Extract tokens
            const tokens = await this.extractTokens(page);
            await page.close();

            if (tokens.accessToken) {
                // Save session
                const authFile = path.join(this.config.outputDir!, 'temp-auth.json');
                await context.storageState({ path: authFile });
                console.log('[AuthHandler] ✅ Login successful, session saved');

                return {
                    success: true,
                    context,
                    tokens
                };
            } else {
                return {
                    success: false,
                    context,
                    tokens,
                    error: 'Login completed but no tokens found'
                };
            }
        } catch (err) {
            await page.close();
            return {
                success: false,
                context,
                tokens: { accessToken: '', refreshToken: '' },
                error: String(err)
            };
        }
    }

    /**
     * Extract tokens from page localStorage/sessionStorage
     */
    private async extractTokens(page: Page): Promise<{ accessToken: string; refreshToken: string }> {
        return await page.evaluate(() => {
            return {
                accessToken: localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken') || '',
                refreshToken: localStorage.getItem('refreshToken') || sessionStorage.getItem('refreshToken') || ''
            };
        });
    }

    /**
     * Create authenticated page with token injection
     */
    async createAuthenticatedPage(context: BrowserContext, tokens: { accessToken: string; refreshToken: string }): Promise<Page> {
        const page = await context.newPage();

        // Inject tokens before any navigation
        if (tokens.accessToken) {
            await page.addInitScript((t) => {
                localStorage.setItem('accessToken', t.accessToken);
                localStorage.setItem('refreshToken', t.refreshToken);
                sessionStorage.setItem('accessToken', t.accessToken);
                sessionStorage.setItem('refreshToken', t.refreshToken);
            }, tokens);
        }

        return page;
    }

    /**
     * Close browser
     */
    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}
