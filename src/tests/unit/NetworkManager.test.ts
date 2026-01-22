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
            route: vi.fn(),
            on: vi.fn()
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

    describe('setupTransactionCapturer()', () => {
        it('should capture valid API requests', async () => {
            const onCapture = vi.fn();
            networkManager.setupTransactionCapturer(mockContext, onCapture);

            const startRequestHandler = mockContext.on.mock.calls.find((c: any) => c[0] === 'request')[1];

            const mockApiRequest = {
                url: () => 'https://api.ianai.co/v2/customer/019b34cf-d42a-7501-97e2-efc8dcb98a88',
                method: () => 'POST',
                postDataJSON: () => ({ name: 'Test Customer' })
            };

            await startRequestHandler(mockApiRequest);

            expect(onCapture).toHaveBeenCalledWith(
                'req',
                'customer',
                '019b34cf-d42a-7501-97e2-efc8dcb98a88',
                { name: 'Test Customer' },
                null
            );
        });

        it('should capture valid API responses', async () => {
            const onCapture = vi.fn();
            networkManager.setupTransactionCapturer(mockContext, onCapture);

            const responseHandler = mockContext.on.mock.calls.find((c: any) => c[0] === 'response')[1];

            const mockResponse = {
                url: () => 'https://api.ianai.co/v2/invoice/019b34cf-d42a-7501-97e2-efc8dcb98a88',
                status: () => 200,
                headers: () => ({ 'content-type': 'application/json' }),
                json: async () => ({ id: 'inv-123', total: 100 })
            };

            await responseHandler(mockResponse);

            expect(onCapture).toHaveBeenCalledWith(
                'res',
                'invoice',
                '019b34cf-d42a-7501-97e2-efc8dcb98a88',
                { id: 'inv-123', total: 100 },
                null
            );
        });

        it('should ignore auditlog requests', async () => {
            const onCapture = vi.fn();
            networkManager.setupTransactionCapturer(mockContext, onCapture);
            const startRequestHandler = mockContext.on.mock.calls.find((c: any) => c[0] === 'request')[1];

            const mockAuditRequest = {
                url: () => 'https://api.ianai.co/v2/auditlog/history/1234',
                method: () => 'POST',
                postDataJSON: () => ({})
            };

            await startRequestHandler(mockAuditRequest);
            expect(onCapture).not.toHaveBeenCalled();
        });
    });
});
