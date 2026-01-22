import { test, expect } from '@playwright/test';

/**
 * ianaiERP Golden Path: Main Navigation & Drawer Flow
 */

test.describe('ianaiERP Golden Path', () => {
    // Basic Auth embedded in URL for maximum stability
    const AUTH_URL = 'https://ianai:vofflsemfha12321@stage.ianai.co';
    const LOGIN_EMAIL = 'chanwoo3@ianai.co';
    const LOGIN_PASS = 'InitialPassword1!';

    test.beforeEach(async ({ page }) => {
        console.log('[Setup] Navigating to app...');
        await page.goto(`${AUTH_URL}/app/home`, { waitUntil: 'load', timeout: 60000 });

        // Wait for page to stabilize
        await page.waitForLoadState('networkidle');

        // Detection markers
        const emailSelector = 'input[type="email"], input[name="email"]';
        const dashboardBtnSelector = 'button:has-text("Custom Layout")';

        console.log('[Setup] Detecting UI state...');
        const state = await Promise.race([
            page.waitForSelector(emailSelector, { state: 'visible', timeout: 30000 }).then(() => 'login'),
            page.waitForSelector(dashboardBtnSelector, { state: 'visible', timeout: 30000 }).then(() => 'dashboard')
        ]).catch(() => 'unknown');

        console.log(`[Setup] Detected state: ${state}`);

        if (state === 'login') {
            console.log('[Setup] Filling form...');
            await page.waitForTimeout(1000); // Brief settle

            // Using direct page actions for maximum robustness in headless
            await page.fill(emailSelector, LOGIN_EMAIL);
            await page.fill('input[type="password"]', LOGIN_PASS);

            console.log('[Setup] Submitting login...');
            await page.click('button:has-text("Log in")');

            // Redirection
            await page.waitForURL(/.*\/app\/home/, { timeout: 60000 });
            await page.waitForSelector(dashboardBtnSelector, { state: 'visible', timeout: 60000 });
            console.log('[Setup] Login successful and Dashboard reached.');
        }

        // Final settle
        await page.locator('.mantine-Loader-root').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => { });
        console.log('[Setup] Environment ready.');
    });

    test('Full Navigation & Modal Flow', async ({ page }) => {
        // ALWAYS use AUTH_URL for all navigations to maintain Basic Auth session

        // 1. Sales
        console.log('[Test] Navigating to Sales Overview...');
        await page.goto(`${AUTH_URL}/app/reports/sales/overview`);
        await page.waitForSelector('button[role="tab"]', { timeout: 45000 });
        const overviewTab = page.locator('button[role="tab"]').filter({ hasText: /^Overview$/ });
        await expect(overviewTab).toBeVisible();

        // 2. Items
        console.log('[Test] Navigating to Item List...');
        await page.goto(`${AUTH_URL}/app/item`);
        await page.waitForSelector('table tbody tr', { timeout: 45000 });
        const firstRow = page.locator('table tbody tr').first();
        await expect(firstRow).toBeVisible();
        await firstRow.click();

        // Drawer
        console.log('[Test] Verifying Item Drawer modal...');
        const drawer = page.locator('section[role="dialog"], [class*="Drawer-content"], [class*="Modal-content"]').first();
        await expect(drawer).toBeVisible({ timeout: 45000 });
        await expect(drawer).toContainText(/SKU|Category|Barcode/i);
        console.log('[Test] Drawer verified.');

        await page.keyboard.press('Escape');
        await expect(drawer).not.toBeVisible();

        // 3. Settings
        console.log('[Test] Navigating to Settings...');
        await page.goto(`${AUTH_URL}/app/settings`);
        await expect(page.locator('button[role="tab"]').filter({ hasText: /Company/i })).toBeVisible({ timeout: 30000 });

        console.log('[Test] Golden Path successful!');
    });
});
