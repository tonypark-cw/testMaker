import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { SessionManager } from '../shared/auth/SessionManager.js';
import { AuthManager } from '../shared/auth/AuthManager.js';
import { NetworkManager } from '../shared/network/NetworkManager.js';
import { RecoveryManager } from '../shared/network/RecoveryManager.js';
import { ScraperConfig } from '../shared/types.js';

dotenv.config();

async function run() {
    const url = process.env.URL || 'https://stage.ianai.co';
    const outputDir = path.join(process.cwd(), 'output', 'verify-session');

    const config: ScraperConfig = {
        url,
        username: process.env.EMAIL || process.env.USERNAME || '',
        password: process.env.PASSWORD || '',
        headless: true, // Auto-run in headless mode
        limit: 5,
        depth: 1,
        force: false
    };

    const networkManager = new NetworkManager();
    const recoveryManager = new RecoveryManager(50);
    const authManager = new AuthManager(config, networkManager, recoveryManager, outputDir);
    const sessionManager = SessionManager.getInstance();

    // Set shared session path
    const sharedSessionPath = path.join(process.cwd(), 'output', 'session-mutex.json');
    sessionManager.setSessionFilePath(sharedSessionPath);

    console.log(`[Verify] Starting verification with shared session: ${sharedSessionPath}`);
    console.log(`[Verify] Target: ${url}`);

    const browser = await chromium.launch({ headless: config.headless });
    let context = await browser.newContext();
    let page = await context.newPage();

    // [DEBUG] Forward browser console logs to terminal
    page.on('console', msg => {
        if (msg.text().includes('[Browser]') || msg.text().includes('AuthManager')) {
            console.log(`[Browser Console] ${msg.text()}`);
        }
    });

    // 1. Setup Header Injection if session exists
    if (sessionManager.hasValidSession()) {
        console.log('[Verify] ✓ Valid session detected BEFORE login attempt.');
    }

    // 2. Perform Login (Should skip if valid session exists)
    // Manually setup context with storageState if available to simulate Runner
    const sessionPath = sessionManager.getStorageStatePath();
    if (sessionManager.hasValidSession() && sessionPath && fs.existsSync(sessionPath)) {
        console.log(`[Verify] Found storageState at: ${sessionPath}`);
        // Re-create context with storageState
        await context.close();
        context = await browser.newContext({ storageState: sessionPath });
        page = await context.newPage();
        console.log('[Verify] ✓ Context re-created with storageState');
    }

    const success = await authManager.performLogin(page, context);

    if (success) {
        if (sessionManager.hasValidSession()) {
            console.log('[Verify] 🌟 Authentication Success');

            // Check if storageState file was created
            const storageStatePath = sessionManager.getStorageStatePath();
            if (storageStatePath && fs.existsSync(storageStatePath)) {
                console.log('[Verify] ✅ session-mutex.storage.json successfully created!');
            } else {
                console.warn('[Verify] ⚠️ session-mutex.storage.json NOT found (may be first run or failed save)');
            }
        }

        // CRITICAL: Navigate to app root first to activate restored cookies
        if (page.url() === 'about:blank' || page.url().includes('/login')) {
            console.log('[Verify] Navigating to app root to activate session...');
            await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => { });
            await page.waitForTimeout(2000);
        }
    } else {
        console.error('[Verify] ❌ Authentication failed or tokens not captured.');
        await browser.close();
        process.exit(1);
    }

    // 3. Final Verification: Navigate to a protected page
    console.log('[Verify] Navigating to /app/home to verify session stability...');
    await page.goto(new URL('/app/home', url).toString(), { waitUntil: 'networkidle' });

    const isStillOnLogin = await page.locator('input[type="password"]').isVisible().catch(() => false);
    if (isStillOnLogin) {
        console.error('[Verify] ❌ Session verification failed - redirected back to login.');
        await browser.close();
        process.exit(1);
    } else {
        console.log('[Verify] ✅ Session is STABLE and VERIFIED. Dashboard loaded successfully!');
    }

    console.log('[Verify] Keeping browser open for 10 seconds for observation...');
    await new Promise(r => setTimeout(r, 10000));

    await browser.close();
    process.exit(0);
}

run().catch(err => {
    console.error('[Verify] Fatal error:', err);
    process.exit(1);
});
