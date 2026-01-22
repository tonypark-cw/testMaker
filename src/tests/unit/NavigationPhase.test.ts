import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NavigationPhase } from '../../scraper/phases/NavigationPhase.js';
import { ExplorationContext } from '../../scraper/phases/ExplorationContext.js';

describe('NavigationPhase', () => {
    let phase: NavigationPhase;
    let mockContext: any;
    let mockPage: any;

    beforeEach(() => {
        phase = new NavigationPhase();
        mockPage = {
            goto: vi.fn().mockResolvedValue(null),
            waitForLoadState: vi.fn().mockResolvedValue(null),
            url: vi.fn().mockReturnValue('http://example.com'),
            evaluate: vi.fn().mockImplementation((fn, arg) => {
                // Execute the function in the current test environment (simulating browser)
                // We need to mock window and history here for the evaluate to work

                // Mock browser globals for evaluations
                const mockWindow = {
                    __discoveredRoutes: undefined as Set<string> | undefined,
                    history: {
                        pushState: vi.fn(),
                        replaceState: vi.fn()
                    }
                };

                // Simulate the logic inside evaluate
                // Note: We can't actually run the passed function easily if it depends on browser context
                // Instead, we verify that evaluate is CALLED with the right signature
                return Promise.resolve();
            })
        };
        mockContext = {
            page: mockPage,
            url: 'http://example.com',
            results: { targetUrl: '' }
        };
    });

    it('should execute navigation and setup SPA interception', async () => {
        const result = await phase.execute(mockContext);

        expect(mockPage.goto).toHaveBeenCalledWith('http://example.com', expect.any(Object));
        expect(mockPage.evaluate).toHaveBeenCalled(); // Verify SPA interception hook was installed
        expect(result.success).toBe(true);
    });
});
