import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock SessionManager
const mockGetTokens = vi.fn();
const mockGetAccessToken = vi.fn();

vi.mock('../../src/core/SessionManager', () => ({
    SessionManager: {
        getInstance: vi.fn(() => ({
            getTokens: mockGetTokens,
            getAccessToken: mockGetAccessToken
        }))
    }
}));

import { NetworkManager } from '../../src/core/NetworkManager';
import { BrowserContext, Route, Response, Request } from 'playwright';

describe('NetworkManager', () => {
    let networkManager: NetworkManager;
    let mockContext: BrowserContext;
    let mockRoute: Route;
    let mockRequest: Request;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();

        networkManager = new NetworkManager();

        // Mock Route
        mockRequest = {
            url: vi.fn(),
            allHeaders: vi.fn().mockResolvedValue({}),
            method: vi.fn().mockReturnValue('GET')
        } as unknown as Request;

        mockRoute = {
            request: vi.fn().mockReturnValue(mockRequest),
            continue: vi.fn().mockResolvedValue(undefined),
            abort: vi.fn().mockResolvedValue(undefined)
        } as unknown as Route;

        // Mock BrowserContext
        mockContext = {
            route: vi.fn(),
            on: vi.fn()
        } as unknown as BrowserContext;

        // Default mock values
        mockGetTokens.mockReturnValue({ accessToken: 'test-token', refreshToken: 'refresh-token' });
        mockGetAccessToken.mockResolvedValue('test-access-token');
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    describe('getRateLimitUntil() / resetRateLimit()', () => {
        it('should return 0 initially', () => {
            expect(networkManager.getRateLimitUntil()).toBe(0);
        });

        it('should reset rate limit', () => {
            // Simulate rate limit being set (internal state)
            networkManager.resetRateLimit();

            expect(networkManager.getRateLimitUntil()).toBe(0);
        });
    });

    describe('enableHeaderInjection()', () => {
        it('should set up route handler', async () => {
            await networkManager.enableHeaderInjection(mockContext, 'company-123');

            expect(mockContext.route).toHaveBeenCalledWith('**/*', expect.any(Function));
        });

        it('should inject company-id header for target domains', async () => {
            vi.mocked(mockRequest.url).mockReturnValue('https://api.ianai.co/v2/data');
            vi.mocked(mockRequest.allHeaders).mockResolvedValue({ 'content-type': 'application/json' });

            await networkManager.enableHeaderInjection(mockContext, 'company-123');

            // Get the route handler
            const routeHandler = vi.mocked(mockContext.route).mock.calls[0][1] as (route: Route) => Promise<void>;

            await routeHandler(mockRoute);

            expect(mockRoute.continue).toHaveBeenCalledWith({
                headers: expect.objectContaining({
                    'company-id': 'company-123'
                })
            });
        });

        it('should inject Authorization header when token available', async () => {
            vi.mocked(mockRequest.url).mockReturnValue('https://api.ianai.co/v2/data');
            vi.mocked(mockRequest.allHeaders).mockResolvedValue({});

            await networkManager.enableHeaderInjection(mockContext, 'company-123');

            const routeHandler = vi.mocked(mockContext.route).mock.calls[0][1] as (route: Route) => Promise<void>;
            await routeHandler(mockRoute);

            expect(mockRoute.continue).toHaveBeenCalledWith({
                headers: expect.objectContaining({
                    'Authorization': 'Bearer test-access-token'
                })
            });
        });

        it('should not inject headers for non-target domains', async () => {
            vi.mocked(mockRequest.url).mockReturnValue('https://cdn.cloudflare.com/script.js');

            await networkManager.enableHeaderInjection(mockContext, 'company-123');

            const routeHandler = vi.mocked(mockContext.route).mock.calls[0][1] as (route: Route) => Promise<void>;
            await routeHandler(mockRoute);

            // Should continue without custom headers
            expect(mockRoute.continue).toHaveBeenCalledWith();
        });

        it('should cache token for 5 seconds', async () => {
            vi.mocked(mockRequest.url).mockReturnValue('https://api.ianai.co/v2/data');
            vi.mocked(mockRequest.allHeaders).mockResolvedValue({});

            await networkManager.enableHeaderInjection(mockContext, 'company-123');

            const routeHandler = vi.mocked(mockContext.route).mock.calls[0][1] as (route: Route) => Promise<void>;

            // First call - should fetch token
            await routeHandler(mockRoute);
            expect(mockGetAccessToken).toHaveBeenCalledTimes(1);

            // Second call within 5 seconds - should use cache
            vi.advanceTimersByTime(3000);
            await routeHandler(mockRoute);
            expect(mockGetAccessToken).toHaveBeenCalledTimes(1); // Still 1

            // Third call after 5 seconds - should refresh
            vi.advanceTimersByTime(3000);
            await routeHandler(mockRoute);
            expect(mockGetAccessToken).toHaveBeenCalledTimes(2);
        });

        it('should handle ianai-dev.com domain', async () => {
            vi.mocked(mockRequest.url).mockReturnValue('https://api.ianai-dev.com/v2/test');
            vi.mocked(mockRequest.allHeaders).mockResolvedValue({});

            await networkManager.enableHeaderInjection(mockContext, 'company-456');

            const routeHandler = vi.mocked(mockContext.route).mock.calls[0][1] as (route: Route) => Promise<void>;
            await routeHandler(mockRoute);

            expect(mockRoute.continue).toHaveBeenCalledWith({
                headers: expect.objectContaining({
                    'company-id': 'company-456'
                })
            });
        });

        it('should handle localhost', async () => {
            vi.mocked(mockRequest.url).mockReturnValue('http://localhost:3000/api/test');
            vi.mocked(mockRequest.allHeaders).mockResolvedValue({});

            await networkManager.enableHeaderInjection(mockContext, 'company-789');

            const routeHandler = vi.mocked(mockContext.route).mock.calls[0][1] as (route: Route) => Promise<void>;
            await routeHandler(mockRoute);

            expect(mockRoute.continue).toHaveBeenCalledWith({
                headers: expect.objectContaining({
                    'company-id': 'company-789'
                })
            });
        });

        it('should skip token injection when tokens not initialized', async () => {
            vi.mocked(mockRequest.url).mockReturnValue('https://api.ianai.co/v2/data');
            vi.mocked(mockRequest.allHeaders).mockResolvedValue({});
            mockGetTokens.mockReturnValue({ accessToken: '', refreshToken: '' });

            await networkManager.enableHeaderInjection(mockContext, 'company-123');

            const routeHandler = vi.mocked(mockContext.route).mock.calls[0][1] as (route: Route) => Promise<void>;
            await routeHandler(mockRoute);

            expect(mockGetAccessToken).not.toHaveBeenCalled();
            expect(mockRoute.continue).toHaveBeenCalledWith({
                headers: expect.objectContaining({
                    'company-id': 'company-123'
                })
            });
        });
    });

    describe('setupRateLimitHandler()', () => {
        let mockCallbacks: {
            on429: ReturnType<typeof vi.fn>;
            onRecovery: ReturnType<typeof vi.fn>;
        };
        let responseHandler: (response: Response) => Promise<void>;

        beforeEach(() => {
            mockCallbacks = {
                on429: vi.fn(),
                onRecovery: vi.fn()
            };

            networkManager.setupRateLimitHandler(mockContext, mockCallbacks);
            responseHandler = vi.mocked(mockContext.on).mock.calls[0][1] as (response: Response) => Promise<void>;
        });

        it('should set up response listener', () => {
            expect(mockContext.on).toHaveBeenCalledWith('response', expect.any(Function));
        });

        it('should handle 429 response with tiered backoff', async () => {
            const mockResponse = {
                url: vi.fn().mockReturnValue('https://api.ianai.co/test'),
                status: vi.fn().mockReturnValue(429),
                request: vi.fn().mockReturnValue({ method: vi.fn().mockReturnValue('GET') })
            } as unknown as Response;

            await responseHandler(mockResponse);

            expect(mockCallbacks.on429).toHaveBeenCalledWith(
                'https://api.ianai.co/test',
                'GET',
                30000, // Base delay
                1,     // First 429
                false  // Not deep sleep
            );
            expect(networkManager.getRateLimitUntil()).toBeGreaterThan(0);
        });

        it('should increase delay exponentially on consecutive 429s', async () => {
            const mockResponse = {
                url: vi.fn().mockReturnValue('https://api.ianai.co/test'),
                status: vi.fn().mockReturnValue(429),
                request: vi.fn().mockReturnValue({ method: vi.fn().mockReturnValue('POST') })
            } as unknown as Response;

            // First 429
            await responseHandler(mockResponse);
            expect(mockCallbacks.on429).toHaveBeenLastCalledWith(
                expect.any(String), 'POST', 30000, 1, false
            );

            // Second 429
            await responseHandler(mockResponse);
            expect(mockCallbacks.on429).toHaveBeenLastCalledWith(
                expect.any(String), 'POST', 60000, 2, false
            );

            // Third 429
            await responseHandler(mockResponse);
            expect(mockCallbacks.on429).toHaveBeenLastCalledWith(
                expect.any(String), 'POST', 120000, 3, false
            );
        });

        it('should trigger deep sleep after 8 consecutive 429s', async () => {
            const mockResponse = {
                url: vi.fn().mockReturnValue('https://api.ianai.co/test'),
                status: vi.fn().mockReturnValue(429),
                request: vi.fn().mockReturnValue({ method: vi.fn().mockReturnValue('GET') })
            } as unknown as Response;

            // Trigger 8 consecutive 429s
            for (let i = 0; i < 8; i++) {
                await responseHandler(mockResponse);
            }

            expect(mockCallbacks.on429).toHaveBeenLastCalledWith(
                expect.any(String), 'GET', 1800000, 8, true // Deep sleep = 30 mins
            );
        });

        it('should recover after 10 successful responses', async () => {
            const mock429 = {
                url: vi.fn().mockReturnValue('https://api.ianai.co/test'),
                status: vi.fn().mockReturnValue(429),
                request: vi.fn().mockReturnValue({ method: vi.fn().mockReturnValue('GET') })
            } as unknown as Response;

            const mockSuccess = {
                url: vi.fn().mockReturnValue('https://api.ianai.co/data'),
                status: vi.fn().mockReturnValue(200),
                request: vi.fn().mockReturnValue({ method: vi.fn().mockReturnValue('GET') })
            } as unknown as Response;

            // Trigger 429
            await responseHandler(mock429);
            expect(networkManager.getRateLimitUntil()).toBeGreaterThan(0);

            // 10 successful responses
            for (let i = 0; i < 10; i++) {
                await responseHandler(mockSuccess);
            }

            expect(mockCallbacks.onRecovery).toHaveBeenCalledWith(10);
            expect(networkManager.getRateLimitUntil()).toBe(0);
        });

        it('should not count static resources for recovery', async () => {
            const mock429 = {
                url: vi.fn().mockReturnValue('https://api.ianai.co/test'),
                status: vi.fn().mockReturnValue(429),
                request: vi.fn().mockReturnValue({ method: vi.fn().mockReturnValue('GET') })
            } as unknown as Response;

            const mockStatic = {
                url: vi.fn().mockReturnValue('https://cdn.ianai.co/image.png'),
                status: vi.fn().mockReturnValue(200),
                request: vi.fn().mockReturnValue({ method: vi.fn().mockReturnValue('GET') })
            } as unknown as Response;

            const mockApi = {
                url: vi.fn().mockReturnValue('https://api.ianai.co/data'),
                status: vi.fn().mockReturnValue(200),
                request: vi.fn().mockReturnValue({ method: vi.fn().mockReturnValue('GET') })
            } as unknown as Response;

            await responseHandler(mock429);

            // Static resources don't count
            for (let i = 0; i < 20; i++) {
                await responseHandler(mockStatic);
            }
            expect(mockCallbacks.onRecovery).not.toHaveBeenCalled();

            // API calls count
            for (let i = 0; i < 10; i++) {
                await responseHandler(mockApi);
            }
            expect(mockCallbacks.onRecovery).toHaveBeenCalled();
        });
    });

    describe('setupRequestBlocking()', () => {
        const originalEnv = process.env.BLOCK_REFRESH_TOKEN;

        afterEach(() => {
            process.env.BLOCK_REFRESH_TOKEN = originalEnv;
        });

        it('should block refresh token requests when enabled', async () => {
            delete process.env.BLOCK_REFRESH_TOKEN; // Default: enabled

            await networkManager.setupRequestBlocking(mockContext);

            expect(mockContext.route).toHaveBeenCalledWith('**/v2/user/token', expect.any(Function));
        });

        it('should not set up blocking when BLOCK_REFRESH_TOKEN is false', async () => {
            process.env.BLOCK_REFRESH_TOKEN = 'false';

            await networkManager.setupRequestBlocking(mockContext);

            expect(mockContext.route).not.toHaveBeenCalled();
        });

        it('should abort matched requests', async () => {
            delete process.env.BLOCK_REFRESH_TOKEN;
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            await networkManager.setupRequestBlocking(mockContext);

            const blockHandler = vi.mocked(mockContext.route).mock.calls[0][1] as (route: Route) => void;
            blockHandler(mockRoute);

            expect(mockRoute.abort).toHaveBeenCalled();
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Blocked refresh token request'));

            consoleSpy.mockRestore();
        });
    });
});
