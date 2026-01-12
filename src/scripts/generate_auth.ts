import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

async function generateAuth() {
    // Use direct URL (stage.ianai.co does not use the Dashboard credentials for Basic Auth)
    const AUTH_URL = 'https://stage.ianai.co';

    const LOGIN_EMAIL = process.env.emailname || '';
    const LOGIN_PASS = process.env.password || '';

    if (!LOGIN_EMAIL || !LOGIN_PASS) {
        console.error('[Auth] Error: emailname or password not found in environment variables.');
        process.exit(1);
    }
    const OUTPUT_PATH = path.resolve(process.cwd(), 'output/auth.json');

    console.log('[Auth] Launching browser...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        console.log(`[Auth] Navigating to ${AUTH_URL}/app/home...`);
        await page.goto(`${AUTH_URL}/app/home`, { waitUntil: 'load', timeout: 60000 });
        await page.waitForLoadState('networkidle');

        // Check if we need to login
        const loginBtn = page.locator('button:has-text("Log in")').first();
        if (await loginBtn.isVisible()) {
            console.log('[Auth] Login form detected. Logging in...');

            const emailSel = 'input[type="email"], input[name="email"], input[placeholder*="email" i]';
            const passSel = 'input[type="password"], input[name="password"]';

            await page.waitForSelector(emailSel, { state: 'visible', timeout: 10000 });
            await page.fill(emailSel, LOGIN_EMAIL);

            await page.waitForSelector(passSel, { state: 'visible', timeout: 10000 });
            await page.fill(passSel, LOGIN_PASS);
            await loginBtn.click();

            console.log('[Auth] Waiting for dashboard redirection...');
            await page.waitForURL(/.*\/app\/home/, { timeout: 60000 });
        } else {
            console.log('[Auth] Already logged in?');
        }

        console.log('[Auth] verifying dashboard access...');
        await page.waitForSelector('button:has-text("Dashboard")', { state: 'visible', timeout: 60000 });

        console.log(`[Auth] Saving storage state to ${OUTPUT_PATH}...`);

        // Ensure directory exists
        const dir = path.dirname(OUTPUT_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        await context.storageState({ path: OUTPUT_PATH });
        console.log('[Auth] Success!');

    } catch (e) {
        console.error('[Auth] Failed:', e);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

generateAuth();
