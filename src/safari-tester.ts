import { webkit, Browser, Page, BrowserContext, ElementHandle } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import sharp from 'sharp';

export interface SafariTestOptions {
  url: string;
  outputDir: string;
  authFile?: string;
  headless?: boolean;
  testClickable?: boolean;
  testInputs?: boolean;
  testFocus?: boolean;
  timeout?: number;
}

export interface ElementTestResult {
  selector: string;
  tag: string;
  type: string;
  label: string;
  tests: {
    clickable?: { success: boolean; error?: string };
    focusable?: { success: boolean; error?: string };
    inputable?: { success: boolean; error?: string };
  };
  screenshotPath?: string;
}

export interface SafariTestReport {
  url: string;
  browser: string;
  timestamp: string;
  pageTitle: string;
  summary: {
    totalElements: number;
    clickableTests: { passed: number; failed: number };
    focusTests: { passed: number; failed: number };
    inputTests: { passed: number; failed: number };
  };
  elements: ElementTestResult[];
  fullPageScreenshot: string;
}

export class SafariInteractionTester {
  private browser: Browser | null = null;

  async init(headless: boolean = true) {
    console.log(`[Safari] Launching WebKit browser (headless: ${headless})...`);
    this.browser = await webkit.launch({ headless });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async test(options: SafariTestOptions): Promise<SafariTestReport> {
    const {
      url,
      outputDir,
      authFile,
      headless = true,
      testClickable = true,
      testInputs = true,
      testFocus = true,
      timeout = 30000,
    } = options;

    if (!this.browser) await this.init(headless);

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const contextOptions: any = {
      viewport: { width: 1440, height: 900 },
    };

    if (authFile && fs.existsSync(authFile)) {
      console.log(`[Safari] Loading auth state from ${authFile}...`);
      contextOptions.storageState = authFile;
    }

    const context = await this.browser!.newContext(contextOptions);
    const page = await context.newPage();

    console.log(`[Safari] Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle', timeout });

    // Wait for page stability
    await this.waitForStability(page);

    const pageTitle = await page.title();
    console.log(`[Safari] Page loaded: "${pageTitle}"`);

    // Discover all interactive elements
    const interactiveElements = await this.discoverElements(page);
    console.log(`[Safari] Found ${interactiveElements.length} interactive elements`);

    // Test results
    const elementResults: ElementTestResult[] = [];
    const summary = {
      totalElements: interactiveElements.length,
      clickableTests: { passed: 0, failed: 0 },
      focusTests: { passed: 0, failed: 0 },
      inputTests: { passed: 0, failed: 0 },
    };

    // Test each element
    for (let i = 0; i < interactiveElements.length; i++) {
      const elInfo = interactiveElements[i];
      console.log(`[Safari] Testing element ${i + 1}/${interactiveElements.length}: ${elInfo.type} - "${elInfo.label.substring(0, 30)}"`);

      const result: ElementTestResult = {
        selector: elInfo.selector,
        tag: elInfo.tag,
        type: elInfo.type,
        label: elInfo.label,
        tests: {},
      };

      try {
        const element = await page.$(elInfo.selector);
        if (!element) {
          console.log(`[Safari] Element not found: ${elInfo.selector}`);
          continue;
        }

        // Test Focus
        if (testFocus) {
          result.tests.focusable = await this.testFocus(page, element, elInfo);
          if (result.tests.focusable.success) summary.focusTests.passed++;
          else summary.focusTests.failed++;
        }

        // Test Click
        if (testClickable && ['button', 'link', 'tab', 'checkbox', 'radio'].includes(elInfo.type)) {
          result.tests.clickable = await this.testClick(page, element, elInfo, url);
          if (result.tests.clickable.success) summary.clickableTests.passed++;
          else summary.clickableTests.failed++;

          // Take screenshot if click failed
          if (!result.tests.clickable.success) {
            result.screenshotPath = await this.captureElementScreenshot(page, element, outputDir, `fail-click-${i}`);
          }
        }

        // Test Input
        if (testInputs && ['text-input', 'textarea', 'select'].includes(elInfo.type)) {
          result.tests.inputable = await this.testInput(page, element, elInfo);
          if (result.tests.inputable.success) summary.inputTests.passed++;
          else summary.inputTests.failed++;

          // Take screenshot if input failed
          if (!result.tests.inputable.success) {
            result.screenshotPath = await this.captureElementScreenshot(page, element, outputDir, `fail-input-${i}`);
          }
        }

        elementResults.push(result);

      } catch (err) {
        console.log(`[Safari] Error testing element: ${(err as Error).message}`);
        result.tests.clickable = { success: false, error: (err as Error).message };
        elementResults.push(result);
      }
    }

    // Take full page screenshot
    const fullScreenshotPath = path.join(outputDir, 'safari-full-page.webp');
    const pngBuffer = await page.screenshot({ fullPage: true, type: 'png' });
    const webpBuffer = await sharp(pngBuffer).webp({ quality: 80 }).toBuffer();
    fs.writeFileSync(fullScreenshotPath, webpBuffer);

    await page.close();
    await context.close();

    // Generate report
    const report: SafariTestReport = {
      url,
      browser: 'Safari (WebKit)',
      timestamp: new Date().toISOString(),
      pageTitle,
      summary,
      elements: elementResults,
      fullPageScreenshot: fullScreenshotPath,
    };

    // Save report to JSON
    const reportPath = path.join(outputDir, 'safari-test-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`[Safari] Report saved to ${reportPath}`);

    // Print summary
    this.printSummary(report);

    return report;
  }

  private async waitForStability(page: Page): Promise<void> {
    // Wait for loaders to disappear
    await page.waitForFunction(() => {
      const loaders = ['.loader', '.spinner', '.loading', '[aria-busy="true"]', '.skeleton'];
      return !loaders.some(sel => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
    }, { timeout: 5000 }).catch(() => { });

    // Wait for DOM mutations to settle
    await page.evaluate(`
      new Promise(resolve => {
        let timeout;
        const observer = new MutationObserver(() => {
          clearTimeout(timeout);
          timeout = setTimeout(() => { observer.disconnect(); resolve(); }, 500);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { observer.disconnect(); resolve(); }, 3000);
      })
    `);
  }

  private async discoverElements(page: Page): Promise<Array<{
    selector: string;
    tag: string;
    type: string;
    label: string;
  }>> {
    return await page.evaluate(() => {
      const elements: Array<{ selector: string; tag: string; type: string; label: string }> = [];

      function getType(el: Element): string {
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role');
        const type = (el as HTMLInputElement).type || '';

        if (tag === 'button' || role === 'button') return 'button';
        if (tag === 'a' && el.hasAttribute('href')) return 'link';
        if (tag === 'input' && ['text', 'email', 'password', 'number', 'tel', 'url', 'search'].includes(type)) return 'text-input';
        if (tag === 'textarea') return 'textarea';
        if (tag === 'select') return 'select';
        if (tag === 'input' && type === 'checkbox') return 'checkbox';
        if (tag === 'input' && type === 'radio') return 'radio';
        if (role === 'tab') return 'tab';
        if (role === 'menuitem') return 'menuitem';
        return 'other';
      }

      function getSelector(el: Element): string {
        const testId = el.getAttribute('data-testid');
        if (testId) return `[data-testid="${testId}"]`;

        const name = el.getAttribute('name');
        if (name) return `[name="${name}"]`;

        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) return `[aria-label="${ariaLabel}"]`;

        const placeholder = el.getAttribute('placeholder');
        if (placeholder) return `[placeholder="${placeholder}"]`;

        if (el.id && !el.id.startsWith('react-select-') && !/^[a-z0-9]{8,}/.test(el.id)) {
          return `#${el.id}`;
        }

        // Build a unique path selector
        const path: string[] = [];
        let current: Element | null = el;
        while (current && current !== document.body) {
          let selector = current.tagName.toLowerCase();
          if (current.parentElement) {
            const siblings = Array.from(current.parentElement.children).filter(c => c.tagName === current!.tagName);
            if (siblings.length > 1) {
              const index = siblings.indexOf(current) + 1;
              selector += `:nth-of-type(${index})`;
            }
          }
          path.unshift(selector);
          current = current.parentElement;
        }
        return 'body > ' + path.join(' > ');
      }

      const selectors = [
        'button', 'a[href]', 'input', 'textarea', 'select',
        '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
        '[onclick]', '[data-testid]'
      ];

      const allElements = document.querySelectorAll(selectors.join(', '));

      allElements.forEach(el => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);

        // Skip invisible or tiny elements
        if (rect.width < 5 || rect.height < 5) return;
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

        // Skip logout/signout buttons
        const text = (el as HTMLElement).innerText?.trim() || '';
        if (/logout|sign\s*out/i.test(text)) return;

        elements.push({
          selector: getSelector(el),
          tag: el.tagName.toLowerCase(),
          type: getType(el),
          label: text.substring(0, 100) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '',
        });
      });

      return elements;
    });
  }

  private async testFocus(page: Page, element: ElementHandle, elInfo: any): Promise<{ success: boolean; error?: string }> {
    try {
      await element.focus();
      const isFocused = await page.evaluate(
        (sel) => document.activeElement === document.querySelector(sel),
        elInfo.selector
      );
      return { success: isFocused };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  private async testClick(
    page: Page,
    element: ElementHandle,
    elInfo: any,
    originalUrl: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const beforeUrl = page.url();

      // Scroll into view
      await element.scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);

      // Get bounding box
      const box = await element.boundingBox();
      if (!box) {
        return { success: false, error: 'Element has no bounding box' };
      }

      // Hover
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(50);

      // Click
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(300);

      // Check if navigated
      const afterUrl = page.url();
      if (afterUrl !== beforeUrl && !afterUrl.includes('logout')) {
        // Navigate back to original page
        await page.goto(originalUrl, { waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(500);
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  private async testInput(page: Page, element: ElementHandle, elInfo: any): Promise<{ success: boolean; error?: string }> {
    try {
      const testValue = 'Safari Test Input';

      if (elInfo.type === 'select') {
        // For select, try to get first option
        const options = await element.$$('option');
        if (options.length > 1) {
          await element.selectOption({ index: 1 });
        }
      } else {
        // For input/textarea, clear and type
        await element.focus();
        await element.fill('');
        await element.type(testValue);

        // Verify
        const value = await element.inputValue();
        if (value !== testValue) {
          return { success: false, error: `Value mismatch: expected "${testValue}", got "${value}"` };
        }

        // Clear after test
        await element.fill('');
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  private async captureElementScreenshot(
    page: Page,
    element: ElementHandle,
    outputDir: string,
    name: string
  ): Promise<string> {
    try {
      const screenshotPath = path.join(outputDir, `${name}.webp`);
      const png = await element.screenshot({ type: 'png' });
      const webp = await sharp(png).webp({ quality: 80 }).toBuffer();
      fs.writeFileSync(screenshotPath, webp);
      return screenshotPath;
    } catch {
      return '';
    }
  }

  private printSummary(report: SafariTestReport): void {
    console.log('\n' + '='.repeat(60));
    console.log('[Safari] TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`URL: ${report.url}`);
    console.log(`Browser: ${report.browser}`);
    console.log(`Page: ${report.pageTitle}`);
    console.log(`Time: ${report.timestamp}`);
    console.log('-'.repeat(60));
    console.log(`Total Elements Tested: ${report.summary.totalElements}`);
    console.log(`Focus Tests:    ${report.summary.focusTests.passed} passed / ${report.summary.focusTests.failed} failed`);
    console.log(`Click Tests:    ${report.summary.clickableTests.passed} passed / ${report.summary.clickableTests.failed} failed`);
    console.log(`Input Tests:    ${report.summary.inputTests.passed} passed / ${report.summary.inputTests.failed} failed`);
    console.log('='.repeat(60));

    // List failures
    const failures = report.elements.filter(el =>
      (el.tests.clickable && !el.tests.clickable.success) ||
      (el.tests.focusable && !el.tests.focusable.success) ||
      (el.tests.inputable && !el.tests.inputable.success)
    );

    if (failures.length > 0) {
      console.log('\n[Safari] FAILED ELEMENTS:');
      failures.forEach((el, i) => {
        console.log(`  ${i + 1}. [${el.type}] "${el.label.substring(0, 40)}"`);
        if (el.tests.clickable && !el.tests.clickable.success) {
          console.log(`     - Click failed: ${el.tests.clickable.error || 'Unknown'}`);
        }
        if (el.tests.focusable && !el.tests.focusable.success) {
          console.log(`     - Focus failed: ${el.tests.focusable.error || 'Unknown'}`);
        }
        if (el.tests.inputable && !el.tests.inputable.success) {
          console.log(`     - Input failed: ${el.tests.inputable.error || 'Unknown'}`);
        }
        if (el.screenshotPath) {
          console.log(`     - Screenshot: ${el.screenshotPath}`);
        }
      });
    } else {
      console.log('\n[Safari] All tests passed!');
    }
  }

  // Compare with Chrome results for cross-browser compatibility
  async compareWithChrome(
    chromeReportPath: string,
    safariReport: SafariTestReport
  ): Promise<{
    differences: Array<{
      selector: string;
      label: string;
      chromeResult: string;
      safariResult: string;
    }>;
  }> {
    if (!fs.existsSync(chromeReportPath)) {
      console.log('[Safari] Chrome report not found for comparison');
      return { differences: [] };
    }

    const chromeReport = JSON.parse(fs.readFileSync(chromeReportPath, 'utf-8'));
    const differences: Array<{
      selector: string;
      label: string;
      chromeResult: string;
      safariResult: string;
    }> = [];

    // Compare elements
    for (const safariEl of safariReport.elements) {
      const chromeEl = chromeReport.elements?.find((e: any) => e.selector === safariEl.selector);

      if (chromeEl) {
        // Compare clickable
        if (safariEl.tests.clickable && chromeEl.tests?.clickable) {
          if (safariEl.tests.clickable.success !== chromeEl.tests.clickable.success) {
            differences.push({
              selector: safariEl.selector,
              label: safariEl.label,
              chromeResult: chromeEl.tests.clickable.success ? 'PASS' : 'FAIL',
              safariResult: safariEl.tests.clickable.success ? 'PASS' : 'FAIL',
            });
          }
        }
      }
    }

    if (differences.length > 0) {
      console.log('\n[Safari] CROSS-BROWSER DIFFERENCES:');
      differences.forEach((d, i) => {
        console.log(`  ${i + 1}. "${d.label.substring(0, 40)}"`);
        console.log(`     Chrome: ${d.chromeResult} | Safari: ${d.safariResult}`);
      });
    } else {
      console.log('\n[Safari] No cross-browser differences found!');
    }

    return { differences };
  }
}
