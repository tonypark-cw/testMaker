import { describe, it, expect } from 'vitest';
import { ReliabilityScorer } from './ReliabilityScorer.js';
import { Page } from 'playwright';

// Mock Page
const createMockPage = (innerText: string, visibleSelectors: string[] = []): Page => {
    return {
        innerText: async () => innerText,
        isVisible: async (sel: string) => visibleSelectors.includes(sel),
        evaluate: async (fn: any, args: any) => {
            // Simplified mock for evaluation
            if (fn.toString().includes('img')) return 0; // 0 broken images
            if (fn.toString().includes('selectors')) { // spinner check
                for (const sel of args) {
                    if (visibleSelectors.includes(sel)) return true;
                }
                return false;
            }
            return null;
        }
    } as unknown as Page;
};

describe('ReliabilityScorer', () => {
    it('should return 1.0 for a clean page', async () => {
        const page = createMockPage('Welcome to the dashboard');
        const { score, reasons } = await ReliabilityScorer.calculateScore(page);
        expect(score).toBe(1.0);
        expect(reasons).toHaveLength(0);
    });

    it('should penalize for explicit error UI', async () => {
        const page = createMockPage('Something went wrong', ['.toast-error']);
        const { score, reasons } = await ReliabilityScorer.calculateScore(page);
        expect(score).toBeLessThan(0.4); // 1.0 - 0.8 = 0.2
        expect(reasons).toContain('explicit-error-ui');
    });

    it('should penalize for loading state', async () => {
        const page = createMockPage('Loading...', ['.mantine-Loader-root']);
        const { score, reasons } = await ReliabilityScorer.calculateScore(page);
        expect(score).toBeLessThan(0.6); // 1.0 - 0.5 = 0.5
        expect(reasons).toContain('loading-state');
    });
});
