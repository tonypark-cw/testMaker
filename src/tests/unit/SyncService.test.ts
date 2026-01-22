import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncService } from '../../shared/network/SyncService.js';
import * as fs from 'fs';

// Mock PrismaClient
const mockExecutionCreate = vi.fn();
const mockPageUpsert = vi.fn();
const mockCaptureUpsert = vi.fn();
const mockDisconnect = vi.fn();

vi.mock('@prisma/client', () => {
    return {
        PrismaClient: class {
            execution = { create: mockExecutionCreate };
            page = { upsert: mockPageUpsert };
            capture = { upsert: mockCaptureUpsert };
            $disconnect = mockDisconnect;
        },
        Prisma: {}
    };
});

// Mock fs to avoid file system operations
vi.mock('fs');

describe('SyncService', () => {
    let syncService: SyncService;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.DATABASE_URL = 'postgresql://mock:mock@remotehost:5432/mock';
        syncService = new SyncService();
    });



    describe('syncDirectory', () => {
        const mockJsonDir = '/mock/json/dir';
        const mockFiles = ['result1.json'];
        const mockSearchResult = {
            url: 'https://example.com/page1',
            timestamp: '1234567890',
            elements: [{ type: 'button', selector: '.btn' }],
            screenshotPath: '/path/to/screenshot.png'
        };

        beforeEach(() => {
            // Setup fs mocks
            vi.spyOn(fs, 'existsSync').mockReturnValue(true);
            vi.spyOn(fs, 'readdirSync').mockReturnValue(mockFiles as any);
            vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockSearchResult));

            // Setup Prisma mocks
            mockExecutionCreate.mockResolvedValue({ id: 'exec-123' });
            mockPageUpsert.mockResolvedValue({});
            mockCaptureUpsert.mockResolvedValue({});
        });

        it('should sync files successfully', async () => {
            await syncService.syncDirectory(mockJsonDir, 'dev', 'https://dev.example.com');

            // Verify Execution creation
            expect(mockExecutionCreate).toHaveBeenCalledWith({
                data: {
                    environment: 'dev',
                    baseUrl: 'https://dev.example.com',
                    status: 'completed'
                }
            });

            // Verify Page Upsert
            expect(mockPageUpsert).toHaveBeenCalledWith({
                where: { url: mockSearchResult.url },
                update: { domain: 'example.com' },
                create: { url: mockSearchResult.url, domain: 'example.com' }
            });

            // Verify Capture Upsert
            expect(mockCaptureUpsert).toHaveBeenCalledWith({
                where: {
                    pageUrl_hash: {
                        pageUrl: mockSearchResult.url,
                        hash: mockSearchResult.timestamp
                    }
                },
                update: {
                    elementsData: mockSearchResult.elements,
                    screenshotPath: mockSearchResult.screenshotPath,
                    executionId: 'exec-123'
                },
                create: {
                    pageUrl: mockSearchResult.url,
                    hash: mockSearchResult.timestamp,
                    elementsData: mockSearchResult.elements,
                    screenshotPath: mockSearchResult.screenshotPath,
                    executionId: 'exec-123'
                }
            });

            // Verify disconnect
            expect(mockDisconnect).toHaveBeenCalled();
        });

        it('should handle missing directory gracefully', async () => {
            vi.spyOn(fs, 'existsSync').mockReturnValue(false);

            await syncService.syncDirectory('/missing/dir', 'dev', 'url');

            expect(mockExecutionCreate).not.toHaveBeenCalled();
        });

        it('should handle JSON parse errors and continue', async () => {
            vi.spyOn(fs, 'readdirSync').mockReturnValue(['bad.json', 'good.json'] as any);
            vi.spyOn(fs, 'readFileSync').mockImplementation((path) => {
                if (path.toString().includes('bad.json')) throw new Error('Parse error');
                return JSON.stringify(mockSearchResult);
            });

            await syncService.syncDirectory(mockJsonDir, 'dev', 'url');

            // Should have succeeded for good.json (called once)
            expect(mockCaptureUpsert).toHaveBeenCalledTimes(1);
        });
    });
});
