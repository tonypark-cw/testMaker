import { Page, ElementHandle, Request, Locator } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import sharp from 'sharp';
import { ActionRecord, ModalDiscovery, TestableElement, GoldenPathInfo } from '../../types/index.js';
import { ScrapeResult, ScraperConfig, ScrapeJob } from './types.js';
import { RLStateManager } from './rl/RLStateManager.js';
import { UISettler } from './lib/UISettler.js';
import { NavExplorer } from './lib/explorers/NavExplorer.js';
import { ContentExplorer } from './lib/explorers/ContentExplorer.js';
import { ActionExplorer } from './lib/explorers/ActionExplorer.js';
import { ScoringProcessor } from './lib/ScoringProcessor.js';
import { StabilityAnalyzer } from './lib/StabilityAnalyzer.js';

export class Scraper {
  private lastScreenshotHash: string | null = null;
  private capturedModalHashes = new Set<string>(); // Track unique modal screenshots

  // Shared caches across all tabs in this process
  private visitedSidebarButtons = new Set<string>();
  private visitedExpansionButtons = new Set<string>();

  // RL State Manager (Shared)
  private static rlManager: RLStateManager | null = null;

  // [NEW] Action Chain for Golden Path - Moved to instance-level or job-level
  private actionChain: ActionRecord[] = [];

  constructor(private config: ScraperConfig, private outputDir: string) { }

  /**
   * Main entry point for analyzing a single page.
   */
  public async scrape(
    page: Page,
    job: ScrapeJob
  ): Promise<ScrapeResult> {
    const url = job.url;
    const previousActions = job.actionChain || [];
    const previousPath = job.functionalPath || [];
    this.actionChain = [...previousActions];

    // [Unified Timestamp] Group by Hour for grouping & organization
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localIso = new Date(now.getTime() - offset).toISOString();
    const timestamp = localIso.replace(/[:.]/g, '-').substring(0, 13);

    // Initialize RL Manager if needed
    if (!Scraper.rlManager) {
      Scraper.rlManager = new RLStateManager(this.outputDir);
    }

    const discoveredLinks: Array<{ url: string; path: string[] }> = [];
    const clickedRowTexts = new Set<string>(); // [NEW] Deduplication for row clicks
    // Modals: Extraction logic delegated to UISettler
    const modalDiscoveries: ModalDiscovery[] = [];
    const extractAndRecordModal = async (triggerText: string) => {
      const discovery = await UISettler.extractModalContent(
        page,
        triggerText,
        url,
        this.outputDir,
        timestamp,
        this.capturedModalHashes
      );
      if (discovery) modalDiscoveries.push(discovery);
    };

    const pageTitle = await page.title();
    console.log(`[Scraper] 🔍 Processing: ${url} (${pageTitle})`);

    // --- NAVIGATION ---
    try {
      // [Stability] Block localhost connections (Dev config leak protection)
      await page.route(/localhost|127\.0\.0\.1/, async (route: any) => {
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
      await page.waitForTimeout(3000); // Wait for app initialization
    }

    const targetUrl = page.url();

    // --- HELPERS ---




    // [RESTORED] Coordinate-based clicking for SPA event filtering bypass


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
      const root = document.querySelector('#root');
      return root && root.innerHTML.length > 1000; // Even higher threshold
    }, { timeout: 30000 }).catch(() => { });

    await page.waitForSelector('aside, nav, [class*="sidebar"], [class*="nav"]', { timeout: 15000 }).catch(() => {
      console.log('[Scraper] ⚠️ Warning: Navigation markers (aside/nav) not found after 15s.');
    });

    const bodyText = await page.evaluate(() => (document.querySelector('#root') as HTMLElement)?.innerText || 'EMPTY');
    if (bodyText.length < 100) {
      console.log(`[Scraper] ⚠️ Low content detected in #root: "${bodyText.substring(0, 100).replace(/\n/g, ' ')}..."`);
    }

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
    if (!fs.existsSync(this.outputDir)) fs.mkdirSync(this.outputDir, { recursive: true });
    let screenshotPath = '';
    try {
      await UISettler.settleAndCleanup(page);

      // Generate meaningful filename from URL path
      const urlObj = new URL(url);
      const pageName = urlObj.pathname.replace(/\//g, '-').replace(/^-|-$/g, '') || 'index';

      screenshotPath = path.join(this.outputDir, `${pageName}_${timestamp}.webp`);

      // [Uniqueness Check] Append counter if file exists to prevent overwrites
      let counter = 1;
      while (fs.existsSync(screenshotPath)) {
        screenshotPath = path.join(this.outputDir, `${pageName}_${timestamp}_${counter}.webp`);
        counter++;
      }

      console.log(`[Scraper] 📸 Capturing screenshot for: ${url} (Page: ${pageName}, File: ${path.basename(screenshotPath)})`);

      const png = await page.screenshot({ fullPage: true, type: 'png' });

      // Check if screenshot is mostly blank (white/empty page)
      const stats = await sharp(png).stats();
      const isBlank = stats.channels.every((ch: any) => ch.mean > 250 && ch.stdev < 10);
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

      // Use the exact same basename for JSON to keep them paired
      const baseName = path.basename(screenshotPath, '.webp');
      const jsonFilename = `${baseName}.json`;
      const jsonPath = path.join(jsonDir, jsonFilename);
      fs.writeFileSync(jsonPath, JSON.stringify({
        url,
        timestamp: localIso,
        hash,
        capturePhase: 'early', // [NEW] Mark as early capture
        functionalPath: previousPath.join(' > ') // [NEW] 3-Way Mapping
      }, null, 2));

      // [RL] Calculate Reliability Score
      const { score, reasons } = await ScoringProcessor.calculate(page, {
        url,
        pageTitle,
        screenshotPath,
        functionalPath: previousPath.join(' > '),
        actionChain: this.actionChain
      });
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

      if (hash === this.lastScreenshotHash) {
        // Duplicate detection log (optional)
      }
      this.lastScreenshotHash = hash;
      console.log(`[Scraper] ✓ Early screenshot captured: ${screenshotPath}`);
    } catch (e) {
      console.error(`[Scraper] Early screenshot failed: ${e}`);
    }

    // --- DISCOVERY PHASES (Delegated to Specialized Explorers) ---

    // Phase 4: Menu Expansion
    const expandedCount = await NavExplorer.expandMenus(
      page, targetUrl, this.visitedExpansionButtons, this.actionChain, discoveredLinks, previousPath
    );
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

    // Phase 5: Active Sidebar Discovery
    await NavExplorer.discoverSidebar(
      page, targetUrl, this.visitedSidebarButtons, this.actionChain, discoveredLinks,
      modalDiscoveries, previousPath, this.outputDir, timestamp, this.capturedModalHashes
    );

    // Phase 5.5: List Entry (View All)
    await ActionExplorer.handleViewAll(page, targetUrl, discoveredLinks, this.actionChain, previousPath);

    // Phase 6: Table-based Row-Click Discovery
    await ContentExplorer.discoverDetailPages(
      page, targetUrl, this.actionChain, discoveredLinks, modalDiscoveries, previousPath,
      this.outputDir, timestamp, this.capturedModalHashes, clickedRowTexts
    );

    // Phase 6.5: Pagination Discovery
    await ContentExplorer.handlePagination(page, discoveredLinks, this.actionChain, previousPath);

    // Phase 7: Global Action Discovery
    await ActionExplorer.discoverGlobalActions(
      page, targetUrl, this.actionChain, discoveredLinks, modalDiscoveries, previousPath,
      this.outputDir, timestamp, this.capturedModalHashes
    );

    // [REMOVED] Screenshot moved to Phase 3.5 (Early Capture)

    // --- FULL EXTRACTION (For Analyzer) ---
    // Use stack-based iteration to avoid esbuild's __name helper issue in browser context
    const result = await page.evaluate(() => {
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
                type: elType as any,
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
      const UUID_SAMPLE_LIMIT = 500; // Increased for deep crawling
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
    discoveredLinks.push(...result.links.map((l: string) => ({ url: l, path: previousPath })));

    // Analyze Golden Path stability
    const goldenPath = await StabilityAnalyzer.analyzeGoldenPath(page, elements, {
      url,
      pageTitle,
      screenshotPath
    });
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
      actionChain: this.actionChain,
      functionalPath: previousPath.length > 0 ? previousPath.join(' > ') : '' // Join breadcrumbs
    };

  }
}
