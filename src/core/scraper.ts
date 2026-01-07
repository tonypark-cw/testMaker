import { chromium, Browser } from 'playwright';
import { TestableElement } from '../../types/index.js';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import sharp from 'sharp';

export interface ScrapeOptions {
  url: string;
  outputDir: string;
  authFile?: string;
  saveAuthFile?: string;
  manualAuth?: boolean;
  username?: string;
  password?: string;
  screenshotName?: string;
  expandMenus?: boolean;
  hoverDiscover?: boolean;
  clickDiscover?: boolean;
  spaMode?: boolean;
  waitStrategy?: string;
  headless?: boolean;
}

export class Scraper {
  private browser: Browser | null = null;
  private lastScreenshotHash: string | null = null;

  // Session-level caches to prevent redundant navigation exploration
  private static visitedSidebarButtons = new Set<string>();
  private static visitedExpansionButtons = new Set<string>();

  async init(headless: boolean = true) {
    this.browser = await chromium.launch({ headless });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async scrape(options: ScrapeOptions): Promise<{
    elements: TestableElement[];
    pageTitle: string;
    screenshotPath?: string;
    discoveredLinks: string[];
    sidebarLinks: string[];
    modalDiscoveries?: Array<{
      triggerText: string;
      modalTitle: string;
      elements: TestableElement[];
      links: string[];
      screenshotPath?: string;
    }>;
  }> {
    const { url, outputDir, authFile, manualAuth, username, password, screenshotName } = options;
    const clickDiscoveredLinks: string[] = [];
    const modalDiscoveries: Array<{
      triggerText: string;
      modalTitle: string;
      elements: TestableElement[];
      links: string[];
      screenshotPath?: string;
    }> = [];

    // If manual auth is requested, we must run in headful mode
    if (!this.browser) await this.init(manualAuth ? false : (options.headless !== undefined ? options.headless : true));

    const contextOptions: any = { viewport: { width: 1440, height: 900 } };
    if (authFile && fs.existsSync(authFile)) {
      console.log(`[Scraper] Loading storage state from ${authFile}...`);
      contextOptions.storageState = authFile;
    }

    const context = await this.browser!.newContext(contextOptions);

    // [DEBUG] Start Tracing
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

    const page = await context.newPage();

    // --- INITIAL NAVIGATION & AUTH ---
    if (manualAuth) {
      console.log(`[Scraper] MANUAL AUTH MODE: Navigating to ${url}...`);
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      await page.pause();
    } else if (username && password) {
      console.log(`[Scraper] AUTOMATED LOGIN MODE: Navigating to ${url}...`);
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      const emailField = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i], input[type="text"]').first();
      const passwordField = page.locator('input[type="password"], input[name="password"], input[placeholder*="password" i]').first();

      // Wait for fields to appear
      await emailField.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });

      if (await emailField.isVisible().catch(() => false) && await passwordField.isVisible().catch(() => false)) {
        console.log(`[Scraper] Login fields detected. Attempting to sign in...`);
        await emailField.fill(username);
        await passwordField.fill(password);
        await page.locator('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")').first().click();
        // [OPTIMIZATION] Fast Login Transition
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
      }
    } else {
      console.log(`[Scraper] Navigating to ${url}...`);
      const waitState = (options.waitStrategy === 'dynamic' ? 'networkidle' : options.waitStrategy) as any;
      await page.goto(url, { waitUntil: waitState || 'networkidle', timeout: 60000 });
    }

    // [FIX] Smart Dashboard Navigation
    // Only force navigation to /app/home if we are stuck on a landing/transition page
    if (!manualAuth) {
      const currentUrl = page.url();
      const needsDashboardForce = currentUrl.includes('/app/logged-in') || currentUrl.endsWith('/app') || currentUrl.endsWith('/app/');

      if (needsDashboardForce) {
        console.log(`[Scraper] 🧭 detected transition page (${currentUrl}), forcing navigation to /app/home...`);
        await page.waitForTimeout(3000); // Wait for auth cookie to settle
        try {
          await page.goto(new URL('/app/home', url).toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => console.log('[Scraper] Network idle wait timed out, proceeding...'));
        } catch (e) {
        }
        await page.waitForTimeout(500); // [OPTIMIZATION] Reduced stability wait
      } else {
        console.log(`[Scraper] 🛡️ Already at target or dashboard (${currentUrl}), skipping force navigation.`);
      }
    }

    // --- PHASE 1: HELPERS ---
    const closeModals = async () => {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        const sel = '.ianai-Modal-close, .mantine-Modal-close, [aria-label="Close"], .ianai-CloseButton-root, button[class*="CloseButton"]';
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

    const extractModalContent = async (triggerText: string): Promise<typeof modalDiscoveries[0] | null> => {
      if (!(await isModalOpen())) return null;
      console.log(`[Scraper] Modal detected, extracting content...`);
      const modalData = await page.evaluate(() => {
        const modal = document.querySelector('.ianai-Modal-content, .mantine-Modal-content, [role="dialog"], .ianai-Drawer-content, .mantine-Drawer-content');
        if (!modal) return null;
        const titleEl = modal.querySelector('.ianai-Modal-title, .mantine-Modal-title, h1, h2, h3, [class*="title"]');
        const modalTitle = titleEl?.textContent?.trim() || 'Untitled Modal';
        const links = Array.from(modal.querySelectorAll('a[href]')).map(a => (a as HTMLAnchorElement).href).filter(h => h && !h.startsWith('blob:') && !h.startsWith('javascript:'));
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
          const safeName = triggerText.replace(/[^a-zA-Z0-9가-힣]/g, '_').substring(0, 30);
          screenshotPath = path.join(outputDir, `modal-${safeName}.webp`);
          const png = await modalEl.screenshot({ type: 'png' });
          const webp = await sharp(png).webp({ quality: 80 }).toBuffer();
          if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
          fs.writeFileSync(screenshotPath, webp);
        }
      } catch (e) { }
      return { triggerText, modalTitle: modalData.modalTitle, elements: modalData.elements, links: modalData.links, screenshotPath };
    };

    const smartClick = async (handle: any) => {
      const box = await handle.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      } else {
        await handle.click({ force: true }).catch(() => handle.evaluate((el: HTMLElement) => el.click()));
      }
    };

    // --- PHASE 2: SPA Route Interception ---
    if (options.spaMode !== false) {
      await page.evaluate(() => {
        if (!(window as any).__discoveredRoutes) (window as any).__discoveredRoutes = new Set();
        ['pushState', 'replaceState'].forEach(m => {
          const orig = (history as any)[m];
          (history as any)[m] = function (...args: any[]) {
            if (args[2]) (window as any).__discoveredRoutes.add(args[2].toString());
            return orig.apply(this, args);
          };
        });
      });
    }

    // --- PHASE 3: Stability Wait ---
    if (options.waitStrategy !== 'load') {
      await page.waitForFunction(() => {
        const loaders = ['.mantine-Loader-root', '.loader', '.spinner', '.loading', '[aria-busy="true"]', '.ant-spin', '.nprogress-bar'];
        return !loaders.some(sel => {
          const el = document.querySelector(sel);
          if (!el) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;
        });
      }, { timeout: 5000 }).catch(() => { });
      await page.evaluate(`new Promise(r => { let t; const o = new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => { o.disconnect(); r(); }, 800); }); o.observe(document.body, { childList: true, subtree: true }); setTimeout(() => { o.disconnect(); r(); }, 4000); })`);
    }

    const targetUrl = page.url();

    // --- PHASE 4: Recursive Menu Expansion (Cache-aware) ---
    if (options.expandMenus !== false) {
      console.log(`[Scraper] Expanding all menus (Current session total: ${Scraper.visitedExpansionButtons.size})...`);
      const v = Array.from(Scraper.visitedExpansionButtons);
      const expansionButtonsText = await page.evaluate((visited) => {
        const btns = Array.from(document.querySelectorAll('button[class*="_control_"]:not(a), button[class*="UnstyledButton"]:not(a), [class*="menuGroup"] button:not(a), [aria-expanded="false"]:not(a), .collapsed:not(a), details:not([open])')) as HTMLElement[];
        return btns.map(b => {
          // [FIX] Use innerText to avoid capturing hidden CSS/SVG code
          // Take only the first line and limit length
          const txt = b.innerText?.split('\n')[0]?.trim() || '';
          return txt;
        }).filter(t => t && t.length > 0 && t.length < 30 && !t.includes('{') && !visited.includes(t) && !t.toLowerCase().includes('logout'));
      }, v).catch(() => []);

      let expandedCount = 0;
      for (const t of expansionButtonsText) {
        try {
          const btn = await page.locator(`button:has-text("${t}"), [role="button"]:has-text("${t}")`).first();
          if (await btn.isVisible()) {
            await smartClick(btn);
            Scraper.visitedExpansionButtons.add(t);
            expandedCount++;
            await page.waitForTimeout(300);

            // Check if click navigated away
            if (page.url() !== targetUrl) {
              const navigatedUrl = page.url();
              if (navigatedUrl.startsWith('http')) clickDiscoveredLinks.push(navigatedUrl);
              console.log(`[Scraper] Menu expansion navigated to: ${navigatedUrl}. Returning...`);
              await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => { });
              await page.waitForTimeout(500);
            } else {
              // [NEW] No navigation, but menu expanded. CAPTURE LINKS IMMEDIATELY.
              const newLinks = await page.evaluate(() => {
                const res: string[] = [];
                document.querySelectorAll('a[href]').forEach(a => {
                  const h = (a as HTMLAnchorElement).href;
                  if (h && (h.startsWith('http') || h.startsWith('https'))) res.push(h);
                });
                return res;
              });
              if (newLinks.length > 0) {
                newLinks.forEach(l => clickDiscoveredLinks.push(l));
                console.log(`[Scraper] Captured ${newLinks.length} links from expanded menu "${t}".`);
              }
            }
          }
        } catch (e) {
          console.log(`[Scraper] Menu expansion failed for "${t}": ${(e as Error).message}`);
        }
      }
      console.log(`[Scraper] Expanded ${expandedCount} NEW menu items.`);
    }

    // --- AUTO-SCROLL (Ported) ---
    console.log(`[Scraper] Scrolling to discover more content...`);
    await page.waitForTimeout(500); // [OPTIMIZATION] Reduced stability wait
    try {
      await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
          let totalHeight = 0;
          const distance = 200; // [OPTIMIZATION] Increased scroll distance
          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;
            if (totalHeight >= scrollHeight || totalHeight > 10000) { clearInterval(timer); resolve(); }
          }, 30); // [OPTIMIZATION] Faster interval
        });
      });
    } catch (e) {
      console.log(`[Scraper] Auto-scroll interrupted: ${(e as Error).message.split('\n')[0]}`);
    }

    // --- PHASE 5: Active Sidebar Discovery (Cache-aware) ---
    const vsb = Array.from(Scraper.visitedSidebarButtons);
    const sButtons = await page.evaluate((visited) => {
      const sidebarSelectors = ['.navBar', 'nav', 'aside', '.sidebar', '[role="navigation"]', '[class*="Navbar"]'];
      let sidebar: Element | null = null;
      for (const sel of sidebarSelectors) {
        sidebar = document.querySelector(sel);
        if (sidebar) break;
      }
      if (!sidebar) sidebar = document.elementFromPoint(20, 450)?.closest('div') || null;
      // [FIX] Fallback: If no specific sidebar container found, search globally for known sidebar button patterns (Like Main branch)
      let btns: HTMLElement[] = [];
      if (sidebar) {
        btns = Array.from(sidebar.querySelectorAll('button, [role="button"]')) as HTMLElement[];
      } else {
        // Fallback to global search for sidebar-like buttons
        btns = Array.from(document.querySelectorAll('.navBar button, [class*="navBar"] button, [class*="sidebar"] button, aside button, [class*="UnstyledButton"], [class*="menuGroup"] button')) as HTMLElement[];
      }

      const excludeTexts = ['miscellaneous', 'support', 'logout', '피드백', '지원', 'help', '공지사항'];
      return btns.map(b => ({
        text: b.innerText?.trim() || b.textContent?.trim() || b.getAttribute('aria-label') || '',
        isLeaf: !b.getAttribute('aria-expanded') && !b.querySelector('svg[class*="down"]') && !b.querySelector('[class*="Chevron"]'),
        visible: b.getBoundingClientRect().height > 2
      })).filter(b => b.isLeaf && b.visible && b.text && !visited.includes(b.text) && !excludeTexts.some(ex => b.text.toLowerCase().includes(ex))).slice(0, 20);
    }, vsb);

    // [FIX] Sanitize button texts to prevent BADSTRING errors (e.g. multi-line text)
    // [FIX] Deduplicate buttons by text to serve unique actions
    const uniqueTexts = new Set<string>();
    const sanitizedButtons = sButtons.map(b => {
      // Split by newline and take the first non-empty line
      const firstLine = b.text.split('\n').map(t => t.trim()).find(t => t.length > 0) || '';
      // Limit length and remove problematic characters
      const cleanText = firstLine.substring(0, 30).replace(/["\\]/g, '');
      return { ...b, cleanText };
    }).filter(b => {
      if (b.cleanText.length === 0) return false;
      if (uniqueTexts.has(b.cleanText)) return false;
      uniqueTexts.add(b.cleanText);
      return true;
    });

    console.log(`[Scraper] Found ${sanitizedButtons.length} potential new sidebar buttons: ${sanitizedButtons.map(b => b.cleanText).join(', ')}`);

    try {
      for (const b of sanitizedButtons) {
        Scraper.visitedSidebarButtons.add(b.text); // Mark original full text as visited
        try {
          const handle = await page.$(`nav button:has-text("${b.cleanText}"), aside button:has-text("${b.cleanText}"), .sidebar button:has-text("${b.cleanText}"), button:has-text("${b.cleanText}")`);
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
              clickDiscoveredLinks.push(page.url());
              await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => { });
            } else {
              // [NEW] Check for new links revealed by this click (e.g. sidebar submenu expansion)
              const newLinks = await page.evaluate(() => {
                const res: string[] = [];
                document.querySelectorAll('a[href]').forEach(a => {
                  const h = (a as HTMLAnchorElement).href;
                  if (h && (h.startsWith('http') || h.startsWith('https'))) res.push(h);
                });
                return res;
              });
              if (newLinks.length > 0) {
                newLinks.forEach(l => clickDiscoveredLinks.push(l));
                console.log(`[Scraper] Sidebar click "${b.text}" revealed ${newLinks.length} links.`);
              }

              const modal = await extractModalContent(`Sidebar: ${b.text}`);
              if (modal) modalDiscoveries.push(modal);
              await closeModals();
            }
          }
        } catch (e) {
          const errMsg = (e as Error).message.split('\n')[0].substring(0, 100);
          console.log(`[Scraper] Sidebar interaction failed for "${b.cleanText}": ${errMsg}...`);
        }
      }
    } catch (e) {
      console.log(`[Scraper] Phase 5 (Sidebar Discovery) critical error: ${(e as Error).message.split('\n')[0]}`);
    }

    // --- PHASE 6: Row-Click & Modals ---
    if (options.clickDiscover !== false) {
      console.log(`[Scraper] Discovering detail pages via Table-based Row Click...`);

      // Find all tables
      const tables = await page.$$('table, [role="table"], .mantine-Table-root, [class*="Table"]');
      console.log(`[Scraper] Found ${tables.length} tables to investigate.`);

      let emptyTables = 0;
      for (const table of tables) {
        try {
          // Identify row within this specific table
          const rows = await table.$$('tbody tr, [role="row"]');
          if (rows.length === 0) {
            emptyTables++;
            continue;
          }

          // Prefer 2nd row, fall back to 1st
          const rowIndex = rows.length > 1 ? 1 : 0;
          const row = rows[rowIndex];

          await closeModals();
          const rowText = await row.evaluate((el: HTMLElement) => el.innerText?.trim().substring(0, 50).replace(/\n/g, ' | ') || '');
          if (rowText.toLowerCase().includes('name') && rowText.toLowerCase().includes('type')) continue;

          console.log(`[Scraper] Clicking target row index ${rowIndex}: "${rowText}"`);
          const preUrl = page.url();

          // [FIX] Robust Row Interaction Strategy
          // Priority 1: Semantic Links (Strongest signal for navigation)
          let target = await row.$('a[href]:not([href="#"]):not([href^="javascript"])');
          let actionType = 'Link';

          // Priority 2: Standard Action Buttons (View, Edit, Detail)
          if (!target) {
            // [FIX] Exclude "Menu" or "Options" buttons (usually dropdowns) to prefer Row Click for Modals
            target = await row.$('button:has-text("View"), button:has-text("Detail"), button:has-text("Edit"), [role="button"]:has-text("View")');
            if (target) {
              const txt = await target.innerText();
              if (/menu|option|메뉴|옵션/i.test(txt)) target = null;
            }
            if (target) actionType = 'Action Button';
          }

          // Priority 3: Meaningful Cell Content (Skip columns with buttons/checkboxes)
          if (!target) {
            // Try 2nd column first
            let cell = await row.$('td:nth-child(2)');
            // Check if 2nd column contains a button (like Menu/Options) or is empty
            if (cell) {
              const hasButton = await cell.$('button, [role="button"], input[type="checkbox"]');
              const text = await cell.innerText();
              if (hasButton || !text.trim()) {
                // If 2nd column is action/empty, try 3rd column
                cell = await row.$('td:nth-child(3)');
              }
            }
            // If still valid, use it
            if (cell) {
              target = await cell.$('span, div') || cell;
              actionType = 'Cell Content';
            }
          }

          // Fallback: The Row Itself
          if (!target) {
            target = row;
            actionType = 'Row Fallback';
          }

          // [OPTIMIZATION] Skip check if target is not clickable/visible
          if (target && !(await target.isVisible().catch(() => false))) {
            console.log(`[Scraper] Target (${actionType}) not visible. Skipping.`);
            continue;
          }

          // Hover to trigger any hidden actions
          await target.hover().catch(() => { });
          console.log(`[Scraper] Interaction Strategy: ${actionType}`);

          // [NETWORK CAPTURE] Monitor for API traffic on click
          let detectedApiCall = false;
          const networkListener = (req: any) => {
            const u = req.url().toLowerCase();
            const rType = req.resourceType();
            // Exclude static assets/noise, focus on real data APIs
            const isApi = (u.includes('/api/') || /uuid|history|detail|get/i.test(u)) &&
              (rType === 'fetch' || rType === 'xhr');
            const isAsset = /\.(js|css|webp|png|jpg|jpeg|svg|woff2|woff|json)/i.test(u);

            if (isApi && !isAsset) {
              detectedApiCall = true;
            }
          };
          page.on('request', networkListener);

          await smartClick(target);
          console.log(`[Scraper] Row click sent. Monitoring for response...`);

          let handled = false;
          // [OPTIMIZATION] High-frequency polling (8 * 200ms = 1.6s)
          const waitLimit = 8;
          for (let p = 0; p < waitLimit; p++) {
            await page.waitForTimeout(200);
            const curUrl = page.url();

            // Case 1: Navigation or API-driven content update
            if (curUrl !== preUrl || (detectedApiCall && !handled)) {

              // [FIX] Check for Modal FIRST even if URL changed (some apps update URL for modals)
              if (await isModalOpen()) {
                const modal = await extractModalContent(rowText);
                if (modal) {
                  console.log(`[Scraper] ✓ Modal found (with URL change): "${modal.modalTitle}"`);
                  modalDiscoveries.push(modal);
                  clickDiscoveredLinks.push(...modal.links);
                  handled = true;

                  // If we navigated, we might need to go back, or just close modal
                  if (curUrl !== preUrl) {
                    await closeModals();
                    if (page.url() !== preUrl) await page.goBack().catch(() => { });
                  } else {
                    await closeModals();
                  }
                  break;
                }
              }

              if (curUrl !== preUrl && (curUrl.startsWith('http:') || curUrl.startsWith('https:'))) {
                // ... Existing Detail Page Logic matches ...
                console.log(`[Scraper] ✓ URL Change detected: ${curUrl}`);
                await page.waitForLoadState('domcontentloaded').catch(() => { }); // Optimizing wait strategy
                await page.waitForTimeout(500); // Reduced extra wait

                // [IMMEDIATE CAPTURE] Extract elements/screenshot for the detail page
                const pageData = await page.evaluate(() => {
                  const els: any[] = [];
                  document.querySelectorAll('button, a[href], input, textarea, select, [role="button"]').forEach((el, idx) => {
                    const r = el.getBoundingClientRect();
                    if (r.width < 5 || r.height < 5) return;
                    els.push({
                      id: `detail-el-${idx}`,
                      tag: el.tagName.toLowerCase(),
                      label: (el as HTMLElement).innerText?.trim().substring(0, 50) || el.getAttribute('aria-label') || '',
                      type: (el as any).type || ''
                    });
                  });
                  return { title: document.title, elements: els.slice(0, 50) };
                });

                const scPath = path.join(outputDir, `detail-${Date.now()}.webp`);
                try {
                  const png = await page.screenshot({ fullPage: true, type: 'png' });
                  const webpost = await sharp(png).webp({ quality: 80 }).toBuffer();
                  fs.writeFileSync(scPath, webpost);
                } catch (e) { }

                // Add to modalDiscoveries structure for consistent reporting
                modalDiscoveries.push({
                  triggerText: `Row Click: ${rowText}`,
                  modalTitle: `Page: ${pageData.title}`,
                  elements: pageData.elements as any,
                  links: [curUrl],
                  screenshotPath: scPath
                });

                clickDiscoveredLinks.push(curUrl);

                // Return to list
                console.log(`[Scraper] Detail captured, returning to list...`);
                await page.goBack({ waitUntil: 'networkidle' }).catch(() => { });
                await page.waitForTimeout(1000);
                if (page.url() !== preUrl) await page.goto(preUrl, { waitUntil: 'networkidle' });
                handled = true; break;
              }

              // Case 2: Modal opened
              if (await isModalOpen()) {
                const modal = await extractModalContent(rowText);
                if (modal) {
                  console.log(`[Scraper] ✓ Modal found: "${modal.modalTitle}"`);
                  modalDiscoveries.push(modal);
                  clickDiscoveredLinks.push(...modal.links);
                }
                handled = true; break;
              }
            }

            if (handled) break;
          }

          if (!handled) {
            console.log(`[Scraper] ✗ No navigation/modal. Checking action buttons in row...`);
            const btns = await row.$$('button, a[role="button"], [role="button"]');
            for (const b of btns) {
              try {
                const t = await b.innerText();
                // AVOID DESTRUCTIVE BUTTONS
                if (/delete|remove|cancel|discard|삭제|취소/i.test(t)) continue;

                if (/edit|modify|update|view|detail|add|create|new|print|scan|수정|편집|상세|생성|추가|인쇄/i.test(t)) {
                  await smartClick(b);
                  await page.waitForTimeout(2000);
                  const modal = await extractModalContent(`${rowText} - ${t}`);
                  if (modal) {
                    modalDiscoveries.push(modal); handled = true; break;
                  } else if (page.url() !== preUrl) {
                    console.log(`[Scraper] ✓ Action button navigated: ${page.url()}`);
                    clickDiscoveredLinks.push(page.url()); await page.goBack(); handled = true; break;
                  }
                }
              } catch (e) { }
            }
          }
          await closeModals();
          page.off('request', networkListener);
        } catch (e) {
          const errMsg = (e as Error).message.split('\n')[0].substring(0, 100);
          console.log(`[Scraper] Row interaction failed: ${errMsg}...`);
          await closeModals();
        }
      }
      if (emptyTables > 0) console.log(`[Scraper] Skipped ${emptyTables} empty tables.`);
    }


    // --- PHASE 7: Global Action Discovery ---
    console.log(`[Scraper] Global Action Discovery...`);
    // [FIX] Broader selector for action buttons (including ARIA buttons and styled links)
    const allBtns = await page.$$('button, [role="button"], a[class*="Button"], a[class*="btn"]');
    const matches: any[] = [];
    for (const b of allBtns) {
      const t = await b.innerText();
      // [FIX] Expanded keywords to include Creation/Addition actions
      if (/new|create|add|plus|generate|edit|view|scan|print|수정|보기|생성|추가|등록|신규|인쇄/i.test(t)) {
        matches.push({ b, t });
      }
    }

    // Sort matches to prioritize "New/Create" actions
    matches.sort((a, b) => {
      const aIsCreate = /new|create|add|plus|생성|추가|등록|신규/i.test(a.t);
      const bIsCreate = /new|create|add|plus|생성|추가|등록|신규/i.test(b.t);
      if (aIsCreate && !bIsCreate) return -1;
      if (!aIsCreate && bIsCreate) return 1;
      return 0;
    });

    // [OPTIMIZATION] Increased limit to 5 to capture both Create and Edit actions
    for (const m of matches.slice(0, 5)) {
      try {
        await closeModals();
        console.log(`[Scraper] Testing global action: "${m.t}"`);
        await smartClick(m.b);
        await page.waitForTimeout(2000);
        const modal = await extractModalContent(`Global: ${m.t}`);
        if (modal) {
          modalDiscoveries.push(modal);
          clickDiscoveredLinks.push(...modal.links);
        } else if (page.url() !== targetUrl) {
          clickDiscoveredLinks.push(page.url());
          await page.goto(targetUrl, { waitUntil: 'networkidle' });
        }
        await closeModals();
      } catch (e) { }
    }

    // Final stability wait
    await page.waitForLoadState('networkidle').catch(() => { });
    // [OPTIMIZATION] Removed redundant 2s wait

    // Capture screenshot AFTER all discovery actions but BEFORE storage state
    // Ensure output directory exists before screenshot
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const pageTitle = await page.title();
    const screenshotPath = path.join(outputDir, (screenshotName || 'full-page.png').replace(/\.png$/, '.webp'));



    // --- Visual Hash-based Verification ---
    let pngBuffer = await page.screenshot({ fullPage: true, type: 'png' });
    let webpBuffer = await sharp(pngBuffer).webp({ quality: 80 }).toBuffer();
    let currentHash = crypto.createHash('md5').update(webpBuffer).digest('hex');

    if (this.lastScreenshotHash === currentHash) {
      console.log(`[Scraper] Detected identical screenshot hash. Retrying...`);
      for (let retry = 1; retry <= 2; retry++) {
        await page.waitForTimeout(1000 * retry);
        pngBuffer = await page.screenshot({ fullPage: true, type: 'png' });
        webpBuffer = await sharp(pngBuffer).webp({ quality: 80 }).toBuffer();
        currentHash = crypto.createHash('md5').update(webpBuffer).digest('hex');
        if (this.lastScreenshotHash !== currentHash) break;
      }
    }
    this.lastScreenshotHash = currentHash;
    fs.writeFileSync(screenshotPath, webpBuffer);

    if (manualAuth && authFile) {
      await context.storageState({ path: authFile });
    }

    // [DEBUG] Stop Tracing
    const tracePath = path.join(outputDir, `trace-${Date.now()}.zip`);
    await context.tracing.stop({ path: tracePath });
    console.log(`[Scraper] Trace saved to: ${tracePath}`);

    console.log(`[Scraper] Extracting elements and links (Including Shadow DOM)...`);
    // Debug: Check raw links in DOM before filtering
    // Debug: Check raw links in DOM before filtering (Iterative Stack for Shadow DOM)
    const rawLinkDebug = await page.evaluate(() => {
      const hrefs: string[] = [];
      const stack: Node[] = [document.body];

      while (stack.length > 0) {
        const node = stack.pop();
        if (!node) continue;

        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as Element;
          if (el.tagName === 'A' && el.hasAttribute('href')) {
            const h = (el as HTMLAnchorElement).href;
            if (h) hrefs.push(h);
          }
          if (el.shadowRoot) {
            Array.from(el.shadowRoot.childNodes).forEach(c => stack.push(c));
          }
        }

        if (node.hasChildNodes()) {
          Array.from(node.childNodes).forEach(c => stack.push(c));
        }
      }

      const httpHrefs = hrefs.filter(h => h.startsWith('http:') || h.startsWith('https:'));
      const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
      const uuidLinks = httpHrefs.filter(h => uuidPattern.test(h));
      return {
        totalAnchors: hrefs.length,
        httpAnchors: httpHrefs.length,
        uuidLinksCount: uuidLinks.length
      };
    });
    console.log(`[Scraper] Link Summary: ${rawLinkDebug.httpAnchors} HTTP links, ${rawLinkDebug.uuidLinksCount} UUID-based.`);

    const result = await page.evaluate(`
      (function() {
        const elements = [];
        const links = new Set();
        const sidebarLinks = new Set();

        function getElementType(el) {
          var tag = el.tagName.toLowerCase();
          var role = el.getAttribute('role');
          var type = el.type || '';
          if (tag === 'button' || role === 'button' || (tag === 'input' && (type === 'submit' || type === 'button'))) return 'button';
          if (tag === 'a' && el.hasAttribute('href')) return 'link';
          if (tag === 'input' && ['text', 'email', 'password', 'number', 'tel', 'url'].includes(type)) return 'text-input';
          if (tag === 'textarea') return 'textarea';
          if (tag === 'select') return 'select';
          if (tag === 'input' && type === 'checkbox') return 'checkbox';
          if (tag === 'input' && type === 'radio') return 'radio';
          if (tag === 'input' && type === 'file') return 'file-input';
          if (tag === 'dialog' || role === 'dialog') return 'dialog';
          if (role === 'tab') return 'tab';
          if (role === 'menu') return 'menu';
          if (tag === 'details' || tag === 'summary') return 'accordion';
          return 'custom';
        }

        function getSelector(el) {
          var testId = el.getAttribute('data-testid');
          if (testId) return '[data-testid="' + testId + '"]';
          var name = el.getAttribute('name');
          if (name) return '[name="' + name + '"]';
          var ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel) return '[aria-label="' + ariaLabel + '"]';
          var placeholder = el.getAttribute('placeholder');
          if (placeholder) return '[placeholder="' + placeholder + '"]';
          if (el.id && !el.id.startsWith('react-select-') && !/^[a-z0-9]{8,}/.test(el.id)) return '#' + el.id;
          var selector = el.tagName.toLowerCase();
          if (el.className && typeof el.className === 'string') {
            var classes = el.className.trim().split(/\\s+/).filter(c => c && !c.includes(':') && !/^[0-9]/.test(c)).slice(0, 2).join('.');
            if (classes) selector += '.' + classes;
          }
          return selector;
        }

        function walk(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node;
            
            // Link Discovery
            const href = el.getAttribute('href') || el.getAttribute('data-href') || el.getAttribute('data-link') || el.getAttribute('data-url') || el.getAttribute('to') || el.getAttribute('routerLink') || el.getAttribute('ng-href');
            
            if (href) {
              // .navBar is the left sidebar, [class*="subLink"] matches _subLink_ag6db_22
              // Removed [role="menu"] as it incorrectly matches profile dropdown
              const isSidebar = !!el.closest('.navBar, [class*="subLink"], nav, aside, .sidebar, [role="navigation"]');
              if (isSidebar) sidebarLinks.add(href);
              else links.add(href);
            }

            const onclick = el.getAttribute('onclick');
            if (onclick) {
              const match = onclick.match(/['"](\\/?[a-zA-Z0-9\\\\-_\\\\/]+)['"]/);
              if (match) links.add(match[1]);
            }

            // Interactive elements
            const interactiveSelectors = [
              'button', 'a[href]', 'input', 'textarea', 'select',
              '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
              '[onclick]', '[data-action]', '[data-testid]', '[aria-haspopup]', '[aria-expanded]',
              'details', 'summary', 'dialog', '[role="dialog"]', '[role="menu"]'
            ];
            const isMatch = el.matches && interactiveSelectors.some(s => el.matches(s));
            
            if (isMatch) {
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              if (rect.width >= 2 && rect.height >= 2 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                const attributes = {};
                for (let j = 0; j < el.attributes.length; j++) {
                  attributes[el.attributes[j].name] = el.attributes[j].value;
                }
                elements.push({
                  id: 'el-' + elements.length,
                  selector: getSelector(el),
                  testId: el.getAttribute('data-testid') || undefined,
                  tag: el.tagName.toLowerCase(),
                  type: getElementType(el),
                  label: el.innerText.trim() || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '',
                  rect: { top: rect.top + window.scrollY, left: rect.left + window.scrollX, width: rect.width, height: rect.height },
                  sectionIndex: 0,
                  state: { visible: true, enabled: !el.disabled, required: el.hasAttribute('required') },
                  attributes: attributes
                });
              }
            }

            if (el.shadowRoot) walk(el.shadowRoot);
          }

          let child = node.firstChild;
          while (child) {
            walk(child);
            child = child.nextSibling;
          }
        }

        walk(document.body);

        if (window.__discoveredRoutes) {
          window.__discoveredRoutes.forEach(r => links.add(r));
        }

        const processLinks = (s, isSidebar = false) => {
          const res = [];
          const patternCounts = {};
          const UUID_SAMPLE_LIMIT = 2;

          // Action patterns that should always be allowed even with UUIDs
          const actionPatterns = ['/new', '/edit', '/create', '/history', '/copy', '/duplicate', '/clone', '/view'];

          s.forEach(href => {
            if (href && typeof href === 'string') {
              try {
                const url = new URL(href, window.location.href);
                if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
                if (url.hostname === window.location.hostname) {
                  const path = url.pathname;

                  // Skip very specific detail pages (e.g., UUID-based history/edit pages)
                  // Pattern: Matches UUID or long hexadecimal segments (8+) often used for IDs
                  const idPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{20,}/i;
                  const isSpecificId = idPattern.test(path);

                  // Check if path contains action patterns (always allow these)
                  const hasActionPattern = actionPatterns.some(p => path.toLowerCase().includes(p));
                  const forbiddenKeywords = ['support', 'miscellaneous', 'feedback', 'help', '공지사항', '지원', 'logout'];
                  const isExcluded = forbiddenKeywords.some(kw => path.toLowerCase().includes(kw));

                  if (path.length > 1 && !isExcluded) {
                    if (isSidebar || !isSpecificId || hasActionPattern) {
                      // Always allow non-UUID, sidebar, or action pattern links
                      res.push(url.href);
                    } else {
                      // UUID page: apply pattern-based sampling
                      // Convert path to pattern: /app/lot/abc-123-def -> /app/lot/{id}
                      const pathPattern = path.replace(idPattern, '{id}');
                      const currentCount = patternCounts[pathPattern] || 0;

                      if (currentCount < UUID_SAMPLE_LIMIT) {
                        patternCounts[pathPattern] = currentCount + 1;
                        res.push(url.href);
                      }
                    }
                  }
                }
              } catch(e) {}
            }
          });
          return Array.from(new Set(res));
        };

        return { 
          elements, 
          discoveredLinks: processLinks(links, false),
          sidebarLinks: processLinks(sidebarLinks, true)
        };
      })()
    `);

    if (options.saveAuthFile) {
      await context.storageState({ path: options.saveAuthFile });
    }

    await page.close();
    await context.close();

    // Merge click-discovered links with DOM-discovered links
    const allDiscoveredLinks = [
      ...(result as any).discoveredLinks,
      ...clickDiscoveredLinks
    ];
    const uniqueDiscoveredLinks = Array.from(new Set(allDiscoveredLinks));

    return {
      elements: (result as any).elements,
      pageTitle,
      screenshotPath,
      discoveredLinks: uniqueDiscoveredLinks,
      sidebarLinks: (result as any).sidebarLinks,
      modalDiscoveries: modalDiscoveries.length > 0 ? modalDiscoveries : undefined
    };
  }
}
