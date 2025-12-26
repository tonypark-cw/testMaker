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
  }> {
    const { url, outputDir, authFile, manualAuth, username, password, screenshotName } = options;

    // If manual auth is requested, we must run in headful mode
    if (!this.browser) await this.init(!manualAuth);

    const contextOptions: any = {
      viewport: { width: 1440, height: 900 }
    };

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
      console.log(`[Scraper] Press 'Resume' in Playwright Inspector or close the pause when logged in.`);
      await page.pause();
    } else if (username && password) {
      console.log(`[Scraper] AUTOMATED LOGIN MODE: Navigating to ${url}...`);
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      const loginFields = page.locator('input[type="email"], input[type="text"], input[type="password"], input[placeholder*="email" i], input[placeholder*="password" i]');
      try {
        await loginFields.first().waitFor({ state: 'visible', timeout: 8000 });
      } catch (e) { }

      const emailField = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i], input[type="text"]').first();
      const passwordField = page.locator('input[type="password"], input[name="password"], input[placeholder*="password" i]').first();

      if (await emailField.isVisible().catch(() => false) && await passwordField.isVisible().catch(() => false)) {
        console.log(`[Scraper] Login fields detected. Attempting to sign in...`);
        const submitButton = page.locator('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in"), input[type="submit"], .btn-primary').first();
        await emailField.fill(username);
        await passwordField.fill(password);
        await submitButton.click();
        await page.waitForTimeout(5000);
        await page.waitForLoadState('networkidle').catch(() => { });
      }
    } else {
      console.log(`[Scraper] Navigating to ${url}...`);
      const waitState = (options.waitStrategy === 'dynamic' ? 'networkidle' : options.waitStrategy) as any;
      await page.goto(url, { waitUntil: waitState || 'networkidle', timeout: 60000 });
    }

    // --- PHASE 3: SPA Route Interception (Start early) ---
    if (options.spaMode !== false) {
      await page.evaluate(() => {
        if (!(window as any).__discoveredRoutes) (window as any).__discoveredRoutes = new Set();
        const originalPushState = history.pushState;
        history.pushState = function (...args) {
          if (args[2]) (window as any).__discoveredRoutes.add(args[2].toString());
          return originalPushState.apply(this, args);
        };
        const originalReplaceState = history.replaceState;
        history.replaceState = function (...args) {
          if (args[2]) (window as any).__discoveredRoutes.add(args[2].toString());
          return originalReplaceState.apply(this, args);
        };
      });
    }

    // --- PHASE 4: Robust Stability & Loading Wait ---
    if (options.waitStrategy !== 'load') {
      console.log(`[Scraper] Waiting for loading indicators to clear...`);
      await page.waitForFunction(() => {
        const loaders = [
          '.mantine-Loader-root', '.loader', '.spinner', '.loading',
          '[aria-busy="true"]', '.skeleton-loading', '.fetching',
          '.ant-spin', '.nprogress-bar'
        ];
        return !loaders.some(sel => {
          const el = document.querySelector(sel);
          if (!el) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;
        });
      }, { timeout: 5000 }).catch(() => { });

      console.log(`[Scraper] Waiting for DOM stability (MutationObserver)...`);
      await page.evaluate(`
        new Promise(resolve => {
          let timeout;
          const cleanup = () => { observer.disconnect(); resolve(); };
          const observer = new MutationObserver(() => {
            clearTimeout(timeout);
            timeout = setTimeout(cleanup, 800);
          });
          observer.observe(document.body, { childList: true, subtree: true });
          setTimeout(cleanup, 4000);
        })
      `);
    }

    // --- PHASE 2: Recursive Menu Expansion ---
    if (options.expandMenus !== false) {
      console.log(`[Scraper] Expanding all menus recursively...`);
      const expandedCount = await page.evaluate(async () => {
        let totalExpanded = 0;
        const maxDepth = 3;

        // First, find sidebar menu buttons specifically (Mantine/ianai pattern)
        const sidebarButtons = Array.from(document.querySelectorAll(
          'button[class*="_control_"], button[class*="UnstyledButton"], [class*="menuGroup"] button, [class*="navBar"] button'
        )) as HTMLElement[];

        console.log(`[Menu] Found ${sidebarButtons.length} sidebar-style buttons`);

        for (const btn of sidebarButtons) {
          const text = btn.textContent?.trim() || '';
          if (text.toLowerCase().includes('logout') || text.toLowerCase().includes('customize')) continue;
          // Only click if it looks like a menu item (has text content)
          if (text.length > 0 && text.length < 50) {
            btn.click();
            totalExpanded++;
            await new Promise(r => setTimeout(r, 300));
          }
        }

        // Then do the regular expansion for other menus
        for (let depth = 0; depth < maxDepth; depth++) {
          const menuSelectors = ['[aria-expanded="false"]', '.collapsed', '[data-toggle]:not(.show)', 'details:not([open])', '.menu-toggle', '.nav-item.dropdown', '[aria-haspopup="true"]:not([class*="_control_"])'];
          const toggles = Array.from(document.querySelectorAll(menuSelectors.join(', '))) as HTMLElement[];
          if (toggles.length === 0) break;
          let expandedAny = false;
          for (const btn of toggles) {
            if (btn.textContent?.toLowerCase().includes('logout')) continue;
            btn.click();
            expandedAny = true;
            totalExpanded++;
            await new Promise(r => setTimeout(r, 300));
          }
          if (!expandedAny) break;
          await new Promise(r => setTimeout(r, 200));
        }

        return totalExpanded;
      }).catch(() => 0);
      console.log(`[Scraper] Expanded ${expandedCount} menu items`);
    }

    // --- AUTO-SCROLL ---
    console.log(`[Scraper] Scrolling to discover more content...`);
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= scrollHeight || totalHeight > 10000) { clearInterval(timer); resolve(); }
        }, 100);
      });
    });

    // --- PHASE 5: Hover Menu Support ---
    if (options.hoverDiscover !== false) {
      console.log(`[Scraper] Discovering hover menus...`);
      const hoverTriggers = await page.$$('[aria-haspopup], .dropdown-toggle, .has-submenu, .nav-item.dropdown');
      for (const trigger of hoverTriggers.slice(0, 15)) {
        try { await trigger.hover(); await page.waitForTimeout(200); } catch (e) { }
      }
    }

    // --- PHASE 6: Row-Click Discovery for Detail Pages ---
    const clickDiscoveredLinks: string[] = [];
    if (options.clickDiscover !== false) {
      console.log(`[Scraper] Discovering detail pages by clicking table rows...`);
      const ROW_CLICK_LIMIT = 2;
      const originalUrl = page.url();

      // Selectors for clickable table rows/cells
      const rowSelectors = [
        'table tbody tr',
        '[role="row"]',
        '.mantine-Table-tr',
        '.ianai-Table-tr',
        '[data-row-key]',
        '.data-table-row',
        '.list-item',
      ];

      for (const selector of rowSelectors) {
        const rows = await page.$$(selector);
        if (rows.length === 0) continue;

        console.log(`[Scraper] Found ${rows.length} rows with selector: ${selector}`);
        let clickedCount = 0;

        for (const row of rows.slice(0, ROW_CLICK_LIMIT + 2)) {
          if (clickedCount >= ROW_CLICK_LIMIT) break;

          try {
            const beforeUrl = page.url();

            // Try clicking on the Name/Title cell (skip checkbox and menu icon columns)
            // Priority: anchor link anywhere in row > 2nd/3rd/4th cell > row itself
            const anchorInRow = await row.$('a[href]:not([href="#"]):not([href^="javascript"])');
            const clickableCell = await row.$('td:nth-child(2), td:nth-child(3), td:nth-child(4), [data-cell="name"], [data-cell="title"]');

            let target = anchorInRow || clickableCell || row;

            // If we found a specific link, use it. Otherwise, fall back to the row.
            const targetDesc = await target.evaluate(el => el.tagName + ((el as HTMLElement).innerText ? `("${(el as HTMLElement).innerText.substring(0, 20)}...")` : ''));
            // console.log(`[Scraper] Clicking ${targetDesc} in row ${clickedCount + 1}...`);

            await target.click({ timeout: 3000 });
            await page.waitForTimeout(2000); // Increased wait for navigation

            // Check if URL changed (navigated to detail page)
            const afterUrl = page.url();
            if (afterUrl !== beforeUrl && afterUrl !== originalUrl) {
              console.log(`[Scraper] Discovered detail page: ${afterUrl}`);
              clickDiscoveredLinks.push(afterUrl);
              clickedCount++;

              // Go back to the list page
              await page.goBack({ waitUntil: 'networkidle', timeout: 5000 }).catch(() => { });
              await page.waitForTimeout(1000);
            } else {
              // If expected click didn't navigate, try clicking the row itself as backup
              if (target !== row) {
                await row.click({ timeout: 1000 }).catch(() => { });
                await page.waitForTimeout(1500);
                if (page.url() !== beforeUrl) {
                  console.log(`[Scraper] Discovered detail page (via row click): ${page.url()}`);
                  clickDiscoveredLinks.push(page.url());
                  clickedCount++;
                  await page.goBack({ waitUntil: 'networkidle', timeout: 5000 }).catch(() => { });
                  await page.waitForTimeout(1000);
                }
              }
            }
          } catch (e) {
            // Click failed, continue to next row
          }
        }

        if (clickedCount > 0) break; // Found working selector, no need to try others
      }

      // Ensure we're back on the original page
      if (page.url() !== originalUrl) {
        await page.goto(originalUrl, { waitUntil: 'networkidle', timeout: 10000 }).catch(() => { });
      }
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
            if (href && typeof href === 'string' && !href.startsWith('#') && !href.startsWith('javascript:')) {
              try {
                const url = new URL(href, window.location.href);
                if (url.hostname === window.location.hostname) {
                  const path = url.pathname;

                  // Skip very specific detail pages (e.g., UUID-based history/edit pages)
                  // Pattern: Matches UUID or long hexadecimal segments (8+) often used for IDs
                  const idPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{20,}/i;
                  const isSpecificId = idPattern.test(path);

                  // Check if path contains action patterns (always allow these)
                  const hasActionPattern = actionPatterns.some(p => path.toLowerCase().includes(p));

                  if (path.length > 1 && !path.includes('logout')) {
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
      sidebarLinks: (result as any).sidebarLinks
    };
  }
}
