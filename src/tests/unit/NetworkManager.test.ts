import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NetworkManager } from '../../shared/network/NetworkManager.js';

describe('NetworkManager', () => {
    let networkManager: NetworkManager;
    let mockContext: any;
    let mockRoute: any;
    let mockRequest: any;
    let mockGetAccessToken: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockRoute = {
            continue: vi.fn(),
            request: () => mockRequest
        };

        mockRequest = {
            url: vi.fn(),
            method: vi.fn().mockReturnValue('GET'),
            allHeaders: vi.fn().mockResolvedValue({})
        };

        mockContext = {
            route: vi.fn()
        };

        mockGetAccessToken = vi.fn().mockResolvedValue('test-access-token');

        networkManager = new NetworkManager();
        networkManager.setAuthProvider({
            getAccessToken: mockGetAccessToken,
            getTokens: () => ({ accessToken: 'old', refreshToken: 'old' })
        } as any);
    });

    describe('enableHeaderInjection()', () => {
        it('should inject Authorization and company-id headers for matched domains', async () => {
            await networkManager.enableHeaderInjection(mockContext as any, 'company-123');

            const routeHandler = mockContext.route.mock.calls[0][1];
            mockRequest.url.mockReturnValue('https://dev.ianai.co/api/data');

            await routeHandler(mockRoute);

            expect(mockRoute.continue).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({
                    'Authorization': 'Bearer test-access-token',
                    'company-id': 'company-123'
                })
            }));
        });

        it('should skip injection for non-matched domains', async () => {
            await networkManager.enableHeaderInjection(mockContext as any, 'company-123');
            const routeHandler = mockContext.route.mock.calls[0][1];

            mockRequest.url.mockReturnValue('https://google.com');

            await routeHandler(mockRoute);

            expect(mockRoute.continue).toHaveBeenCalledWith();
        });

        it('should cache token for 5 seconds', async () => {
            await networkManager.enableHeaderInjection(mockContext as any, 'company-123');
            const routeHandler = mockContext.route.mock.calls[0][1];
            mockRequest.url.mockReturnValue('https://dev.ianai.co/api/1');

            // First call
            await routeHandler(mockRoute);
            expect(mockGetAccessToken).toHaveBeenCalledTimes(1);

            // Second call (immediate) - should use cache
            mockRequest.url.mockReturnValue('https://dev.ianai.co/api/2');
            await routeHandler(mockRoute);
            expect(mockGetAccessToken).toHaveBeenCalledTimes(1);
        });

        it('should handle ianai-dev.com domain', async () => {
            await networkManager.enableHeaderInjection(mockContext as any, 'company-456');
            const routeHandler = mockContext.route.mock.calls[0][1];

            mockRequest.url.mockReturnValue('https://api.ianai-dev.com/data');
            await routeHandler(mockRoute);

            expect(mockRoute.continue).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({
                    'company-id': 'company-456'
                })
            }));
        });

        it('should handle localhost', async () => {
            await networkManager.enableHeaderInjection(mockContext as any, 'company-789');
            const routeHandler = mockContext.route.mock.calls[0][1];

            mockRequest.url.mockReturnValue('http://localhost:3000/api');
            await routeHandler(mockRoute);

            expect(mockRoute.continue).toHaveBeenCalledWith(expect.objectContaining({
                headers: expect.objectContaining({
                    'company-id': 'company-789'
                })
            }));
        });
    });
});
