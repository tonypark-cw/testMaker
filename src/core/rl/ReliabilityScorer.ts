import { Page } from 'playwright';
import sharp from 'sharp';
import * as fs from 'fs';

/**
 * ReliabilityScorer: Evaluates the quality and reliability of a captured page state.
 * Returns a score between 0.0 (Unusable) and 1.0 (Golden Candidate).
 */
export class ReliabilityScorer {

    // Contamination Patterns (Negative R)
    private static ERROR_TEXTS = [
        'error', 'failed', 'exception', 'unexpected', 'oops', '404', '500',
        'internal server error', 'not found', 'unauthorized', 'forbidden',
        '에러', '실패', '잘못된', '오류'
    ];

    // Loading Indicators (Instability)
    private static LOADING_SELECTORS = [
        '.mantine-Loader-root', '.loader', '.spinner', '.loading',
        '[aria-busy="true"]', '.ant-spin', '.nprogress-bar', '.ianai-Loader'
    ];

    /**
     * Calculates the comprehensive Reliability Score for a given page state.
     * @param page Playwright Page object
     * @param screenshotPath Path to the captured screenshot
     */
    static async calculateScore(page: Page, screenshotPath?: string): Promise<{ score: number, reasons: string[] }> {
        let score = 1.0;
        const reasons: string[] = [];

        // 1. Check for Visual Contamination (Blank / Low Entropy)
        if (screenshotPath && fs.existsSync(screenshotPath)) {
            const isBlank = await this.isImageBlank(screenshotPath);
            if (isBlank) {
                return { score: 0.0, reasons: ['visual-blank'] };
            }
        }

        // 2. Check for textual indicators of failure
        const bodyText = await page.innerText('body').catch(() => '') || '';
        const lowerText = bodyText.toLowerCase();

        let errorCount = 0;
        // Simple heuristic: if "Error" appears prominently (e.g., in headings or toasts)
        // We'll scan specifically for Toast/Alert elements usually
        // But for now, simple text scan.
        for (const err of this.ERROR_TEXTS) {
            if (lowerText.includes(err)) {
                // Heuristic: Count isolated occurrences to avoid matching inside words like "terrified"
                // But simplified for now
                errorCount++;
            }
        }

        // If error text is found, we penalize heavily
        // We check if it's a real error by checking context (e.g. valid error message vs random text)
        // For robustness, let's look for specific error containers
        const errorSelectors = ['.toast-error', '.alert-danger', '[role="alert"]', '.notification-error'];
        let explicitErrorFound = false;
        for (const sel of errorSelectors) {
            if (await page.isVisible(sel).catch(() => false)) {
                explicitErrorFound = true;
                break;
            }
        }

        if (explicitErrorFound) {
            score -= 0.8; // Huge penalty for explicit error UI
            reasons.push('explicit-error-ui');
        } else if (errorCount > 0) {
            // Soft penalty for text, might be false positive
            // score -= 0.1; 
            // actually, ignore raw text unless in specific context to avoid false positives
        }

        // 3. Check for leftover loading states (Instability)
        const isLoading = await this.isSpinnerVisible(page);
        if (isLoading) {
            score -= 0.5; // Significant penalty for unstable state
            reasons.push('loading-state');
        }

        // 4. Broken Images/Links Check
        const brokenResourceCount = await this.countBrokenResources(page);
        if (brokenResourceCount > 0) {
            score -= (brokenResourceCount * 0.05); // Small penalty per broken asset
            reasons.push(`broken-resources-${brokenResourceCount}`);
        }

        // Clamp score
        return {
            score: Math.max(0.0, score),
            reasons
        };
    }

    private static async isImageBlank(imagePath: string): Promise<boolean> {
        try {
            const stats = await sharp(imagePath).stats();
            // Same logic as Scraper.ts
            return stats.channels.every(ch => ch.mean > 250 && ch.stdev < 10);
        } catch (e) {
            return false; // Assume fine if check fails
        }
    }

    private static async isSpinnerVisible(page: Page): Promise<boolean> {
        return await page.evaluate((selectors) => {
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el) {
                    const style = window.getComputedStyle(el);
                    if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0) {
                        return true;
                    }
                }
            }
            return false;
        }, this.LOADING_SELECTORS).catch(() => false);
    }

    private static async countBrokenResources(page: Page): Promise<number> {
        return await page.evaluate(() => {
            let broken = 0;
            document.querySelectorAll('img').forEach(img => {
                if (!img.complete || img.naturalWidth === 0) broken++;
            });
            return broken;
        });
    }
}
