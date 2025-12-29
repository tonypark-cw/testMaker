import { chromium, Browser } from 'playwright';
import { TestableElement } from '../types/index.js';
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
    if (!this.browser) await this.init(!manualAuth);

    const contextOptions: any = { viewport: { width: 1440, height: 900 } };
    if (authFile && fs.existsSync(authFile)) {
      console.log(`[Scraper] Loading storage state from ${authFile}...`);
      contextOptions.storageState = authFile;
    }

    const context = await this.browser!.newContext(contextOptions);
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
      if (await emailField.isVisible().catch(() => false) && await passwordField.isVisible().catch(() => false)) {
        console.log(`[Scraper] Login fields detected. Attempting to sign in...`);
        await emailField.fill(username);
        await passwordField.fill(password);
        await page.locator('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")').first().click();
        await page.waitForTimeout(5000);
        await page.waitForLoadState('networkidle').catch(() => { });
      }
    } else {
      console.log(`[Scraper] Navigating to ${url}...`);
      const waitState = (options.waitStrategy === 'dynamic' ? 'networkidle' : options.waitStrategy) as any;
      await page.goto(url, { waitUntil: waitState || 'networkidle', timeout: 60000 });
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
        return btns.map(b => b.textContent?.trim() || '').filter(t => t && !visited.includes(t) && !t.toLowerCase().includes('logout'));
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
            }
          }
        } catch (e) { }
      }
      console.log(`[Scraper] Expanded ${expandedCount} NEW menu items.`);
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
      if (!sidebar) return [];

      const excludeTexts = ['miscellaneous', 'support', 'logout', '피드백', '지원', 'help', '공지사항'];
      const btns = Array.from(sidebar.querySelectorAll('button, [role="button"]')) as HTMLElement[];
      return btns.map(b => ({
        text: b.innerText?.trim() || b.textContent?.trim() || '',
        isLeaf: !b.getAttribute('aria-expanded') && !b.querySelector('svg[class*="down"]') && !b.querySelector('[class*="Chevron"]'),
        visible: b.getBoundingClientRect().height > 2
      })).filter(b => b.isLeaf && b.visible && b.text && !visited.includes(b.text) && !excludeTexts.some(ex => b.text.toLowerCase().includes(ex))).slice(0, 20);
    }, vsb);
    console.log(`[Scraper] Found ${sButtons.length} potential new sidebar buttons to click.`);

    for (const b of sButtons) {
      Scraper.visitedSidebarButtons.add(b.text);
      try {
        const handle = await page.$(`nav button:has-text("${b.text}"), aside button:has-text("${b.text}"), .sidebar button:has-text("${b.text}"), button:has-text("${b.text}")`);
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
            const modal = await extractModalContent(`Sidebar: ${b.text}`);
            if (modal) modalDiscoveries.push(modal);
            await closeModals();
          }
        }
      } catch (e) { }
    }

    // --- PHASE 6: Row-Click & Modals ---
    if (options.clickDiscover !== false) {
      console.log(`[Scraper] Discovering detail pages via Table-based Row Click...`);

      // Find all tables
      const tables = await page.$$('table');
      console.log(`[Scraper] Found ${tables.length} tables to investigate.`);

      for (const table of tables) {
        try {
          // Identify row within this specific table
          const rows = await table.$$('tbody tr');
          if (rows.length === 0) {
            console.log(`[Scraper] Skipping table with no rows.`);
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

          let target = await row.$('td:nth-child(2) span, td:nth-child(2) div, td:nth-child(2)');
          if (!target) target = row;

          await smartClick(target);
          console.log(`[Scraper] Row click sent. Monitoring for response...`);

          let handled = false;
          for (let p = 0; p < 10; p++) {
            await page.waitForTimeout(500);
            const curUrl = page.url();

            // Case 1: Navigation to a new page (Ignoring blob/mailto/etc)
            if (curUrl !== preUrl && (curUrl.startsWith('http:') || curUrl.startsWith('https:'))) {
              console.log(`[Scraper] ✓ URL Change detected: ${curUrl}`);
              await page.waitForLoadState('networkidle').catch(() => { });
              await page.waitForTimeout(1000); // extra wait for SPA content

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

          if (!handled) {
            console.log(`[Scraper] ✗ No response. Checking action buttons in row...`);
            const btns = await row.$$('button, a[role="button"], [role="button"]');
            for (const b of btns) {
              const t = await b.innerText();
              if (/edit|modify|update|view|detail|수정|편집|상세/i.test(t)) {
                await smartClick(b);
                await page.waitForTimeout(2000);
                const modal = await extractModalContent(`${rowText} - ${t}`);
                if (modal) {
                  modalDiscoveries.push(modal); handled = true; break;
                } else if (page.url() !== preUrl) {
                  // If action button navigated, capture it too
                  console.log(`[Scraper] ✓ Action button navigated: ${page.url()}`);
                  clickDiscoveredLinks.push(page.url()); await page.goBack(); handled = true; break;
                }
              }
            }
          }
          await closeModals();
        } catch (e) {
          console.log(`[Scraper] Row interaction failed: ${(e as Error).message}`);
          await closeModals();
        }
      }
    }

    // --- PHASE 7: Global Action Discovery ---
    console.log(`[Scraper] Global Action Discovery...`);
    const allBtns = await page.$$('button');
    const matches: any[] = [];
    for (const b of allBtns) {
      const t = await b.innerText();
      if (/edit|view|수정|보기/i.test(t)) matches.push({ b, t });
    }
    for (const m of matches.slice(0, 3)) {
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
    await page.waitForTimeout(2000);

    // Capture screenshot AFTER all discovery actions but BEFORE storage state
    const pageTitle = await page.title();
    const screenshotPath = path.join(outputDir, (screenshotName || 'full-page.png').replace(/\.png$/, '.webp'));

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

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

    console.log(`[Scraper] Extracting elements and links (Including Shadow DOM)...`);
    // Debug: Check raw links in DOM before filtering
    const rawLinkDebug = await page.evaluate(() => {
      const allAnchors = document.querySelectorAll('a[href]');
      const hrefs = Array.from(allAnchors).map(a => (a as HTMLAnchorElement).href);
      const httpHrefs = hrefs.filter(h => h.startsWith('http:') || h.startsWith('https:'));
      const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
      const uuidLinks = httpHrefs.filter(h => uuidPattern.test(h));
      return {
        totalAnchors: hrefs.length,
        httpAnchors: httpHrefs.length,
        actualHttpLinks: httpHrefs.slice(0, 10),
        uuidLinksCount: uuidLinks.length,
        sampleUuidLinks: uuidLinks.slice(0, 5)
      };
    });
    console.log(`[Scraper] Raw link debug:`, JSON.stringify(rawLinkDebug, null, 2));

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
