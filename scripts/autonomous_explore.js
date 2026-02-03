import { chromium } from 'playwright';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext(); // Isolated "Secret" mode
    const page = await context.newPage();
    
    console.log('--- Autonomous Web Exploration (Incognito) ---');
    console.log('Navigating to: https://dev.ianai.co/login');
    
    try {
        await page.goto('https://dev.ianai.co/login', { waitUntil: 'networkidle' });
        
        console.log('Detecting login fields...');
        // Try multiple selectors for email
        const emailSelector = 'input[type="email"], input[name="email"], input[placeholder*="email"]';
        const passwordSelector = 'input[type="password"], input[name="password"]';
        
        await page.waitForSelector(emailSelector, { timeout: 10000 });
        await page.fill(emailSelector, process.env.DEV_EMAIL || 'neal@fifo.com');
        await page.fill(passwordSelector, process.env.DEV_PASSWORD || 'dlgksquf159!');
        
        console.log('Clicking login button...');
        await page.click('button[type="submit"], button:has-text("Login"), button:has-text("로그인")');
        
        await page.waitForTimeout(5000);
        console.log(`Current URL after login: ${page.url()}`);
        
        // Take a screenshot
        await page.screenshot({ path: 'output/autonomous_login_result.png', fullPage: true });
        
        // Explore sidebar
        console.log('Exploring navigation...');
        const links = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a[href^="/app/"]'))
                .map(a => a.href)
                .slice(0, 10);
        });
        
        console.log(`Found ${links.length} links. Exploring...`);
        for (const link of links) {
            console.log(`Navigating to: ${link}`);
            await page.goto(link, { waitUntil: 'networkidle' }).catch(() => {});
            await page.waitForTimeout(2000);
            const safeName = link.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
            await page.screenshot({ path: `output/explore_${safeName}.png` });
        }
        
    } catch (e) {
        console.error('Exploration error:', e.message);
        await page.screenshot({ path: 'output/exploration_error.png' });
    }
    
    await browser.close();
    console.log('Exploration finished.');
}

run().catch(console.error);
