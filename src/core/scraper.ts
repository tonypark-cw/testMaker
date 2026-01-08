import { Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import sharp from 'sharp';
import { TestableElement } from '../../types/index.js';
import { ScrapeResult, ScraperConfig } from './types.js';

export class Scraper {
  private static lastScreenshotHash: string | null = null;

  // Shared caches across all tabs in this process
  private static visitedSidebarButtons = new Set<string>();
  private static visitedExpansionButtons = new Set<string>();

  static async processPage(page: Page, url: string, config: ScraperConfig, outputDir: string): Promise<ScrapeResult> {
    const discoveredLinks: string[] = [];
    const { depth, limit } = config;

    console.log(`[Scraper] Processing: ${url}`);

    // --- NAVIGATION ---
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
    } catch (e) {
      console.error(`[Scraper] Navigation failed for ${url}: ${e}`);
      return { url, pageTitle: 'Error', elements: [], links: [], error: 'Navigation failed', newlyDiscoveredCount: 0 };
    }

    const currentUrl = page.url();
    if (currentUrl.includes('/app/logged-in') || currentUrl.endsWith('/app')) {
      await page.goto(new URL('/app/home', url).toString(), { waitUntil: 'networkidle' }).catch(() => { });
    }

    // --- HELPERS ---
    const closeModals = async () => {
      await page.keyboard.press('Escape');
      await page.evaluate(() => {
        document.querySelectorAll('.ianai-Modal-close, .mantine-Modal-close, [aria-label="Close"], .ianai-CloseButton-root').forEach(btn => (btn as HTMLElement).click());
      });
      await page.waitForTimeout(300);
    };

    const isModalOpen = async (): Promise<boolean> => {
      return await page.evaluate(() => {
        const modal = document.querySelector('.ianai-Modal-content, .mantine-Modal-content, [role="dialog"]');
        if (!modal) return false;
        const style = window.getComputedStyle(modal);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
    };

    const extractModalContent = async (triggerText: string) => {
      if (!(await isModalOpen())) return null;
      const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.ianai-Modal-content a[href]'))
          .map(a => (a as HTMLAnchorElement).href)
          .filter(h => h.startsWith('http'));
      });

      let screenshotPath: string | undefined;
      try {
        const modalEl = await page.$('.ianai-Modal-content, [role="dialog"]');
        if (modalEl) {
          const safeName = triggerText.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
          screenshotPath = path.join(outputDir, `modal-${safeName}-${Date.now()}.webp`);
          const png = await modalEl.screenshot({ type: 'png' });
          const webp = await sharp(png).webp({ quality: 80 }).toBuffer();
          fs.writeFileSync(screenshotPath, webp);
        }
      } catch (e) { }
      return { links, screenshotPath };
    };

    const smartClick = async (handle: any) => {
      try { await handle.click({ timeout: 2000 }); } catch (e) { await handle.evaluate((el: HTMLElement) => el.click()); }
    };

    // --- PHASE 4: MENUS ---
    const potentialMenus = await page.evaluate((visited) => {
      return Array.from(document.querySelectorAll('button[aria-expanded="false"], .collapsed'))
        .map(b => (b as HTMLElement).innerText?.split('\n')[0].trim())
        .filter(t => t && t.length < 30 && !visited.includes(t));
    }, Array.from(Scraper.visitedExpansionButtons));

    for (const t of potentialMenus) {
      try {
        const btn = await page.locator(`button:has-text("${t}")`).first();
        if (await btn.isVisible()) {
          await smartClick(btn);
          Scraper.visitedExpansionButtons.add(t);
          await page.waitForTimeout(300);
          const newLinks = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a => (a as HTMLAnchorElement).href));
          discoveredLinks.push(...newLinks);
        }
      } catch (e) { }
    }

    // --- AUTO SCROLL ---
    await page.evaluate(async () => {
      await new Promise<void>(resolve => {
        let totalHeight = 0;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, 200);
          totalHeight += 200;
          if (totalHeight >= scrollHeight || totalHeight > 5000) { clearInterval(timer); resolve(); }
        }, 50);
      });
    });

    // --- PHASE 6: ROW CLICK ---
    const rows = await page.$$('tbody tr, [role="row"]');
    if (rows.length > 0) {
      const row = rows[Math.min(1, rows.length - 1)];
      try {
        const preUrl = page.url();
        let target = await row.$('a[href]:not([href="#"])') || await row.$('button:not([aria-label*="menu"])') || row;

        let detectedApiCall = false;
        page.on('request', req => { if (req.url().includes('/api/')) detectedApiCall = true; });

        await smartClick(target);

        const waitLimit = 5;
        let handled = false;
        for (let i = 0; i < waitLimit; i++) {
          await page.waitForTimeout(200);
          if (page.url() !== preUrl || await isModalOpen() || (detectedApiCall && i > 2)) { handled = true; break; }
          if (i >= 3 && !detectedApiCall && page.url() === preUrl && !(await isModalOpen())) { break; }
        }

        if (handled) {
          if (await isModalOpen()) {
            const m = await extractModalContent('Row Click');
            if (m) discoveredLinks.push(...m.links);
            await closeModals();
          } else if (page.url() !== preUrl) {
            discoveredLinks.push(page.url());
            await page.goBack();
          }
        }
      } catch (e) { }
    }

    // --- PHASE 7: GLOBAL ACTIONS ---
    // (Skipped for brevity, can be re-added later if needed for full parity)

    // --- SCREENSHOT ---
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    let screenshotPath = '';
    try {
      const name = url.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
      screenshotPath = path.join(outputDir, `screenshot-${name}-${Date.now()}.webp`);
      const png = await page.screenshot({ fullPage: true, type: 'png' });
      const webp = await sharp(png).webp({ quality: 80 }).toBuffer();
      const hash = crypto.createHash('md5').update(webp).digest('hex');
      if (hash !== Scraper.lastScreenshotHash) {
        fs.writeFileSync(screenshotPath, webp);
        Scraper.lastScreenshotHash = hash;
      } else {
        screenshotPath = '';
      }
    } catch (e) { }

    // --- FULL EXTRACTION (For Analyzer) ---
    const result = await page.evaluate(() => {
      const elements: any[] = [];
      const links = new Set<string>();
      const sidebarLinks = new Set<string>();

      function walk(node: Node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          const tag = el.tagName.toLowerCase();
          const href = el.getAttribute('href');

          // Collect Links
          if (href && (href.startsWith('http') || href.startsWith('/'))) {
            const fullHref = (el as HTMLAnchorElement).href;
            if (fullHref && fullHref.startsWith('http')) {
              if (el.closest('nav, aside, .sidebar')) sidebarLinks.add(fullHref);
              else links.add(fullHref);
            }
          }

          // Collect Testable Elements
          // Simple heuristic for now
          const role = el.getAttribute('role');
          if (['button', 'input', 'select', 'textarea', 'a'].includes(tag) || role === 'button') {
            const label = el.innerText?.substring(0, 50) || el.getAttribute('aria-label') || '';
            const id = el.id || '';
            if (el.getBoundingClientRect().width > 0) {
              elements.push({ tag, role, label, id, type: (el as any).type });
            }
          }

          if (el.shadowRoot) Array.from(el.shadowRoot.childNodes).forEach(walk);
        }
        if (node.hasChildNodes()) Array.from(node.childNodes).forEach(walk);
      }

      walk(document.body);

      return {
        elements,
        links: Array.from(links),
        sidebarLinks: Array.from(sidebarLinks),
        pageTitle: document.title
      };
    });

    discoveredLinks.push(...result.links);
    discoveredLinks.push(...result.sidebarLinks);

    return {
      url,
      pageTitle: result.pageTitle,
      elements: result.elements,
      links: [...new Set(discoveredLinks)],
      sidebarLinks: result.sidebarLinks,
      screenshotPath,
      newlyDiscoveredCount: discoveredLinks.length
    };
  }
}
