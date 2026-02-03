import { chromium } from 'playwright';

async function run() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    console.log('--- YouTube Video Analysis ---');
    await page.goto('https://www.youtube.com/watch?v=P5QqZ1hjYKQ');
    await page.waitForTimeout(5000);
    
    // Get all text content
    const pageData = await page.evaluate(() => {
        return {
            title: document.title,
            description: document.querySelector('tp-yt-paper-button#expand')?.click() || document.querySelector('#description-inline-expander')?.innerText,
            allText: document.body.innerText.substring(0, 5000)
        };
    });
    
    console.log(`TITLE: ${pageData.title}`);
    console.log(`PAGE TEXT SNIPPET: ${pageData.allText.substring(0, 1000)}`);
    
    await browser.close();
}

run().catch(console.error);
