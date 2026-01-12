import { test, expect } from '@playwright/test';
import { captureHealingContext } from '../../src/core/healer';

/**
 * ianaiERP Golden Path: Main Navigation & Drawer Flow
 */

test.describe('ianaiERP Golden Path', () => {
    // Basic Auth embedded in URL for maximum stability
    // Basic Auth embedded in URL for maximum stability
    const AUTH_URL = 'https://ianai:vofflsemfha12321@stage.ianai.co';
    const BASE_URL = 'https://stage.ianai.co';
    const LOGIN_EMAIL = 'chanwoo3@ianai.co';
    const LOGIN_PASS = 'InitialPassword1!';

    test.afterEach(async ({ page }, testInfo) => {
        await captureHealingContext(page, testInfo);
    });

    test.beforeEach(async ({ page }) => {
        console.log('[Setup] Navigating to app...');
        await page.goto(`${AUTH_URL}/app/home`, { waitUntil: 'load', timeout: 60000 });

        // Wait for page to stabilize
        await page.waitForLoadState('networkidle');

        // Detection markers
        const emailSelector = 'input[type="email"], input[name="email"], input[placeholder*="email" i]';
        const loginBtnSelector = 'button:has-text("Log in")';
        const dashboardBtnSelector = 'button:has-text("Dashboard")';

        console.log('[Setup] Detecting UI state...');
        const state = await Promise.race([
            page.waitForSelector(emailSelector, { state: 'visible', timeout: 30000 }).then(() => 'login'),
            page.waitForSelector(loginBtnSelector, { state: 'visible', timeout: 30000 }).then(() => 'login'),
            page.waitForSelector(dashboardBtnSelector, { state: 'visible', timeout: 30000 }).then(() => 'dashboard')
        ]).catch(() => 'unknown');

        console.log(`[Setup] Detected state: ${state}`);

        if (state === 'unknown') {
            console.log('[Setup] State unknown, reloading page to retry...');
            await page.reload({ waitUntil: 'load' });
            // Retry detection
            const retryState = await Promise.race([
                page.waitForSelector(emailSelector, { state: 'visible', timeout: 30000 }).then(() => 'login'),
                page.waitForSelector(loginBtnSelector, { state: 'visible', timeout: 30000 }).then(() => 'login'),
                page.waitForSelector(dashboardBtnSelector, { state: 'visible', timeout: 30000 }).then(() => 'dashboard')
            ]).catch(() => 'unknown');

            if (retryState === 'unknown') {
                throw new Error('[Setup] Failed to detect app state (Login or Dashboard) after reload. Aborting.');
            }
            if (retryState === 'login') {
                console.log('[Setup] Retry detected login form.');
                // Proceed to login logic below...
                await page.waitForTimeout(1000);
                await page.fill(emailSelector, LOGIN_EMAIL);
                await page.fill('input[type="password"]', LOGIN_PASS);
                await page.click('button:has-text("Log in")');
                await page.waitForURL(/.*\/app\/home/, { timeout: 60000 });
                await page.waitForSelector(dashboardBtnSelector, { state: 'visible', timeout: 60000 });
            }
        } else if (state === 'login') {
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
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
        console.log('[Setup] Environment ready.');
    });

    test('Full Navigation & Modal Flow', async ({ page }) => {
        // ALWAYS use AUTH_URL for all navigations to maintain Basic Auth session

        // Helper to take dashboard-compatible screenshots
        const takeShot = async (pathName: string) => {
            console.log(`[Dashboard] Preparing to capture ${pathName}...`);

            // 1. Wait for standard Mantine loaders
            await page.locator('.mantine-Loader-root').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => { });

            // 2. Wait for generic "skeleton" patterns if present
            const skeletons = page.locator('[class*="skeleton"], [class*="Skeleton"]');
            const count = await skeletons.count();
            if (count > 0) {
                console.log(`[Dashboard] Detected ${count} skeleton(s), waiting for clear...`);
                await Promise.all(
                    (await skeletons.all()).map(s => s.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => { }))
                );
            }

            // 3. Final network and UI settle
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
            await page.waitForTimeout(2000); // Forced settle for any state-based rendering

            // 4. One last check for any newly appeared loader
            await page.locator('.mantine-Loader-root').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });

            const now = new Date();
            const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
            const timeStr = now.getHours().toString().padStart(2, '0') + now.getMinutes().toString().padStart(2, '0');
            const fileName = `screenshot-${pathName}_${dateStr}-${timeStr}.png`;
            const fullPath = `output/screenshots/stage-ianai-co/${fileName}`;
            await page.screenshot({ path: fullPath, type: 'png' });
            console.log(`[Dashboard] Captured: ${fileName}`);
        };

        // 1. Sales
        console.log('[ACTIVITY] Navigating to Sales Overview...');
        await page.goto(`${BASE_URL}/app/reports/sales/overview`);
        await page.waitForURL('**/app/reports/sales/overview', { timeout: 60000 });
        await page.waitForSelector('[role="tab"]', { timeout: 45000 });
        const overviewTab = page.locator('[role="tab"]').filter({ hasText: /^Overview$/ });
        await expect(overviewTab).toBeVisible();
        await takeShot('app_reports_sales_overview');

        // 2. Items
        console.log('[ACTIVITY] Navigating to Item List...');
        await page.goto(`${BASE_URL}/app/item`);
        await page.waitForTimeout(1000);
        await page.goto(`${BASE_URL}/app/item`, { waitUntil: 'domcontentloaded' });
        await page.waitForURL('**/app/item', { timeout: 60000 });
        await expect(page.getByText('Items', { exact: true }).or(page.getByRole('heading', { name: /Item/i }))).toBeVisible({ timeout: 45000 });
        await page.waitForSelector('table tbody tr', { timeout: 45000 });
        await takeShot('app_item');

        const firstRow = page.locator('table tbody tr').first();
        await expect(firstRow).toBeVisible();
        await firstRow.click();
        console.log('[ACTIVITY] Verifying Item Drawer...');
        const drawer = page.locator('section[role="dialog"], [class*="Drawer-content"], [class*="Modal-content"]').first();
        await expect(drawer).toBeVisible({ timeout: 45000 });
        await expect(drawer).toContainText(/SKU|Category|Barcode/i);
        await takeShot('modal-Item_Detail');
        await page.keyboard.press('Escape');
        await expect(drawer).not.toBeVisible();

        // 3. Settings
        console.log('[ACTIVITY] Navigating to Settings...');
        await page.goto(`${BASE_URL}/app/settings`);
        await page.waitForURL('**/app/settings', { timeout: 60000 });
        await expect(page.locator('[role="tab"]').filter({ hasText: /Company/i })).toBeVisible({ timeout: 30000 });
        await takeShot('app_settings');

        // --- 4. Manufacturing (Work Order) Flow ---
        console.log('[ACTIVITY] Navigating to Work Order...');
        await page.goto(`${BASE_URL}/app/workorder`);
        await page.waitForTimeout(1000);
        await page.goto(`${BASE_URL}/app/workorder`, { waitUntil: 'domcontentloaded' });
        await page.waitForURL('**/app/workorder', { timeout: 60000 });
        await expect(page.getByText('Work Order').first().or(page.getByRole('heading', { name: /Work Order/i }))).toBeVisible({ timeout: 45000 });
        await takeShot('app_workorder');

        const workOrderRows = page.locator('table tbody tr');
        if (await workOrderRows.count() > 0) {
            console.log('[ACTIVITY] Opening Work Order Drawer...');
            await workOrderRows.first().click();
            const drawer = page.getByRole('dialog').first();
            await expect(drawer).toBeVisible({ timeout: 15000 });
            await takeShot('modal-WorkOrder_Detail');
            await page.keyboard.press('Escape');
            await expect(drawer).not.toBeVisible();
        }

        // --- 5. Purchasing (Order) Flow ---
        console.log('[ACTIVITY] Navigating to Purchase Order...');
        await page.goto(`${BASE_URL}/app/purchaseorder`);
        await page.waitForTimeout(1000);
        await page.goto(`${BASE_URL}/app/purchaseorder`, { waitUntil: 'domcontentloaded' });
        await page.waitForURL('**/app/purchaseorder', { timeout: 60000 });
        await expect(page.getByText('Purchase Order').first().or(page.getByRole('heading', { name: /Purchase Order/i }))).toBeVisible({ timeout: 45000 });
        await takeShot('app_purchaseorder');

        const poRows = page.locator('table tbody tr');
        if (await poRows.count() > 0) {
            console.log('[ACTIVITY] Opening Purchase Order Drawer...');
            await poRows.first().click();
            const drawer = page.getByRole('dialog').first();
            await expect(drawer).toBeVisible({ timeout: 15000 });
            await takeShot('modal-PurchaseOrder_Detail');
            await page.keyboard.press('Escape');
            await expect(drawer).not.toBeVisible();
        }

        // --- 6. Inventory (Adjustment) Flow ---
        console.log('[ACTIVITY] Navigating to Inventory (Adjustment)...');
        await page.goto(`${BASE_URL}/app/adjustment`);
        await page.waitForTimeout(1000);
        await page.goto(`${BASE_URL}/app/adjustment`, { waitUntil: 'domcontentloaded' });
        await page.waitForURL('**/app/adjustment', { timeout: 60000 });
        await expect(page.getByText('Adjustment').first().or(page.getByRole('heading', { name: /Adjustment/i }))).toBeVisible({ timeout: 45000 });
        await takeShot('app_adjustment');

        const adjRows = page.locator('table tbody tr');
        if (await adjRows.count() > 0) {
            console.log('[ACTIVITY] Opening Adjustment Drawer...');
            await adjRows.first().click();
            const drawer = page.getByRole('dialog').first();
            await expect(drawer).toBeVisible({ timeout: 15000 });
            await takeShot('modal-Adjustment_Detail');
            await page.keyboard.press('Escape');
            await expect(drawer).not.toBeVisible();
        }

        // --- 7. Manual Detail Pages (Specific IDs) ---
        console.log('[ACTIVITY] Visiting Manual Detail Pages...');
        const CUSTOMER_UUID = '019a6c0c-51e4-7889-9307-0b809599588e';
        const MANUAL_DETAIL_PATHS: string[] = [
            `/app/customer/${CUSTOMER_UUID}/detail`
        ];

        for (const path of MANUAL_DETAIL_PATHS) {
            const pathLabel = path.replace(/^\/|\/$/g, '').replace(/\//g, '_');
            console.log(`[ACTIVITY] Visiting Manual Path: ${path}`);
            await page.goto(`${BASE_URL}${path}`);
            await page.waitForTimeout(2000);
            await expect(page.locator('body')).toBeVisible();
            await takeShot(`detail-${pathLabel}`);
        }

        console.log('[ACTIVITY] Golden Path successful!');
    });
});
