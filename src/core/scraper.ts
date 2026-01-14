import { Page, ElementHandle, Request } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import sharp from 'sharp';
import { ActionRecord, ModalDiscovery, TestableElement } from '../../types/index.js';
import { ScrapeResult, ScraperConfig } from './types.js';
import { ReliabilityScorer } from './rl/ReliabilityScorer.js';
import { RLStateManager } from './rl/RLStateManager.js';

export class Scraper {
  private static lastScreenshotHash: string | null = null;
  private static capturedModalHashes = new Set<string>(); // Track unique modal screenshots

  // Shared caches across all tabs in this process
  private static visitedSidebarButtons = new Set<string>();
  private static visitedExpansionButtons = new Set<string>();

  // RL State Manager (Shared)
  private static rlManager: RLStateManager | null = null;

  // [NEW] Action Chain for Golden Path - Moved to instance-level or job-level
  private actionChain: Array<{
    type: 'click' | 'nav' | 'input';
    selector: string;
    label: string;
    timestamp: string;
    url: string;
  }> = [];

  /**
   * Analyze page stability and testability for Golden Path generation
   * Based on loading indicators, errors, and actionable content
   */
  private static async analyzeGoldenPath(
    page: Page,
    elements: TestableElement[]
  ): Promise<import('../../types/index.js').GoldenPathInfo> {
    let confidence = 1.0;
    const reasons: string[] = [];

    // 1. Check for loading indicators (-0.4)
    const hasLoaders = await page.evaluate(() => {
      const loaderSelectors = [
        '.mantine-Loader-root',
        '.loader',
        '.spinner',
        '.loading',
        '[aria-busy="true"]',
        '.ant-spin',
        '.nprogress-bar',
        '[class*="Loading"]',
        '[class*="Spinner"]'
      ];

      return loaderSelectors.some(sel => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          parseFloat(style.opacity) > 0;
      });
    });

    if (hasLoaders) {
      reasons.push('Loading indicators detected - page may not be stable');
      confidence -= 0.4;
    } else {
      reasons.push('No loading indicators detected');
    }

    // 2. Check for error messages (-0.5)
    const hasErrors = await page.evaluate(() => {
      const errorSelectors = [
        '[role="alert"]',
        '.error',
        '.alert-error',
        '[class*="Error"]',
        '[class*="error"]',
        '.mantine-Alert[data-severity="error"]'
      ];

      return errorSelectors.some(sel => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const text = el.textContent?.toLowerCase() || '';
        return style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          text.includes('error');
      });
    });

    if (hasErrors) {
      reasons.push('Error messages detected on page');
      confidence -= 0.5;
    } else {
      reasons.push('No error messages detected');
    }

    // 3. Check for sufficient testable elements (-0.3 if < 3)
    const testableElementCount = elements.length;
    const hasTestableElements = testableElementCount >= 3;

    if (hasTestableElements) {
      reasons.push(`Page has ${testableElementCount} testable elements`);
    } else {
      reasons.push(`Insufficient testable elements (${testableElementCount} < 3)`);
      confidence -= 0.3;
    }

    // 4. Check for actionable content (-0.2 if none)
    const hasActionableContent = elements.some(el =>
      el.type === 'button' ||
      el.tag === 'form' ||
      el.type === 'text-input' ||
      el.type === 'select'
    );

    if (hasActionableContent) {
      reasons.push('Page has actionable content (forms/buttons)');
    } else {
      reasons.push('No actionable content detected');
      confidence -= 0.2;
    }

    // Ensure confidence stays in valid range [0, 1]
    confidence = Math.max(0, Math.min(1, confidence));

    const isStable = !hasLoaders && !hasErrors;

    return {
      isStable,
      hasTestableElements,
      confidence,
      reasons
    };
  }

  static async processPage(page: Page, url: string, config: ScraperConfig, outputDir: string, previousActions: ActionRecord[] = [], previousPath: string[] = []): Promise<ScrapeResult> {
    const scraper = new Scraper();
    scraper.actionChain = [...previousActions];

    // [Unified Timestamp] Group by Hour for grouping & organization
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localIso = new Date(now.getTime() - offset).toISOString();
    const timestamp = localIso.replace(/[:.]/g, '-').substring(0, 13);

    // Initialize RL Manager if needed
    if (!Scraper.rlManager) {
      Scraper.rlManager = new RLStateManager(outputDir);
    }

    const discoveredLinks: Array<{ url: string; path: string[] }> = [];
    const clickedRowTexts = new Set<string>(); // [NEW] Deduplication for row clicks
    const modalDiscoveries: ModalDiscovery[] = [];

    console.log(`[Scraper] Processing: ${url}`);

    // --- NAVIGATION ---
    try {
      // [Stability] Block localhost connections (Dev config leak protection)
      await page.route(/localhost|127\.0\.0\.1/, async (route) => {
        const u = route.request().url();
        console.log(`[Scraper] 🛡️ Blocked request to localhost: ${u}`);
        await route.abort();
      });

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });
    } catch (e) {
      console.error(`[Scraper] Navigation failed for ${url}: ${e}`);
      return { url, pageTitle: 'Error', elements: [], links: [], error: 'Navigation failed', newlyDiscoveredCount: 0 };
    }

    // [FIX] Smart Dashboard Navigation
    const currentUrl = page.url();
    if (currentUrl.includes('/app/logged-in') || currentUrl.endsWith('/app') || currentUrl.endsWith('/app/')) {
      console.log('[Scraper] Detected transition page, forcing navigation to /app/home...');
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
      console.log('[Scraper] Settling UI and cleaning ghost elements...');
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
      } catch { /* ignore */ }

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
      console.log('[Scraper] Modal detected, extracting content...');

      const modalData = await page.evaluate(() => {
        const modal = document.querySelector('.ianai-Modal-content, .mantine-Modal-content, [role="dialog"], .ianai-Drawer-content, .mantine-Drawer-content');
        if (!modal) return null;
        const titleEl = modal.querySelector('.ianai-Modal-title, .mantine-Modal-title, h1, h2, h3, [class*="title"]');
        const modalTitle = titleEl?.textContent?.trim() || 'Untitled Modal';
        const links = Array.from(modal.querySelectorAll('a[href]')).map(a => (a as HTMLAnchorElement).href).filter(h => h && !h.startsWith('blob:') && !h.startsWith('javascript:') && h.startsWith('http'));
        const elements: TestableElement[] = [];
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
            console.log('[Scraper] Skipping blank modal screenshot');
          } else {
            const webp = await sharp(png).webp({ quality: 80 }).toBuffer();
            const hash = crypto.createHash('md5').update(webp).digest('hex');

            // Check if duplicate modal
            if (Scraper.capturedModalHashes.has(hash)) {
              console.log(`[Scraper] Skipping duplicate modal screenshot (${modalData.modalTitle})`);
            } else {
              Scraper.capturedModalHashes.add(hash);
              const safeName = modalData.modalTitle.replace(/[^a-zA-Z0-9가-힣]/g, '_').substring(0, 40) || 'modal';
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
              } catch { /* ignore */ }

              console.log(`[Scraper] Saved unique modal: ${safeName} (version ${hash.substring(0, 6)})`);
            }
          }
        }
      } catch { /* ignore */ }

      return { triggerText, modalTitle: modalData.modalTitle, elements: modalData.elements, links: modalData.links, screenshotPath };
    };

    // [RESTORED] Coordinate-based clicking for SPA event filtering bypass
    const smartClick = async (handle: ElementHandle<Element>) => {
      // [NEW] Record Action
      try {
        const txt = await handle.innerText().catch(() => '') || await handle.getAttribute('aria-label') || 'element';
        scraper.actionChain.push({
          type: 'click',
          selector: (await handle.getAttribute('class')) || 'unknown',
          label: txt.substring(0, 30),
          timestamp: new Date().toISOString(),
          url: page.url()
        });
      } catch { /* ignore */ }

      try {
        const box = await handle.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        } else {
          await handle.click({ force: true }).catch(() => handle.evaluate((el: HTMLElement) => el.click()));
        }
      } catch {
        await handle.click({ force: true }).catch(() => { });
      }
    };

    // --- PHASE 2: SPA Route Interception ---
    console.log('[Scraper] Setting up SPA route interception...');
    await page.evaluate(() => {
      if (!(window as unknown as Window & { __discoveredRoutes: Set<string> }).__discoveredRoutes) {
        (window as unknown as Window & { __discoveredRoutes: Set<string> }).__discoveredRoutes = new Set();
      }
      const methods = ['pushState', 'replaceState'] as const;
      for (let i = 0; i < methods.length; i++) {
        const m = methods[i];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const orig = (history as any)[m];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (history as any)[m] = function (...args: any[]) {
          if (args[2]) (window as unknown as Window & { __discoveredRoutes: Set<string> }).__discoveredRoutes.add(args[2].toString());
          return orig.apply(this, args);
        };
      }
    });

    // --- PHASE 3: Stability Wait ---
    console.log('[Scraper] Waiting for page stability...');
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
        let t: ReturnType<typeof setTimeout>;
        const o = new MutationObserver(() => {
          clearTimeout(t);
          t = setTimeout(() => { o.disconnect(); resolve(); }, 800);
        });
        o.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { o.disconnect(); resolve(); }, 4000);
      });
    });

    // --- PHASE 3.5: EARLY SCREENSHOT (Clean State) ---
    // [CHANGE] Moved before Discovery phases to capture pristine page state
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    let screenshotPath = '';
    try {
      await settleAndCleanup();

      // Generate meaningful filename from URL path
      const urlObj = new URL(url);
      const pageName = urlObj.pathname.replace(/\//g, '-').replace(/^-|-$/g, '') || 'index';

      screenshotPath = path.join(outputDir, `${pageName}_${timestamp}.webp`);

      const png = await page.screenshot({ fullPage: true, type: 'png' });

      // Check if screenshot is mostly blank (white/empty page)
      const stats = await sharp(png).stats();
      const isBlank = stats.channels.every(ch => ch.mean > 250 && ch.stdev < 10);
      if (isBlank) {
        console.log(`[Scraper] ⚠️ Warning: Screenshot appears blank (High brightness/Low contrast) for ${url}`);
      }
      const webp = await sharp(png).webp({ quality: 80 }).toBuffer();
      const hash = crypto.createHash('md5').update(webp).digest('hex');

      fs.writeFileSync(screenshotPath, webp);

      // Save metadata JSON
      const domain = new URL(url).hostname;
      const jsonDir = path.join(path.dirname(screenshotPath), 'json', domain);
      if (!fs.existsSync(jsonDir)) fs.mkdirSync(jsonDir, { recursive: true });

      const jsonFilename = `${pageName}_${timestamp}.json`;
      const jsonPath = path.join(jsonDir, jsonFilename);
      fs.writeFileSync(jsonPath, JSON.stringify({
        url,
        timestamp: localIso,
        hash,
        capturePhase: 'early', // [NEW] Mark as early capture
        functionalPath: previousPath.join(' > ') // [NEW] 3-Way Mapping
      }, null, 2));

      // [RL] Calculate Reliability Score
      const { score, reasons } = await ReliabilityScorer.calculateScore(page, screenshotPath);
      console.log(`[RL] Reliability Score: ${score.toFixed(2)} (${reasons.join(', ') || 'Clean'})`);

      // [RL] Record State
      if (Scraper.rlManager) {
        Scraper.rlManager.recordState({
          url,
          action: 'initial_capture',
          timestamp: new Date().toISOString(),
          reliabilityScore: score,
          contaminationReasons: reasons,
          screenshotHash: hash
        });
      }

      // Update JSON with score
      try {
        const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        data.reliabilityScore = score;
        data.contaminationReasons = reasons;
        fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
      } catch { /* ignore */ }

      if (hash === Scraper.lastScreenshotHash) {
        // Duplicate detection log (optional)
      }
      Scraper.lastScreenshotHash = hash;
      console.log(`[Scraper] ✓ Early screenshot captured: ${screenshotPath}`);
    } catch (e) {
      console.error(`[Scraper] Early screenshot failed: ${e}`);
    }

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
    let navigationCount = 0; // [OPTIMIZATION] Track navigations to prevent infinite loop
    for (const t of potentialMenus) {
      if (navigationCount > 3) {
        console.log('[Scraper] Too many menu expansions triggered navigation. Stopping expansion phase to save time.');
        break;
      }
      try {
        const validButtons = await page.locator(`button:has-text("${t}"), [role="button"]:has-text("${t}")`).all();
        // [UPGRADE] Iterate all matching buttons, not just first
        let activeButtonsChecked = 0; // [FIX] Moved declaration before usage
        for (const btn of validButtons) {
          // [OPTIMIZATION] Limit buttons checked per text to avoid duplicates
          if (activeButtonsChecked > 3) break;

          if (await btn.isVisible()) {
            activeButtonsChecked++;
            await smartClick(btn);
            Scraper.visitedExpansionButtons.add(t);
            expandedCount++;
            await page.waitForTimeout(300);

            if (page.url() !== targetUrl) {
              const navigatedUrl = page.url();
              if (navigatedUrl.startsWith('http')) {
                discoveredLinks.push({
                  url: navigatedUrl,
                  path: [...previousPath, t] // Add menu label to path
                });
              }
              console.log(`[Scraper] Menu expansion navigated to: ${navigatedUrl}. Returning...`);

              // [OPTIMIZATION] Use domcontentloaded instead of networkidle for faster return
              await page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => { });
              await page.waitForTimeout(500);
              navigationCount++;
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
                newLinks.forEach(l => {
                  discoveredLinks.push({
                    url: l,
                    path: [...previousPath, t] // Inherit menu breadcrumb
                  });
                });
                console.log(`[Scraper] Captured ${newLinks.length} links from expanded menu "${t}".`);
              }
            }
          }
        }
      } catch { /* ignore */ }
    }
    console.log(`[Scraper] Expanded ${expandedCount} NEW menu items.`);

    // --- AUTO-SCROLL ---
    console.log('[Scraper] Scrolling to discover more content...');
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
    } catch {
      console.log('[Scraper] Auto - scroll interrupted or page closed.');
      if (page.isClosed()) return { url, pageTitle: 'Closed', elements: [], links: [], newlyDiscoveredCount: 0 };
    }

    // --- PHASE 5: Active Sidebar Discovery (Cache-aware) ---
    console.log(`[Scraper] Active Sidebar Discovery(Cached: ${Scraper.visitedSidebarButtons.size})...`);
    const visitedSidebar = Array.from(Scraper.visitedSidebarButtons);
    const sButtons = await page.evaluate((visited) => {
      const sidebarSelectors = ['nav', 'aside', '[role="navigation"]', '.navBar', '.sidebar', '[class*="Navbar"]', '[class*="Sidebar"]'];
      let sidebarRoots: Element[] = [];

      // [UPGRADE] Find ALL potential sidebars, not just the first one
      const specificSidebars = document.querySelectorAll('nav[class*="_navBar_"], div[class*="_navLinks_"]');
      if (specificSidebars.length > 0) sidebarRoots.push(...Array.from(specificSidebars));

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

        // [Verified Selector] Add specific class from inspection
        const verifiedBtns = document.querySelectorAll('button[class*="_control_"], button[class*="ianai-UnstyledButton-root"]');
        btns.push(...Array.from(verifiedBtns) as HTMLElement[]);
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
            discoveredLinks.push({
              url: page.url(),
              path: [...previousPath, b.cleanText] // Add sidebar label
            });
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
              newLinks.forEach(l => {
                discoveredLinks.push({
                  url: l,
                  path: [...previousPath, b.cleanText] // Inherit sidebar breadcrumb
                });
              });
              console.log(`[Scraper] Sidebar click "${b.cleanText}" revealed ${newLinks.length} links.`);
            }

            const modal = await extractModalContent(`Sidebar: ${b.text} `);
            if (modal) modalDiscoveries.push(modal);
            await closeModals();
          }
        }
      } catch { /* ignore */ }
    }

    // --- PHASE 5.5: List Entry (View All) ---
    console.log('[Scraper] Checking for "View All" triggers...');
    const viewAllBtns = await page.getByRole('button', { name: /View All|View more|더보기/i }).all();
    for (const btn of viewAllBtns) {
      if (await btn.isVisible()) {
        console.log('[Scraper] Clicking "View All" to enter list view...');
        await smartClick(btn);
        await page.waitForTimeout(2000);
        const currentIterationUrl = page.url();
        if (currentIterationUrl.startsWith('http') && !discoveredLinks.some(l => l.url === currentIterationUrl)) {
          discoveredLinks.push({ url: currentIterationUrl, path: [...previousPath, 'View All'] });
        }
        if (currentIterationUrl !== targetUrl) break; // [FIX] Break if navigation occurred
      }
    }

    // --- PHASE 6: Table-based Row-Click Discovery ---
    console.log('[Scraper] Discovering detail pages via Table/Grid/List Row Click...');
    const tables = await page.$$('table, [role="table"], [role="grid"], [role="treegrid"], .mantine-Table-root, [class*="Table"], [class*="Grid"], [class*="List"]');
    console.log(`[Scraper] Found ${tables.length} tables to investigate.`);

    let emptyTables = 0;
    for (const table of tables) {
      try {
        const rows = await table.$$('tbody tr, [role="row"], [role="listitem"], div[class*="row"], div[class*="Row"], li');
        if (rows.length === 0) { emptyTables++; continue; }

        const rowIndex = rows.length > 1 ? 1 : 0;
        const row = rows[rowIndex];

        await closeModals();
        const rowText = await row.evaluate((el: HTMLElement) => el.innerText?.trim().substring(0, 50).replace(/\n/g, ' | ') || '');
        if (rowText.toLowerCase().includes('name') && rowText.toLowerCase().includes('type')) continue;

        // [NEW] Deduplication check
        if (clickedRowTexts.has(rowText)) {
          // console.log(`[Scraper] Skipping redundant row click: "${rowText}"`);
          continue;
        }
        clickedRowTexts.add(rowText);

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
        const networkListener = (req: Request) => {
          const u = req.url().toLowerCase();
          const rType = req.resourceType();
          const isApi = (u.includes('/api/') || /uuid|history|detail|get/i.test(u)) && (rType === 'fetch' || rType === 'xhr');
          const isAsset = /\.(js|css|webp|png|jpg|jpeg|svg|woff2|woff|json)/i.test(u);
          if (isApi && !isAsset) detectedApiCall = true;
        };
        page.on('request', networkListener);

        await smartClick(target);
        console.log('[Scraper] Row click sent.Monitoring for response...');

        let handled = false;
        for (let p = 0; p < 10; p++) {
          await page.waitForTimeout(500);
          const curUrl = page.url();

          if (await isModalOpen()) {
            const modal = await extractModalContent(rowText);
            if (modal) {
              console.log(`[Scraper] ✓ Modal found: "${modal.modalTitle}"`);
              modalDiscoveries.push(modal);
              discoveredLinks.push(...modal.links.map(l => ({ url: l, path: [...previousPath, 'Modal Link'] })));
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
              const els: Array<{ id: string, tag: string, label: string, type: string }> = [];
              document.querySelectorAll('button, a[href], input, textarea, select, [role="button"]').forEach((el, idx) => {
                const r = el.getBoundingClientRect();
                if (r.width < 5 || r.height < 5) return;
                els.push({
                  id: `detail - el - ${idx} `,
                  tag: el.tagName.toLowerCase(),
                  label: (el as HTMLElement).innerText?.trim().substring(0, 50) || el.getAttribute('aria-label') || '',
                  type: (el as HTMLInputElement).type || ''
                });
              });
              return { title: document.title, elements: els.slice(0, 50) };
            });

            // Generate meaningful detail page filename
            const detailUrlObj = new URL(curUrl);
            const detailPath = detailUrlObj.pathname.replace(/\//g, '-').replace(/^-|-$/g, '') || 'detail';
            let scPath: string | undefined = path.join(outputDir, `detail-${detailPath.substring(0, 50)}_${timestamp}.webp`);
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
            } catch { scPath = undefined; }

            modalDiscoveries.push({
              triggerText: `Row Click: ${rowText} `,
              modalTitle: `Page: ${pageData.title} `,
              elements: pageData.elements,
              links: [curUrl],
              screenshotPath: scPath
            });

            discoveredLinks.push({
              url: curUrl,
              path: [...previousPath, `Detail: ${rowText.substring(0, 20)}`] // Add detail context
            });
            console.log('[Scraper] Detail captured, returning to list...');
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
      } catch {
        await closeModals();
      }
    }
    if (emptyTables > 0) console.log(`[Scraper] Skipped ${emptyTables} empty tables.`);

    // --- PHASE 6.5: Pagination Discovery ---
    console.log('[Scraper] Checking for Pagination...');
    // Mantine / Common Pagination Selectors
    const nextBtns = await page.$$('button[class*="pagination-control"]:not([disabled]), button[class*="Pagination-control"]:not([disabled]), [aria-label="Next page"]:not([disabled]), [title="Next"]:not([disabled]), .mantine-Pagination-control:has([class*="tabler-icon-chevron-right"]), button:has(svg[class*="chevron-right"])');

    if (nextBtns.length > 0) {
      console.log(`[Scraper] Found ${nextBtns.length} potential 'Next' buttons.`);
      for (const btn of nextBtns) {
        if (await btn.isVisible()) {
          const isDisabled = await btn.getAttribute('disabled') !== null || await btn.getAttribute('aria-disabled') === 'true';
          if (!isDisabled) {
            console.log('[Scraper] Clicking Pagination \'Next\' button...');
            const preUrl = page.url();
            await smartClick(btn);
            await page.waitForTimeout(2000);
            if (page.url() !== preUrl) {
              console.log(`[Scraper] Pagination navigated to: ${page.url()}`);
              discoveredLinks.push({ url: page.url(), path: [...previousPath, 'Next Page'] });
              // Go back to preserve state for other phases if needed, or just capture this link
              await page.goBack().catch(() => { });
              await page.waitForTimeout(1000);
            }
          }
        }
      }
    } else {
      // Numbered pagination check (e.g., jump to page 2)
      const page2Btn = await page.$('button:has-text("2"), [role="button"]:has-text("2")');
      if (page2Btn) {
        const label = await page2Btn.innerText();
        if (label.trim() === '2') { // Strict check to avoid "2024" etc
          console.log('[Scraper] Found \'Page 2\' button. Clicking...');
          await smartClick(page2Btn);
          await page.waitForTimeout(2000);
          discoveredLinks.push({ url: page.url(), path: [...previousPath, 'Page 2'] });
          await page.goBack().catch(() => { });
        }
      }
    }

    // --- PHASE 7: Global Action Discovery ---
    console.log('[Scraper] Global Action Discovery...');
    const allBtns = await page.$$('button, [role="button"], a[class*="Button"], a[class*="btn"]');
    const matches: { b: ElementHandle<Element>; t: string }[] = [];

    for (const b of allBtns) {
      try {
        const t = await b.innerText();
        if (/new|create|add|plus|generate|edit|view|scan|print|수정|보기|생성|추가|등록|신규|인쇄/i.test(t)) {
          matches.push({ b, t });
        }
      } catch { /* ignore */ }
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
            discoveredLinks.push(...modal.links.map(l => ({ url: l, path: [...previousPath, 'Action: ' + m.t] })));
          }
          await closeModals();
        } else if (page.url() !== preUrl && page.url().startsWith('http')) {
          console.log(`[Scraper] ✓ Action "${m.t}" navigated to: ${page.url()} `);
          discoveredLinks.push({ url: page.url(), path: [...previousPath, 'Action: ' + m.t] });
          await page.goBack({ waitUntil: 'networkidle' }).catch(() => { });
        }
      } catch { /* ignore */ }
    }

    // [REMOVED] Screenshot moved to Phase 3.5 (Early Capture)

    // --- FULL EXTRACTION (For Analyzer) ---
    // Use stack-based iteration to avoid esbuild's __name helper issue in browser context
    const result = await page.evaluate(() => {
      // [DEBUG] Log body text to diagnose "explicit-error-ui" and 0 links
      console.log('[DEBUG] Page Content Start:', document.body.innerText.substring(0, 500).replace(/\n/g, ' '));

      const elements: TestableElement[] = [];
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
              const elId = el.id || `auto-${elements.length}`;
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
              if (el.id) selector = `#${el.id}`;
              else if (el.getAttribute('data-testid')) selector = `[data-testid="${el.getAttribute('data-testid')}"]`;
              else if (el.className) selector = `${tag}.${el.className.split(' ')[0]}`;

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
        }

        // Push children to stack
        if (node.childNodes && node.childNodes.length > 0) {
          for (let i = node.childNodes.length - 1; i >= 0; i--) {
            stack.push(node.childNodes[i]);
          }
        }
      }



      // [RESTORE] SPA Route Merging & Logic
      if ((window as unknown as Window & { __discoveredRoutes: string[] }).__discoveredRoutes) {
        (window as unknown as Window & { __discoveredRoutes: string[] }).__discoveredRoutes.forEach((r: string) => links.add(r));
      }

      // [RESTORE & INLINE] Intelligent Link Processing (Inlined)
      const processedLinks: string[] = [];
      const processedSidebarLinks: string[] = [];

      const batches = [
        { isSidebar: false, source: Array.from(links), target: processedLinks },
        { isSidebar: true, source: Array.from(sidebarLinks), target: processedSidebarLinks }
      ];

      const patternCounts: Record<string, number> = {};
      const UUID_SAMPLE_LIMIT = 2;
      const actionPatterns = ['/new', '/edit', '/create', '/history', '/copy', '/duplicate', '/clone', '/view'];
      const forbiddenKeywords = ['support', 'miscellaneous', 'feedback', 'help', '공지사항', '지원', 'logout'];

      batches.forEach(batch => {
        batch.source.forEach(href => {
          if (href && typeof href === 'string') {
            try {
              const url = new URL(href, window.location.href);
              if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

              if (url.hostname === window.location.hostname) {
                const path = url.pathname;
                const idPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{20,}/i;
                const isSpecificId = idPattern.test(path);
                const hasActionPattern = actionPatterns.some(p => path.toLowerCase().includes(p));
                const isExcluded = forbiddenKeywords.some(kw => path.toLowerCase().includes(kw));

                if (path.length > 1 && !isExcluded) {
                  if (batch.isSidebar || !isSpecificId || hasActionPattern) {
                    batch.target.push(url.href);
                  } else {
                    const pathPattern = path.replace(idPattern, '{id}');
                    const currentCount = patternCounts[pathPattern] || 0;
                    if (currentCount < UUID_SAMPLE_LIMIT) {
                      patternCounts[pathPattern] = currentCount + 1;
                      batch.target.push(url.href);
                    } else {
                      // console.log(`[Scraper] Dropped UUID link (Limit reached): ${url.href}`);
                    }
                  }
                } else {
                  if (isExcluded) console.log(`[Scraper] Dropped link (Excluded keyword): ${url.href}`);
                }
                console.log(`[Scraper] Dropped link (Cross-domain): ${url.hostname}`);
              }
            } catch { /* ignore */ }
          }
        });
      });


      return {
        elements,
        links: Array.from(new Set(processedLinks)),
        sidebarLinks: Array.from(new Set(processedSidebarLinks))
      };
    });

    const elements = result.elements as TestableElement[];
    discoveredLinks.push(...result.links.map(l => ({ url: l, path: previousPath })));

    // Analyze Golden Path stability
    const goldenPath = await this.analyzeGoldenPath(page, elements);
    console.log(`[Scraper] Golden Path: Stable=${goldenPath.isStable}, Confidence = ${goldenPath.confidence.toFixed(2)} `);

    return {
      url,
      pageTitle: await page.title(),
      elements,
      links: discoveredLinks.map(l => l.url),
      discoveredLinks: discoveredLinks, // [NEW] Full link + path info
      sidebarLinks: result.sidebarLinks,
      screenshotPath,
      modalDiscoveries,
      newlyDiscoveredCount: discoveredLinks.length,
      goldenPath, // [NEW] Golden Path Info
      actionChain: scraper.actionChain,
      functionalPath: previousPath.join(' > ') // Join breadcrumbs
    };

  }
}
