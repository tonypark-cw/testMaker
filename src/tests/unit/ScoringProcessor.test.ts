import { describe, it, expect, vi } from 'vitest';
import { ScoringProcessor } from '../../scraper/lib/ScoringProcessor.js';

describe('ScoringProcessor', () => {
    const defaultMetadata = {
        url: 'https://stage.ianai.co/app/order/list',
        pageTitle: 'Order List - ianaiERP',
        totalElements: 15
    };

    it('should score a high-quality stable page correctly', async () => {
        // Mock page (not strictly needed for pure logic, but good to have prepared)
        const mockPage: any = {
            evaluate: vi.fn().mockResolvedValue(false), // No spinner
            isVisible: vi.fn().mockResolvedValue(false) // No errors
        };

        const result = await ScoringProcessor.calculate(mockPage, defaultMetadata);

        expect(result.score).toBeGreaterThan(60);
        expect(result.reasons).toEqual([]);
    });

    it('should handle offline analysis (null page) without crashing', async () => {
        const result = await ScoringProcessor.calculate(null, defaultMetadata);

        // Should still calculate score based on metadata (title matching, elements)
        expect(result.score).toBeGreaterThan(0);
        expect(result.reasons).not.toContain('TypeError');
    });

    it('should penalize low element count', async () => {
        const metadata = { ...defaultMetadata, totalElements: 2 };
        const result = await ScoringProcessor.calculate(null, metadata);

        expect(result.reasons).toContain('low-element-count');
        expect(result.breakdown.stability).toBeLessThan(30);
    });

    it('should detect weak path correlation', async () => {
        const metadata = {
            url: 'https://stage.ianai.co/app/unknown-path',
            pageTitle: 'Home', // Doesn't match 'unknown-path'
            totalElements: 20
        };
        const result = await ScoringProcessor.calculate(null, metadata);

        expect(result.reasons).toContain('weak-path-correlation');
    });

    it('should recognize functional path match', async () => {
        const metadata = {
            url: 'https://stage.ianai.co/app/purchasing/orders',
            pageTitle: 'ianaiERP', // Generic title
            functionalPath: 'Home > Purchasing > Purchase Orders',
            totalElements: 20
        };
        const result = await ScoringProcessor.calculate(null, metadata);

        // functionalScore should be high because 'purchasing' matches
        expect(result.breakdown.functional).toBeGreaterThan(20);
        expect(result.reasons).not.toContain('weak-path-correlation');
    });

    it('should penalize loading states if page is provided', async () => {
        const mockPage: any = {
            evaluate: vi.fn().mockImplementation((fn, args) => {
                // If it's the loading check
                return Promise.resolve(true);
            }),
            isVisible: vi.fn().mockResolvedValue(false)
        };

        const result = await ScoringProcessor.calculate(mockPage, defaultMetadata);
        expect(result.reasons).toContain('loading-state');
        expect(result.breakdown.stability).toBeLessThan(20);
    });
});
