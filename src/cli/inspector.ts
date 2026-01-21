
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runInspector() {
    const browser = await chromium.launch({ headless: false }); // Headless false to see it if needed, though running in bg
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        ignoreHTTPSErrors: true
    });

    // Load Auth
    try {
        const authPath = path.join(process.cwd(), 'output', 'auth.json');
        if (fs.existsSync(authPath)) {
            const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
            await context.addCookies(auth.cookies);
            await context.addInitScript((storage) => {
                if (window.location.hostname === 'stage.ianai.co') {
                    for (const [k, v] of Object.entries(storage)) {
                        window.localStorage.setItem(k, String(v));
                    }
                }
            }, auth.origins[0]?.localStorage || {});
            console.log('Loaded auth state.');
        }
    } catch (e) {
        console.error('Failed to load auth:', e);
    }

    const page = await context.newPage();

    // Go to Home
    console.log('Navigating to app/home...');
    await page.goto('https://stage.ianai.co/app/home', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000); // Wait for full render

    const output: string[] = [];

    output.push('=== PAGE TITLE ===');
    output.push(await page.title());
    output.push('\n');

    // 1. Inspect Sidebar/Navigation
    output.push('=== SIDEBAR SNAPSHOT ===');
    const sidebar = await page.evaluate(() => {
        const navs = document.querySelectorAll('nav, aside, .sidebar, [class*="Sidebar"], [class*="Navbar"]');
        return Array.from(navs).map(n => {
            return {
                tag: n.tagName,
                class: n.className,
                html: n.outerHTML.substring(0, 2000) // Truncate to avoid massive logs
            };
        });
    });
    output.push(JSON.stringify(sidebar, null, 2));

    // 2. Inspect Buttons in Sidebar
    output.push('\n=== SIDEBAR BUTTONS ===');
    const sidebarButtons = await page.evaluate(() => {
        const nav = document.querySelector('nav, aside, .sidebar, [class*="Sidebar"]');
        if (!nav) return 'No Sidebar Found';
        const btns = nav.querySelectorAll('button, a, [role="button"]');
        return Array.from(btns).map(b => ({
            text: (b as HTMLElement).innerText?.replace(/\n/g, ' '),
            tag: b.tagName,
            href: (b as HTMLAnchorElement).href || 'none',
            class: b.className,
            visible: (b as HTMLElement).offsetParent !== null
        }));
    });
    output.push(JSON.stringify(sidebarButtons, null, 2));

    // 3. Inspect Pagination
    output.push('\n=== PAGINATION SNAPSHOT ===');
    const pagination = await page.evaluate(() => {
        // Look for common pagination indicators
        const pagers = document.querySelectorAll('[class*="pagination"], [class*="Pagination"], ul[class*="pager"]');
        if (pagers.length === 0) {
            // Look for bottom area buttons
            const bottomBtns = Array.from(document.querySelectorAll('button')).filter(b => {
                const rect = b.getBoundingClientRect();
                return rect.top > window.innerHeight * 0.8; // Bottom 20%
            });
            return bottomBtns.map(b => ({
                text: b.innerText,
                class: b.className,
                html: b.outerHTML
            }));
        }
        return Array.from(pagers).map(p => p.outerHTML);
    });
    output.push(JSON.stringify(pagination, null, 2));

    // 4. Global Buttons (Create/New)
    output.push('\n=== GLOBAL ACTION BUTTONS ===');
    const globalBtns = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, a[class*="btn"]'));
        return btns
            .filter(b => {
                const t = (b as HTMLElement).innerText || '';
                return /New|Create|Add|Plus|Generate|신규|생성|추가/i.test(t);
            })
            .map(b => ({
                text: (b as HTMLElement).innerText,
                class: b.className,
                rect: b.getBoundingClientRect()
            }));
    });
    output.push(JSON.stringify(globalBtns, null, 2));

    fs.writeFileSync('output/ui_inspection.log', output.join('\n'));
    console.log('Inspection complete. Saved to output/ui_inspection.log');

    await browser.close();
}

runInspector();
