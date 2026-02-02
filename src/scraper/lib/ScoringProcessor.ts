import { BrowserPage } from '../adapters/BrowserPage.js';
import sharp from 'sharp';
import * as fs from 'fs';

import { ActionRecord } from '../../types/index.js';

export interface ScoringResult {
    score: number;
    reasons: string[];
    breakdown: {
        visual: number;    // 0-30
        functional: number; // 0-40
        stability: number;  // 0-30
    }
}

export class ScoringProcessor {
    private static ERROR_TEXTS = [
        'error', 'failed', 'exception', 'unexpected', 'oops', '404', '500',
        'internal server error', 'not found', 'unauthorized', 'forbidden',
        '에러', '실패', '잘못된', '오류'
    ];

    private static LOADING_SELECTORS = [
        '.mantine-Loader-root', '.loader', '.spinner', '.loading',
        '[aria-busy="true"]', '.ant-spin', '.nprogress-bar', '.ianai-Loader'
    ];

    /**
     * Unified calculation of page quality and consistency.
     * Scale: 0 - 100
     */
    static async calculate(page: BrowserPage | null, metadata: {
        url: string;
        pageTitle: string;
        screenshotPath?: string;
        functionalPath?: string;
        actionChain?: ActionRecord[];
        totalElements?: number;
    }): Promise<ScoringResult> {
        const reasons: string[] = [];
        let visualScore = 30;
        let functionalScore = 0;
        let stabilityScore = 30;

        // 1. Visual Entropy (30 pts)
        if (metadata.screenshotPath && fs.existsSync(metadata.screenshotPath)) {
            try {
                const stats = await sharp(metadata.screenshotPath).stats();
                const isBlank = stats.channels.every(ch => ch.mean > 250 && ch.stdev < 10);
                if (isBlank) {
                    visualScore = 0;
                    reasons.push('visual-blank');
                }
            } catch { /* ignore */ }
        }

        // 2. Stability / Performance (30 pts)
        let isSpinner = false;
        if (page && typeof page.evaluate === 'function') {
            isSpinner = await page.evaluate((selectors: string[]) => {
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el) {
                        const style = window.getComputedStyle(el);
                        if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0) return true;
                    }
                }
                return false;
            }, this.LOADING_SELECTORS).catch(() => false);
        }

        if (isSpinner) {
            stabilityScore -= 20;
            reasons.push('loading-state');
        }

        let brokenCount = 0;
        if (page && typeof page.evaluate === 'function') {
            brokenCount = await page.evaluate(() => {
                let broken = 0;
                document.querySelectorAll('img').forEach(img => {
                    if (!img.complete || img.naturalWidth === 0) broken++;
                });
                return broken;
            }, undefined).catch(() => 0);
        }

        if (brokenCount > 0) {
            stabilityScore -= Math.min(brokenCount * 5, 10);
            reasons.push(`broken-resources-${brokenCount}`);
        }

        const elementCount = metadata.totalElements || 0;
        if (elementCount < 5) {
            stabilityScore -= 10;
            reasons.push('low-element-count');
        }

        // 3. Functional Path Consistency (40 pts)
        const url = new URL(metadata.url);
        const pathSegments = url.pathname.split('/').filter(s => s && s !== 'app');
        const title = (metadata.pageTitle || '').toLowerCase();

        let pathMatches = false;

        // 3a. Title match
        if (pathSegments.some(seg => title.includes(seg.toLowerCase()))) {
            functionalScore += 15;
        }

        // 3b. Functional/Action context match
        const functionalPath = metadata.functionalPath || '';
        if (functionalPath && pathSegments.some(seg => functionalPath.toLowerCase().includes(seg.toLowerCase()))) {
            pathMatches = true;
        } else if (metadata.actionChain && metadata.actionChain.length > 0) {
            const lastLabel = metadata.actionChain[metadata.actionChain.length - 1].label.toLowerCase();
            if (pathSegments.some(seg => lastLabel.includes(seg.toLowerCase()))) {
                pathMatches = true;
            }
        }

        if (pathMatches) {
            functionalScore += 25;
        } else if (reasons.length === 0 && functionalScore === 0) {
            reasons.push('weak-path-correlation');
        }

        // 4. Critical Blockers (Global Override)
        const errorSelectors = ['.toast-error', '.alert-danger', '[role="alert"]', '.notification-error'];
        let explicitError = false;
        if (page && typeof page.isVisible === 'function') {
            for (const sel of errorSelectors) {
                if (await page.isVisible(sel).catch(() => false)) { explicitError = true; break; }
            }
        }

        // Interactive Element Ratio Check
        if (page && typeof page.evaluate === 'function') {
            const interactionStats = await page.evaluate(() => {
                const total = document.querySelectorAll('*').length;
                if (total === 0) return { ratio: 0, textLength: 0 };

                const interactive = document.querySelectorAll('button, a, input, select, textarea, [role="button"]').length;
                const textLength = document.body.innerText.length;
                return { ratio: interactive / total, textLength };
            }).catch(() => ({ ratio: 0, textLength: 0 }));

            if (interactionStats.ratio < 0.05 && elementCount > 10) {
                // If page has elements but very few interactive ones (likely just text or layout)
                stabilityScore -= 10;
                reasons.push('low-interaction-ratio');
            }

            if (interactionStats.textLength < 50 && elementCount > 0) {
                // Too little text content (likely error page or skeleton)
                stabilityScore -= 10;
                reasons.push('low-text-density');
            }
        }

        let totalScore = visualScore + functionalScore + stabilityScore;
        if (explicitError) {
            totalScore = Math.min(totalScore, 20);
            reasons.push('explicit-error-ui');
        }

        return {
            score: Math.max(0, totalScore),
            reasons,
            breakdown: { visual: visualScore, functional: functionalScore, stability: stabilityScore }
        };
    }
}
