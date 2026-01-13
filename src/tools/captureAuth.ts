import { chromium } from 'playwright';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

async function captureAuth() {
    console.log('[CaptureAuth] Launching browser...');
    const browser = await chromium.launch({
        headless: false,
        slowMo: 100
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    // Listen to all network requests
    page.on('request', request => {
        const url = request.url();
        if (url.includes('api-stage.ianai.co') || url.includes('api-dev.ianai.co')) {
            console.log(`\n[OUT] ${request.method()} ${url}`);
            const headers = request.headers();
            // Log all headers for deep analysis
            Object.entries(headers).forEach(([key, value]) => {
                if (['authorization', 'company-id', 'x-tenant-id', 'cookie'].includes(key.toLowerCase())) {
                    console.log(`  ${key}: ${value.length > 50 ? value.substring(0, 50) + '...' : value}`);
                }
            });
        }
    });

    page.on('response', async response => {
        const url = response.url();
        if (url.includes('api-stage.ianai.co') || url.includes('api-dev.ianai.co')) {
            console.log(`[IN] ${response.status()} ${url}`);
            if (url.includes('/user/login')) {
                try {
                    const body = await response.json();
                    console.log('  Login Response Body:', JSON.stringify(body, null, 2));
                } catch (e) { }
            }
        }
    });

    const targetUrl = process.env.TESTMAKER_URL || 'https://stage.ianai.co/app/login';
    console.log(`[CaptureAuth] Navigating to ${targetUrl}...`);
    await page.goto(targetUrl);

    console.log('[CaptureAuth] BROWSER OPEN. Please perform login manually or wait for automation.');

    // Auto-login if credentials exist
    if (process.env.EMAIL && process.env.PASSWORD) {
        console.log('[CaptureAuth] Attempting auto-login...');
        await page.fill('input[type="email"], input[placeholder*="email"]', process.env.EMAIL);
        await page.fill('input[type="password"], input[placeholder*="password"]', process.env.PASSWORD);
        await page.click('button[type="submit"], button:has-text("Log in")');
    }

    // Keep it open for analysis
    console.log('[CaptureAuth] Analysis mode active. Press Ctrl+C in terminal to stop.');
    await new Promise(() => { });
}

captureAuth().catch(err => {
    console.error('[CaptureAuth] Error:', err);
    process.exit(1);
});
