import { Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import sharp from 'sharp';
import { TestableElement } from '../../types/index.js';
import { ScrapeResult, ScraperConfig } from './types.js';

export class Scraper {
  private static lastScreenshotHash: string | null = null;
  private static capturedModalHashes = new Set<string>(); // Track unique modal screenshots

  // Shared caches across all tabs in this process
  private static visitedSidebarButtons = new Set<string>();
  private static visitedExpansionButtons = new Set<string>();

  // [NEW] Action Chain for Golden Path
  private static actionChain: Array<{
    type: 'click' | 'nav' | 'input';
    selector: string;
    label: string;
    timestamp: string;
    url: string;
  }> = [];

  static async processPage(page: Page, url: string, config: ScraperConfig, outputDir: string): Promise<ScrapeResult> {
    const discoveredLinks: string[] = [];
    const modalDiscoveries: Array<{
      triggerText: string;
      modalTitle: string;
      elements: any[];
      links: string[];
      screenshotPath?: string;
    }> = [];

    console.log(`[Scraper] Processing: ${url}`);

    // --- NAVIGATION ---
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
    } catch (e) {
      console.error(`[Scraper] Navigation failed for ${url}: ${e}`);
      return { url, pageTitle: 'Error', elements: [], links: [], error: 'Navigation failed', newlyDiscoveredCount: 0 };
    }

    // [FIX] Smart Dashboard Navigation
    const currentUrl = page.url();
    if (currentUrl.includes('/app/logged-in') || currentUrl.endsWith('/app') || currentUrl.endsWith('/app/')) {
      console.log(`[Scraper] Detected transition page, forcing navigation to /app/home...`);
      await page.waitForTimeout(1000);
      await page.goto(new URL('/app/home', url).toString(), { waitUntil: 'networkidle' }).catch(() => { });
    }

    const targetUrl = page.url();

    // --- HELPERS ---
    const closeModals = async () => {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        const sel = '.ianai-Modal-close, .mantine-Modal-close, [aria-label="Close"], .ianai-CloseButton-root, button[class*="CloseButton"], .ianai-Drawer-close, .mantine-Drawer-close';
        document.querySelectorAll(sel).forEach(btn => (btn as HTMLElement).click());
      });
      await page.waitForTimeout(300);
    };

    const isModalOpen = async (): Promise<boolean> => {
      return await page.evaluate(() => {
        const modal = document.querySelector('.ianai-Modal-content, .mantine-Modal-content, [role="dialog"], .ianai-Drawer-content, .mantine-Drawer-content');
        if (!modal) return false;
        const style = window.getComputedStyle(modal);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
    };

    // [NEW] Settle UI and Cleanup Ghost Elements
    const settleAndCleanup = async () => {
      console.log(`[Scraper] Settling UI and cleaning ghost elements...`);
      // [FIX] Removed (1,1) click as it hits the Dashboard logo.
      // Instead, try to close open menus by sending Escape (carefully) or clicking a safe void area if possible.
      // For now, relies on CSS hiding strategy above.

      // [FIX] Smart Dismiss: Click "Stay" on "Leave without saving" modals
      try {
        const modalText = await page.innerText('body'); // Quick check
        if (modalText.includes('leave without saving') || modalText.includes('Discard') || modalText.includes('Unsaved')) {
          const stayBtn = await page.getByRole('button', { name: /Stay/i }).first();
          if (await stayBtn.isVisible()) {
            console.log('[Scraper] Detected "Leave without saving" modal - clicking "Stay" to preserve content.');
            await stayBtn.click();
            await page.waitForTimeout(300);
          }
        }
      } catch (e) { }

      await page.evaluate(() => {
        // Hide common floating elements that might get stuck
        const selectors = [
          '.mantine-Select-dropdown',
          '.mantine-MultiSelect-dropdown',
          '.mantine-Popover-dropdown',
          '.mantine-Menu-dropdown',
          '.ianai-Select-dropdown',
          '.ianai-Popover-dropdown',
          '[role="listbox"]',
          '[role="menu"]',
          '.mantine-Tooltip-root',
          'div[class*="dropdown"]',
          'div[class*="Dropdown"]',
          'div[class*="popover"]',
          'div[class*="overlay"]:not([class*="Modal"])' // Avoid hiding the modal itself
        ];
        selectors.forEach(s => {
          document.querySelectorAll(s).forEach(el => {
            // Safety: Don't hide the main modal if it happens to match generic classes
            if (!el.closest('.ianai-Modal-content') && !el.closest('.mantine-Modal-content')) {
              (el as HTMLElement).style.display = 'none';
            }
          });
        });
      }).catch(() => { });
      await page.waitForTimeout(500); // Settling Time
    };

    const extractModalContent = async (triggerText: string) => {
      if (!(await isModalOpen())) return null;
      console.log(`[Scraper] Modal detected, extracting content...`);

      const modalData = await page.evaluate(() => {
        const modal = document.querySelector('.ianai-Modal-content, .mantine-Modal-content, [role="dialog"], .ianai-Drawer-content, .mantine-Drawer-content');
        if (!modal) return null;
        const titleEl = modal.querySelector('.ianai-Modal-title, .mantine-Modal-title, h1, h2, h3, [class*="title"]');
        const modalTitle = titleEl?.textContent?.trim() || 'Untitled Modal';
        const links = Array.from(modal.querySelectorAll('a[href]')).map(a => (a as HTMLAnchorElement).href).filter(h => h && !h.startsWith('blob:') && !h.startsWith('javascript:') && h.startsWith('http'));
        const elements: any[] = [];
        modal.querySelectorAll('button, a[href], input, textarea, select, [role="button"], [role="tab"], [data-testid]').forEach((el, idx) => {
          const rect = el.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) return;
          elements.push({ id: `modal-el-${idx}`, tag: el.tagName.toLowerCase(), label: (el as HTMLElement).innerText?.trim().substring(0, 50) || el.getAttribute('aria-label') || '', inModal: true });
        });
        return { modalTitle, links, elements };
      });

      if (!modalData) return null;

      let screenshotPath: string | undefined;
      try {
        const modalEl = await page.$('.ianai-Modal-content, .mantine-Modal-content, [role="dialog"], .ianai-Drawer-content');
        if (modalEl) {
          const png = await modalEl.screenshot({ type: 'png' });

          // Check if blank
          const stats = await sharp(png).stats();
          const isBlank = stats.channels.every(ch => ch.mean > 250 && ch.stdev < 10);
          if (isBlank) {
            console.log(`[Scraper] Skipping blank modal screenshot`);
          } else {
            const webp = await sharp(png).webp({ quality: 80 }).toBuffer();
            const hash = crypto.createHash('md5').update(webp).digest('hex');

            // Check if duplicate modal
            if (Scraper.capturedModalHashes.has(hash)) {
              console.log(`[Scraper] Skipping duplicate modal screenshot (${modalData.modalTitle})`);
            } else {
              Scraper.capturedModalHashes.add(hash);
              const safeName = modalData.modalTitle.replace(/[^a-zA-Z0-9가-힣]/g, '_').substring(0, 40) || 'modal';
              const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
              screenshotPath = path.join(outputDir, `modal-${safeName}_${timestamp}.webp`);

              if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
              fs.writeFileSync(screenshotPath, webp);

              // [FIX] Save JSON metadata for Modals with matching timestamped name
              try {
                const domain = new URL(url).hostname;
                const jsonDir = path.join(outputDir, 'json', domain);
                if (!fs.existsSync(jsonDir)) fs.mkdirSync(jsonDir, { recursive: true });

                const jsonFilename = `modal-${safeName}_${timestamp}.json`;
                const jsonPath = path.join(jsonDir, jsonFilename);
                fs.writeFileSync(jsonPath, JSON.stringify({
                  url: url,
                  title: modalData.modalTitle,
                  timestamp: new Date().toISOString(),
                  hash,
                  type: 'modal'
                }, null, 2));
              } catch (e) { }

              console.log(`[Scraper] Saved unique modal: ${safeName} (version ${hash.substring(0, 6)})`);
            }
          }
        }
      } catch (e) { }

      return { triggerText, modalTitle: modalData.modalTitle, elements: modalData.elements, links: modalData.links, screenshotPath };
    };

    // [RESTORED] Coordinate-based clicking for SPA event filtering bypass
    const smartClick = async (handle: any) => {
      // [NEW] Record Action
      try {
        const txt = await handle.innerText().catch(() => '') || await handle.getAttribute('aria-label') || 'element';
        Scraper.actionChain.push({
          type: 'click',
          selector: (await handle.getAttribute('class')) || 'unknown',
          label: txt.substring(0, 30),
          timestamp: new Date().toISOString(),
          url: page.url()
        });
      } catch (e) { }

      try {
        const box = await handle.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        } else {
          await handle.click({ force: true }).catch(() => handle.evaluate((el: HTMLElement) => el.click()));
        }
      } catch (e) {
        await handle.click({ force: true }).catch(() => { });
      }
    };

    // --- PHASE 2: SPA Route Interception ---
    console.log(`[Scraper] Setting up SPA route interception...`);
    await page.evaluate(() => {
      if (!(window as any).__discoveredRoutes) (window as any).__discoveredRoutes = new Set();
      const methods = ['pushState', 'replaceState'];
      for (let i = 0; i < methods.length; i++) {
        const m = methods[i];
        const orig = (history as any)[m];
        (history as any)[m] = function (...args: any[]) {
          if (args[2]) (window as any).__discoveredRoutes.add(args[2].toString());
          return orig.apply(this, args);
        };
      }
    });

    // --- PHASE 3: Stability Wait ---
    console.log(`[Scraper] Waiting for page stability...`);
    await page.waitForFunction(() => {
      const loaders = ['.mantine-Loader-root', '.loader', '.spinner', '.loading', '[aria-busy="true"]', '.ant-spin', '.nprogress-bar'];
      for (let i = 0; i < loaders.length; i++) {
        const el = document.querySelector(loaders[i]);
        if (el) {
          const style = window.getComputedStyle(el);
          if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0) {
            return false;
          }
        }
      }
      return true;
    }, { timeout: 5000 }).catch(() => { });

    // DOM mutation stability wait
    await page.evaluate(() => {
      return new Promise<void>(resolve => {
        let t: any;
        const o = new MutationObserver(() => {
          clearTimeout(t);
          t = setTimeout(() => { o.disconnect(); resolve(); }, 800);
        });
        o.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { o.disconnect(); resolve(); }, 4000);
      });
    });

    // --- PHASE 4: Menu Expansion (Cache-aware) ---
    console.log(`[Scraper] Expanding menus (Cached: ${Scraper.visitedExpansionButtons.size})...`);
    const visitedMenus = Array.from(Scraper.visitedExpansionButtons);
    const potentialMenus = await page.evaluate((visited) => {
      const btns = Array.from(document.querySelectorAll('button[class*="_control_"]:not(a), button[class*="UnstyledButton"]:not(a), [class*="menuGroup"] button:not(a), [aria-expanded="false"]:not(a), .collapsed:not(a), details:not([open])')) as HTMLElement[];
      const result: string[] = [];
      for (let i = 0; i < btns.length; i++) {
        const txt = btns[i].innerText?.split('\n')[0]?.trim() || '';
        if (txt && txt.length > 0 && txt.length < 30 && !txt.includes('{') && !visited.includes(txt) && !txt.toLowerCase().includes('logout')) {
          result.push(txt);
        }
      }
      return result;
    }, visitedMenus);

    let expandedCount = 0;
    for (const t of potentialMenus) {
      try {
        const validButtons = await page.locator(`button:has-text("${t}"), [role="button"]:has-text("${t}")`).all();
        // [UPGRADE] Iterate all matching buttons, not just first
        for (const btn of validButtons) {
          if (await btn.isVisible()) {
            await smartClick(btn);
            Scraper.visitedExpansionButtons.add(t);
            expandedCount++;
            await page.waitForTimeout(300);

            if (page.url() !== targetUrl) {
              const navigatedUrl = page.url();
              if (navigatedUrl.startsWith('http')) discoveredLinks.push(navigatedUrl);
              console.log(`[Scraper] Menu expansion navigated to: ${navigatedUrl}. Returning...`);
              await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => { });
              await page.waitForTimeout(500);
            } else {
              // Capture links from expanded menu
              const newLinks = await page.evaluate(() => {
                const res: string[] = [];
                document.querySelectorAll('a[href]').forEach(a => {
                  const h = (a as HTMLAnchorElement).href;
                  if (h && h.startsWith('http')) res.push(h);
                });
                return res;
              });
              if (newLinks.length > 0) {
                newLinks.forEach(l => discoveredLinks.push(l));
                console.log(`[Scraper] Captured ${newLinks.length} links from expanded menu "${t}".`);
              }
            }
          }
        }
      } catch (e) { }
    }
    console.log(`[Scraper] Expanded ${expandedCount} NEW menu items.`);

    // --- AUTO-SCROLL ---
    console.log(`[Scraper] Scrolling to discover more content...`);
    try {
      if (page.isClosed()) return { url, pageTitle: 'Closed', elements: [], links: [], newlyDiscoveredCount: 0 };
      await page.waitForTimeout(500);

      await page.evaluate(() => {
        return new Promise<void>((resolve) => {
          let totalHeight = 0;
          const distance = 200;
          const timer = setInterval(() => {
            if (!document.body) { clearInterval(timer); resolve(); return; }
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;
            if (totalHeight >= scrollHeight || totalHeight > 10000) { clearInterval(timer); resolve(); }
          }, 30);
        });
      });
    } catch (e) {
      console.log(`[Scraper] Auto - scroll interrupted or page closed.`);
      if (page.isClosed()) return { url, pageTitle: 'Closed', elements: [], links: [], newlyDiscoveredCount: 0 };
    }

    // --- PHASE 5: Active Sidebar Discovery (Cache-aware) ---
    console.log(`[Scraper] Active Sidebar Discovery(Cached: ${Scraper.visitedSidebarButtons.size})...`);
    const visitedSidebar = Array.from(Scraper.visitedSidebarButtons);
    const sButtons = await page.evaluate((visited) => {
      const sidebarSelectors = ['nav', 'aside', '[role="navigation"]', '.navBar', '.sidebar', '[class*="Navbar"]', '[class*="Sidebar"]'];
      let sidebarRoots: Element[] = [];

      // [UPGRADE] Find ALL potential sidebars, not just the first one
      for (const sel of sidebarSelectors) {
        sidebarRoots.push(...Array.from(document.querySelectorAll(sel)));
      }

      // Fallback: Coordinate check only if no semantic tags found
      if (sidebarRoots.length === 0) {
        const el = document.elementFromPoint(20, 450)?.closest('div');
        if (el) sidebarRoots.push(el);
      }

      let btns: HTMLElement[] = [];
      if (sidebarRoots.length > 0) {
        sidebarRoots.forEach(root => {
          btns.push(...Array.from(root.querySelectorAll('button, [role="button"], a[role="button"], div[role="button"]')) as HTMLElement[]);
        });
      } else {
        // Last resort: Query broadly but filter strictly later
        btns = Array.from(document.querySelectorAll('.navBar button, [class*="navBar"] button, [class*="sidebar"] button, aside button, [class*="UnstyledButton"]')) as HTMLElement[];
      }

      const excludeTexts = ['miscellaneous', 'support', 'logout', '피드백', '지원', 'help', '공지사항'];
      const result: { text: string; cleanText: string; isLeaf: boolean; visible: boolean }[] = [];
      const seen = new Set<string>();

      for (let i = 0; i < btns.length; i++) {
        const b = btns[i];
        const text = b.innerText?.trim() || b.textContent?.trim() || b.getAttribute('aria-label') || '';
        const isLeaf = !b.getAttribute('aria-expanded') && !b.querySelector('svg[class*="down"]') && !b.querySelector('[class*="Chevron"]');
        const visible = b.getBoundingClientRect().height > 2;
        const firstLine = text.split('\n').map(t => t.trim()).find(t => t.length > 0) || '';
        const cleanText = firstLine.substring(0, 30).replace(/["\\]/g, '');

        if (isLeaf && visible && cleanText.length > 0 && !visited.includes(text) && !seen.has(cleanText)) {
          let excluded = false;
          for (let j = 0; j < excludeTexts.length; j++) {
            if (cleanText.toLowerCase().includes(excludeTexts[j])) { excluded = true; break; }
          }
          if (!excluded) {
            seen.add(cleanText);
            result.push({ text, cleanText, isLeaf, visible });
          }
        }
      }
      return result.slice(0, 20);
    }, visitedSidebar);

    console.log(`[Scraper] Found ${sButtons.length} potential new sidebar buttons.`);

    for (const b of sButtons) {
      Scraper.visitedSidebarButtons.add(b.text);
      try {
        const handle = await page.$(`nav button: has - text("${b.cleanText}"), aside button: has - text("${b.cleanText}"), .sidebar button: has - text("${b.cleanText}"), button: has - text("${b.cleanText}")`);
        if (handle) {
          const preUrl = page.url();
          await smartClick(handle);

          let navigated = false;
          for (let i = 0; i < 8; i++) {
            await page.waitForTimeout(500);
            if (page.url() !== preUrl) { navigated = true; break; }
            if (await isModalOpen()) break;
          }

          if (navigated) {
            discoveredLinks.push(page.url());
            await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => { });
          } else {
            const newLinks = await page.evaluate(() => {
              const res: string[] = [];
              document.querySelectorAll('a[href]').forEach(a => {
                const h = (a as HTMLAnchorElement).href;
                if (h && h.startsWith('http')) res.push(h);
              });
              return res;
            });
            if (newLinks.length > 0) {
              newLinks.forEach(l => discoveredLinks.push(l));
              console.log(`[Scraper] Sidebar click "${b.cleanText}" revealed ${newLinks.length} links.`);
            }

            const modal = await extractModalContent(`Sidebar: ${b.text} `);
            if (modal) modalDiscoveries.push(modal);
            await closeModals();
          }
        }
      } catch (e) { }
    }

    // --- PHASE 6: Table-based Row-Click Discovery ---
    console.log(`[Scraper] Discovering detail pages via Table - based Row Click...`);
    const tables = await page.$$('table, [role="table"], .mantine-Table-root, [class*="Table"]');
    console.log(`[Scraper] Found ${tables.length} tables to investigate.`);

    let emptyTables = 0;
    for (const table of tables) {
      try {
        const rows = await table.$$('tbody tr, [role="row"]');
        if (rows.length === 0) { emptyTables++; continue; }

        const rowIndex = rows.length > 1 ? 1 : 0;
        const row = rows[rowIndex];

        await closeModals();
        const rowText = await row.evaluate((el: HTMLElement) => el.innerText?.trim().substring(0, 50).replace(/\n/g, ' | ') || '');
        if (rowText.toLowerCase().includes('name') && rowText.toLowerCase().includes('type')) continue;

        console.log(`[Scraper] Clicking target row: "${rowText}"`);
        const preUrl = page.url();

        // Priority-based target selection
        let target = await row.$('a[href]:not([href="#"]):not([href^="javascript"])');
        let actionType = 'Link';

        if (!target) {
          target = await row.$('button:has-text("View"), button:has-text("Detail"), button:has-text("Edit"), [role="button"]:has-text("View")');
          if (target) actionType = 'Action Button';
        }

        if (!target) {
          let cell = await row.$('td:nth-child(2)');
          if (cell) {
            const hasButton = await cell.$('button, [role="button"], input[type="checkbox"]');
            const text = await cell.innerText();
            if (hasButton || !text.trim()) cell = await row.$('td:nth-child(3)');
          }
          if (cell) {
            target = await cell.$('span, div') || cell;
            actionType = 'Cell Content';
          }
        }

        if (!target) { target = row; actionType = 'Row Fallback'; }

        if (target && !(await target.isVisible().catch(() => false))) continue;

        await target.hover().catch(() => { });
        console.log(`[Scraper] Interaction Strategy: ${actionType} `);

        // Network monitoring
        let detectedApiCall = false;
        const networkListener = (req: any) => {
          const u = req.url().toLowerCase();
          const rType = req.resourceType();
          const isApi = (u.includes('/api/') || /uuid|history|detail|get/i.test(u)) && (rType === 'fetch' || rType === 'xhr');
          const isAsset = /\.(js|css|webp|png|jpg|jpeg|svg|woff2|woff|json)/i.test(u);
          if (isApi && !isAsset) detectedApiCall = true;
        };
        page.on('request', networkListener);

        await smartClick(target);
        console.log(`[Scraper] Row click sent.Monitoring for response...`);

        let handled = false;
        for (let p = 0; p < 10; p++) {
          await page.waitForTimeout(500);
          const curUrl = page.url();

          if (await isModalOpen()) {
            const modal = await extractModalContent(rowText);
            if (modal) {
              console.log(`[Scraper] ✓ Modal found: "${modal.modalTitle}"`);
              modalDiscoveries.push(modal);
              discoveredLinks.push(...modal.links);
            }
            handled = true;
            await closeModals();
            if (curUrl !== preUrl) await page.goBack().catch(() => { });
            break;
          }

          if (curUrl !== preUrl && (curUrl.startsWith('http:') || curUrl.startsWith('https:'))) {
            console.log(`[Scraper] ✓ URL Change detected: ${curUrl} `);
            await page.waitForLoadState('domcontentloaded').catch(() => { });

            // Wait for loaders to disappear before capture
            await page.waitForFunction(() => {
              const loaders = ['.mantine-Loader-root', '.loader', '.spinner', '.loading', '[aria-busy="true"]', '.ant-spin', '.nprogress-bar', '.ianai-Loader'];
              for (let i = 0; i < loaders.length; i++) {
                const el = document.querySelector(loaders[i]);
                if (el) {
                  const style = window.getComputedStyle(el);
                  if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0) {
                    return false;
                  }
                }
              }
              return true;
            }, { timeout: 5000 }).catch(() => { });
            await page.waitForTimeout(500);

            await settleAndCleanup();

            // [IMMEDIATE CAPTURE] Detail page screenshot and elements
            const pageData = await page.evaluate(() => {
              const els: any[] = [];
              document.querySelectorAll('button, a[href], input, textarea, select, [role="button"]').forEach((el, idx) => {
                const r = el.getBoundingClientRect();
                if (r.width < 5 || r.height < 5) return;
                els.push({
                  id: `detail - el - ${idx} `,
                  tag: el.tagName.toLowerCase(),
                  label: (el as HTMLElement).innerText?.trim().substring(0, 50) || el.getAttribute('aria-label') || '',
                  type: (el as any).type || ''
                });
              });
              return { title: document.title, elements: els.slice(0, 50) };
            });

            // Generate meaningful detail page filename
            const detailUrlObj = new URL(curUrl);
            const detailPath = detailUrlObj.pathname.replace(/\//g, '-').replace(/^-|-$/g, '') || 'detail';
            let scPath: string | undefined = path.join(outputDir, `detail - ${detailPath.substring(0, 50)}.webp`);
            try {
              if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
              const png = await page.screenshot({ fullPage: true, type: 'png' });

              // Check if screenshot is mostly blank (white/empty page)
              const stats = await sharp(png).stats();
              const isBlank = stats.channels.every(ch => ch.mean > 250 && ch.stdev < 10);
              if (isBlank) {
                console.log(`[Scraper] Skipping blank detail screenshot for ${curUrl}`);
                scPath = undefined;
              } else {
                const webp = await sharp(png).webp({ quality: 80 }).toBuffer();
                fs.writeFileSync(scPath, webp);
              }
            } catch (e) { scPath = undefined; }

            modalDiscoveries.push({
              triggerText: `Row Click: ${rowText} `,
              modalTitle: `Page: ${pageData.title} `,
              elements: pageData.elements,
              links: [curUrl],
              screenshotPath: scPath
            });

            discoveredLinks.push(curUrl);
            console.log(`[Scraper] Detail captured, returning to list...`);
            await page.goBack({ waitUntil: 'networkidle' }).catch(() => { });
            await page.waitForTimeout(500);
            if (page.url() !== preUrl) await page.goto(preUrl, { waitUntil: 'networkidle' });
            handled = true;
            break;
          }

          if (detectedApiCall && p > 2 && !handled) { handled = true; break; }
        }

        page.off('request', networkListener);
        await closeModals();
      } catch (e) {
        await closeModals();
      }
    }
    if (emptyTables > 0) console.log(`[Scraper] Skipped ${emptyTables} empty tables.`);

    // --- PHASE 7: Global Action Discovery ---
    console.log(`[Scraper] Global Action Discovery...`);
    const allBtns = await page.$$('button, [role="button"], a[class*="Button"], a[class*="btn"]');
    const matches: { b: any; t: string }[] = [];

    for (const b of allBtns) {
      try {
        const t = await b.innerText();
        if (/new|create|add|plus|generate|edit|view|scan|print|수정|보기|생성|추가|등록|신규|인쇄/i.test(t)) {
          matches.push({ b, t });
        }
      } catch (e) { }
    }

    // Prioritize Create/New actions
    matches.sort((a, b) => {
      const aIsCreate = /new|create|add|plus|생성|추가|등록|신규/i.test(a.t);
      const bIsCreate = /new|create|add|plus|생성|추가|등록|신규/i.test(b.t);
      if (aIsCreate && !bIsCreate) return -1;
      if (!aIsCreate && bIsCreate) return 1;
      return 0;
    });

    for (const m of matches.slice(0, 5)) {
      try {
        await closeModals();
        console.log(`[Scraper] Testing global action: "${m.t}"`);
        const preUrl = page.url();
        await smartClick(m.b);
        await page.waitForTimeout(1500);

        if (await isModalOpen()) {
          const modal = await extractModalContent(`Action: ${m.t} `);
          if (modal) {
            console.log(`[Scraper] ✓ Action "${m.t}" opened modal: "${modal.modalTitle}"`);
            modalDiscoveries.push(modal);
            discoveredLinks.push(...modal.links);
          }
          await closeModals();
        } else if (page.url() !== preUrl && page.url().startsWith('http')) {
          console.log(`[Scraper] ✓ Action "${m.t}" navigated to: ${page.url()} `);
          discoveredLinks.push(page.url());
          await page.goBack({ waitUntil: 'networkidle' }).catch(() => { });
        }
      } catch (e) { }
    }

    // --- SCREENSHOT ---
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    let screenshotPath = '';
    try {
      // Wait for any remaining loaders to finish before final screenshot
      await page.waitForFunction(() => {
        const loaders = ['.mantine-Loader-root', '.loader', '.spinner', '.loading', '[aria-busy="true"]', '.ant-spin', '.nprogress-bar', '.ianai-Loader'];
        for (let i = 0; i < loaders.length; i++) {
          const el = document.querySelector(loaders[i]);
          if (el) {
            const style = window.getComputedStyle(el);
            if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0) {
              return false;
            }
          }
        }
        return true;
      }, { timeout: 5000 }).catch(() => { });

      await settleAndCleanup();

      // Generate meaningful filename from URL path
      const urlObj = new URL(url);
      // [FIX] Normalize /app and /app/ to 'home' to avoid duplicates
      let urlPath = urlObj.pathname.replace(/^\/|\/$/g, '');
      if (urlPath === 'app' || urlPath === '') urlPath = 'app-home';

      const pageName = urlPath.replace(/\//g, '-').substring(0, 50) || 'home';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      screenshotPath = path.join(outputDir, `${pageName}_${timestamp}.webp`);

      const png = await page.screenshot({ fullPage: true, type: 'png' });

      // Check if screenshot is mostly blank (white/empty page)
      const stats = await sharp(png).stats();
      const isBlank = stats.channels.every(ch => ch.mean > 250 && ch.stdev < 10);
      if (isBlank) {
        console.log(`[Scraper] Skipping blank screenshot for ${url}`);
        screenshotPath = '';
      } else {
        const webp = await sharp(png).webp({ quality: 80 }).toBuffer();
        const hash = crypto.createHash('md5').update(webp).digest('hex');

        // We always save with timestamp now to provide history, but still check hash to log duplicates
        fs.writeFileSync(screenshotPath, webp);

        // [FIX] Save metadata with EXACT SAME timestamped name for easy mapping
        const domain = new URL(url).hostname;
        const jsonDir = path.join(path.dirname(screenshotPath), 'json', domain);
        if (!fs.existsSync(jsonDir)) fs.mkdirSync(jsonDir, { recursive: true });

        const jsonFilename = `${pageName}_${timestamp}.json`;
        const jsonPath = path.join(jsonDir, jsonFilename);
        fs.writeFileSync(jsonPath, JSON.stringify({
          url,
          timestamp: new Date().toISOString(),
          hash,
          // [NEW] Save Action Chain
          actionChain: Scraper.actionChain
        }, null, 2));

        if (hash === Scraper.lastScreenshotHash) {
          // console.log(`[Scraper] Note: Visual duplicate of previous step: ${ url } `);
        }
        Scraper.lastScreenshotHash = hash;
      }
    } catch (e) { }

    // --- FULL EXTRACTION (For Analyzer) ---
    // Use stack-based iteration to avoid esbuild's __name helper issue in browser context
    const result = await page.evaluate(() => {
      const elements: any[] = [];
      const links = new Set<string>();
      const sidebarLinks = new Set<string>();

      // Stack-based DOM traversal
      const stack: Node[] = [document.body];
      while (stack.length > 0) {
        const node = stack.pop()!;

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
          const role = el.getAttribute('role');
          if (['button', 'input', 'select', 'textarea', 'a'].includes(tag) || role === 'button') {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0) {
              const label = el.innerText?.substring(0, 50) || el.getAttribute('aria-label') || '';
              const elId = el.id || `auto - ${elements.length} `;
              const inputType = (el as HTMLInputElement).type || '';

              let elType = 'custom';
              if (tag === 'button' || role === 'button') elType = 'button';
              else if (tag === 'a') elType = 'link';
              else if (tag === 'select') elType = 'select';
              else if (tag === 'textarea') elType = 'textarea';
              else if (tag === 'input') {
                if (inputType === 'checkbox') elType = 'checkbox';
                else if (inputType === 'radio') elType = 'radio';
                else if (inputType === 'file') elType = 'file-input';
                else elType = 'text-input';
              }

              let selector = tag;
              if (el.id) selector = `#${el.id} `;
              else if (el.getAttribute('data-testid')) selector = `[data - testid= "${el.getAttribute('data-testid')}"]`;
              else if (el.className) selector = `${tag}.${el.className.split(' ')[0]} `;

              elements.push({
                id: elId,
                selector,
                testId: el.getAttribute('data-testid') || undefined,
                tag,
                type: elType,
                label,
                rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
                sectionIndex: 0,
                state: {
                  visible: rect.width > 0 && rect.height > 0,
                  enabled: !(el as HTMLButtonElement).disabled,
                  required: (el as HTMLInputElement).required || false
                },
                attributes: {
                  href: el.getAttribute('href') || '',
                  placeholder: el.getAttribute('placeholder') || '',
                  value: (el as HTMLInputElement).value || '',
                  role: role || ''
                }
              });
            }
          }

          if (el.shadowRoot) {
            for (let i = el.shadowRoot.childNodes.length - 1; i >= 0; i--) {
              stack.push(el.shadowRoot.childNodes[i]);
            }
          }
        }

        if (node.hasChildNodes()) {
          for (let i = node.childNodes.length - 1; i >= 0; i--) {
            stack.push(node.childNodes[i]);
          }
        }
      }

      return {
        elements,
        links: Array.from(links),
        sidebarLinks: Array.from(sidebarLinks),
        pageTitle: document.title
      };
    });

    discoveredLinks.push(...result.links);
    discoveredLinks.push(...result.sidebarLinks);

    // Deduplicate and filter links
    const baseHost = new URL(url).hostname.split('.').slice(-2).join('.'); // [UPGRADE] Base domain (e.g. ianai.co)

    const filteredLinks = [...new Set(discoveredLinks)].filter(l => {
      try {
        const u = new URL(l);
        // [UPGRADE] Allow subdomains (e.g. app.ianai.co vs stage.ianai.co) as long as base domain matches
        const linkHost = u.hostname;
        const isInternal = linkHost.endsWith(baseHost);

        if (!isInternal) {
          console.log(`[Scraper] Skipped External: ${l}`); // [UPGRADE] Trace Logging
          return false;
        }
        if (l.includes('/app/support') || l.includes('miscellaneous')) return false;

        return true;
      } catch { return false; }
    });

    return {
      url,
      pageTitle: result.pageTitle,
      elements: result.elements,
      links: filteredLinks,
      sidebarLinks: result.sidebarLinks,
      screenshotPath,
      modalDiscoveries,
      newlyDiscoveredCount: filteredLinks.length,
      actionChain: Scraper.actionChain // [NEW] Pass action chain
    };
  }
}
