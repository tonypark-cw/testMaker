
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

(async () => {
    const browser = await chromium.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }); // Visible for debugging
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    // Block localhost (Critical for stability)
    await page.route(/localhost|127\.0\.0\.1/, async (route) => {
        await route.abort();
    });

    try {
        const email = process.env.DEV_EMAIL || process.env.EMAIL || '';
        const password = process.env.DEV_PASSWORD || process.env.PASSWORD || '';
        const baseUrl = process.env.TESTMAKER_URL || 'https://stage.ianai.co';

        console.log(`[Inspector] navigating to ${baseUrl}...`);
        await page.goto(baseUrl);
        await page.waitForTimeout(2000);

        if (page.url().includes('login')) {
            console.log('[Inspector] On Login Page. Logging in...');
            try {
                // Try placeholder selector
                await page.waitForSelector('[placeholder="Your email"]', { timeout: 10000 });
                const emailInput = page.locator('[placeholder="Your email"]').first();
                const passInput = page.locator('[placeholder="Your password"]').first();
                const submitBtn = page.locator('button[type="submit"]').first();

                if (await emailInput.isEnabled()) {
                    await emailInput.fill(email);
                }
                if (await passInput.isEnabled()) {
                    await passInput.fill(password);
                }
                if (await submitBtn.isVisible() && await submitBtn.isEnabled()) {
                    await submitBtn.click();
                    console.log('[Inspector] Submitted login. Waiting for navigation...');
                    await page.waitForNavigation({ timeout: 15000 });
                } else {
                    console.log('[Inspector] Submit button is not available or disabled');
                }
            } catch (e) {
                console.log(`[Inspector] Login failed or form not found: ${e}`);
            }
        }

        console.log(`[Inspector] Current URL: ${page.url()}`);
        if (page.url().includes('login')) {
            console.error('[Inspector] Still on login page! Aborting.');
            // Dump login DOM to see why
            const html = await page.content();
            fs.writeFileSync('output/login_dump.html', html);
            process.exit(1);
        }

        // Go to Home first to settle session
        console.log('[Inspector] Going to Home...');
        await page.goto(`${baseUrl}/app/home`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000);

        // Force go to Workorder
        const targetUrl = `${baseUrl}/app/workorder`;
        console.log(`[Inspector] Going to ${targetUrl}...`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        console.log('[Inspector] Waiting 20s for loader to vanish...');
        await page.waitForTimeout(20000);

        // Click Add New

        // Click Add New
        console.log('[Inspector] Clicking "Add New"...');
        const addBtn = page.locator('button:has-text("Add New")').first();
        // const addBtn = page.getByRole('button', { name: 'Add New' }).first();

        if (await addBtn.isVisible() && await addBtn.isEnabled()) {
            await addBtn.hover();
            await page.waitForTimeout(500);
            await addBtn.click();
            console.log('[Inspector] Clicked "Add New". Waiting for modal...');
            await page.waitForTimeout(3000); // Wait for animation
        } else if (await addBtn.isVisible() && !await addBtn.isEnabled()) {
            console.error('[Inspector] "Add New" button is visible but disabled!');
        } else {
            console.error('[Inspector] "Add New" button not found with :has-text("Add New")!');
            // fallback dump to debug why
            console.log((await page.content()).substring(0, 1000));
        }

        // Dump DOM
        console.log('[Inspector] Dumping DOM...');
        const html = await page.content();
        fs.writeFileSync('output/modal_dump.html', html);
        console.log('[Inspector] Saved output/modal_dump.html');

        // Smart Inspection
        const modalInfo = await page.evaluate(() => {
            const potentialModals: Array<{
                selector: string;
                tagName: string;
                className: string;
                id: string;
                role: string | null;
                text: string;
                outerHTML: string;
            }> = [];
            // Check common modal selectors
            const selectors = [
                '[role="dialog"]',
                '.modal',
                '.dialog',
                '[class*="Modal"]',
                '[class*="Drawer"]',
                'div[style*="z-index: 200"]', // High z-index
                'div[style*="z-index: 1000"]'
            ];

            selectors.forEach(sel => {
                document.querySelectorAll(sel).forEach(el => {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        potentialModals.push({
                            selector: sel,
                            tagName: el.tagName,
                            className: el.className,
                            id: el.id,
                            role: el.getAttribute('role'),
                            text: (el as HTMLElement).innerText.substring(0, 50).replace(/\n/g, ' '),
                            outerHTML: el.outerHTML.substring(0, 200) + '...'
                        });
                    }
                });
            });
            return potentialModals;
        });

        console.log('\n[Inspector] Potential Modals Found:');
        console.log(JSON.stringify(modalInfo, null, 2));

    } catch (e) {
        console.error(e);
    } finally {
        await browser.close();
    }
})();
