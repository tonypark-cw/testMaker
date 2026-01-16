import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../../src/core/SessionManager';

describe('SessionManager', () => {
    let sessionManager: SessionManager;

    beforeEach(() => {
        sessionManager = SessionManager.getInstance();
        sessionManager._reset();
    });

    it('should implement Singleton pattern', () => {
        const instance1 = SessionManager.getInstance();
        const instance2 = SessionManager.getInstance();
        expect(instance1).toBe(instance2);
    });

    it('should store and retrieve tokens', async () => {
        const expiresIn = 3600; // 1 hour
        sessionManager.setTokens('access-1', 'refresh-1', expiresIn);

        const token = await sessionManager.getAccessToken();
        expect(token).toBe('access-1');
        expect(sessionManager.isExpiringSoon()).toBe(false);
    });

    it('should trigger refresh when expiring soon', async () => {
        // Setup mock handler
        const mockHandler = vi.fn().mockResolvedValue({
            accessToken: 'access-2',
            refreshToken: 'refresh-2',
            expiresIn: 3600
        });
        sessionManager.setRefreshHandler(mockHandler);

        // Set token expiring in 30 seconds (threshold is 60s)
        sessionManager.setTokens('access-expired', 'refresh-expired', 30);

        expect(sessionManager.isExpiringSoon()).toBe(true);

        const newToken = await sessionManager.getAccessToken();

        expect(mockHandler).toHaveBeenCalledTimes(1);
        expect(newToken).toBe('access-2');
    });

    it('should debounce concurrent refresh requests', async () => {
        // Setup mock handler with delay to simulate network
        const mockHandler = vi.fn().mockImplementation(async () => {
            await new Promise(resolve => setTimeout(resolve, 100));
            return {
                accessToken: 'access-new',
                refreshToken: 'refresh-new',
                expiresIn: 3600
            };
        });
        sessionManager.setRefreshHandler(mockHandler);

        // Set expired token
        sessionManager.setTokens('expired', 'refresh', 0);

        // Simulate 3 concurrent calls
        const promises = [
            sessionManager.getAccessToken(),
            sessionManager.getAccessToken(),
            sessionManager.getAccessToken()
        ];

        const results = await Promise.all(promises);

        // Assertions
        expect(mockHandler).toHaveBeenCalledTimes(1); // Should only be called ONCE
        results.forEach(token => expect(token).toBe('access-new'));
    });

    it('should throw error if handler not set', async () => {
        sessionManager.setTokens('expired', 'refresh', 0);
        await expect(sessionManager.getAccessToken()).rejects.toThrow('Refresh handler not configured');
    });
});
