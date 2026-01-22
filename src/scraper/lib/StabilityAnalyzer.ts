import { TestableElement, GoldenPathInfo } from '../../types/index.js';
import { ScoringProcessor } from './ScoringProcessor.js';
import { BrowserPage } from '../adapters/BrowserPage.js';

/**
 * StabilityAnalyzer
 * Analyzes page stability based on loading indicators, errors, and testable content
 */
export class StabilityAnalyzer {
    /**
     * Analyze page stability and testability for Golden Path generation
     */
    public static async analyzeGoldenPath(
        page: BrowserPage,
        elements: TestableElement[],
        metadata: { url: string; pageTitle: string; screenshotPath?: string }
    ): Promise<GoldenPathInfo> {
        // Delegate comprehensive scoring to scoring processor
        const result = await ScoringProcessor.calculate(page, {
            ...metadata,
            totalElements: elements.length
        });

        // Map unified score to GoldenPathInfo
        // result.score is 0-100, we need 0.0-1.0
        const confidence = result.score / 100;

        return {
            isStable: result.breakdown.stability >= 20, // Threshold for stable
            hasTestableElements: elements.length >= 3,
            confidence: confidence,
            reasons: result.reasons
        };
    }
}
