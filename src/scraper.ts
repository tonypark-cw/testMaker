import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { TestableElement } from '../types/index.js';
import * as path from 'path';
import * as fs from 'fs';

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
  spaMode?: boolean;
  waitStrategy?: string;
}

export class Scraper {
  private browser: Browser | null = null;

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

    // --- PHASE 4: Initial Stability ---
    if (options.waitStrategy !== 'load') {
      console.log(`[Scraper] Waiting for DOM stability (MutationObserver)...`);
      await page.evaluate(() => {
        return new Promise<void>(resolve => {
          let timeout: any;
          const observer = new MutationObserver(() => {
            clearTimeout(timeout);
            timeout = setTimeout(() => { observer.disconnect(); resolve(); }, 1000);
          });
          observer.observe(document.body, { childList: true, subtree: true });
          setTimeout(() => { observer.disconnect(); resolve(); }, 8000);
        });
      }).catch(() => { });
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
            console.log(`[Menu] Clicking: ${text}`);
            btn.click();
            totalExpanded++;
            await new Promise(r => setTimeout(r, 400));
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
          await new Promise(r => setTimeout(r, 500));
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
      for (const trigger of hoverTriggers.slice(0, 8)) {
        try { await trigger.hover(); await page.waitForTimeout(400); } catch (e) { }
      }
    }

    // Final stability wait
    await page.waitForLoadState('networkidle').catch(() => { });
    await page.waitForTimeout(1000);

    const pageTitle = await page.title();
    const screenshotPath = path.join(outputDir, screenshotName || 'full-page.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

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

                  if (path.length > 1 && !path.includes('logout')) {
                    if (isSidebar || !isSpecificId) {
                      res.push(url.href);
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
    return {
      elements: (result as any).elements,
      pageTitle,
      screenshotPath,
      discoveredLinks: (result as any).discoveredLinks,
      sidebarLinks: (result as any).sidebarLinks
    };
  }
}
