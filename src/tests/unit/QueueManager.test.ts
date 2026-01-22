import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'fs';

// Mock fs and CheckpointManager
vi.mock('fs', async () => {
    const actual = await vi.importActual('fs');
    return {
        ...actual,
        existsSync: vi.fn(),
        readdirSync: vi.fn(),
        readFileSync: vi.fn()
    };
});

// Store mock functions at module level
const mockLoad = vi.fn();
const mockSave = vi.fn();
const mockClear = vi.fn();

vi.mock('../../scraper/lib/CheckpointManager.js', () => ({
    CheckpointManager: class MockCheckpointManager {
        load = mockLoad;
        save = mockSave;
        clear = mockClear;
    }
}));

import { ActionRecord } from '../../types/index.js';
import { QueueManager } from '../../scraper/queue/QueueManager.js';
import { ScraperConfig } from '../../types/scraper.js';

describe('QueueManager', () => {
    let queueManager: QueueManager;
    let mockLog: ReturnType<typeof vi.fn>;

    const baseConfig: ScraperConfig = {
        url: 'https://example.com/app',
        depth: 3,
        limit: 50,
        headless: true,
        resume: false,
        force: false
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockLog = vi.fn();
        mockLoad.mockReturnValue(null);

        queueManager = new QueueManager(baseConfig, './output', mockLog as any);
        // Explicitly add initial job as the constructor no longer does it
        queueManager.addJobs([{ url: baseConfig.url, depth: 0, actionChain: [] }]);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('constructor', () => {
        it('should initialize with starting URL in queue', () => {
            expect(queueManager.getQueueLength()).toBe(1);
            expect(queueManager.getVisitedCount()).toBe(0);
        });

        it('should load from checkpoint when resume is true', () => {
            const resumeConfig = { ...baseConfig, resume: true };
            mockLoad.mockReturnValue({
                timestamp: '2024-01-01T00:00:00Z',
                queue: [
                    { url: 'https://example.com/app/page1', depth: 1, actionChain: [] },
                    { url: 'https://example.com/app/page2', depth: 2, actionChain: [] }
                ],
                visitedUrls: ['https://example.com/app']
            });

            const resumeManager = new QueueManager(resumeConfig, './output', mockLog as any);

            expect(resumeManager.getQueueLength()).toBe(2);
            expect(resumeManager.getVisitedCount()).toBe(1);
            expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Resuming from checkpoint'));
        });

        it('should start fresh when no checkpoint found', () => {
            const resumeConfig = { ...baseConfig, resume: true };
            mockLoad.mockReturnValue(null);

            const resumeManager = new QueueManager(resumeConfig, './output', mockLog as any);
            resumeManager.addJobs([{ url: baseConfig.url, depth: 0, actionChain: [] }]);

            expect(resumeManager.getQueueLength()).toBe(1);
            // No log is emitted when checkpoint is not found - only when resuming
            expect(mockLog).not.toHaveBeenCalledWith(expect.stringContaining('Resuming from checkpoint'));
        });
    });

    describe('getNextJob()', () => {
        it('should return and remove first job from queue', () => {
            const job = queueManager.getNextJob();

            expect(job).toBeDefined();
            expect(job?.url).toBe('https://example.com/app');
            expect(job?.depth).toBe(0);
            expect(queueManager.getQueueLength()).toBe(0);
        });

        it('should return undefined when queue is empty', () => {
            queueManager.getNextJob(); // Remove initial job

            const job = queueManager.getNextJob();

            expect(job).toBeUndefined();
        });
    });

    describe('addJobs()', () => {
        it('should add new jobs to queue', () => {
            const newJobs = [
                { url: 'https://example.com/app/page1', depth: 1, actionChain: [] },
                { url: 'https://example.com/app/page2', depth: 1, actionChain: [] }
            ];

            const added = queueManager.addJobs(newJobs);

            expect(added).toBe(2);
            expect(queueManager.getQueueLength()).toBe(3); // 1 initial + 2 new
        });

        it('should not add duplicate URLs', () => {
            const jobs = [
                { url: 'https://example.com/app/page1', depth: 1, actionChain: [] },
                { url: 'https://example.com/app/page1', depth: 1, actionChain: [] } // Duplicate
            ];

            const added = queueManager.addJobs(jobs);

            expect(added).toBe(1);
        });

        it('should not add already visited URLs', () => {
            queueManager.markVisited('https://example.com/app/visited');

            const added = queueManager.addJobs([
                { url: 'https://example.com/app/visited', depth: 1, actionChain: [] }
            ]);

            expect(added).toBe(0);
        });

        it('should not add URLs already in queue', () => {
            queueManager.addJobs([
                { url: 'https://example.com/app/page1', depth: 1, actionChain: [] }
            ]);

            const added = queueManager.addJobs([
                { url: 'https://example.com/app/page1', depth: 1, actionChain: [] }
            ]);

            expect(added).toBe(0);
        });

        it('should normalize URLs before adding', () => {
            const added = queueManager.addJobs([
                { url: 'https://example.com/app/page#section', depth: 1, actionChain: [] }
            ]);

            expect(added).toBe(1);

            // Adding same URL without hash should be duplicate
            const addedAgain = queueManager.addJobs([
                { url: 'https://example.com/app/page', depth: 1, actionChain: [] }
            ]);

            expect(addedAgain).toBe(0);
        });
    });

    describe('markVisited() / isVisited()', () => {
        it('should mark URL as visited', () => {
            expect(queueManager.isVisited('https://example.com/app/page')).toBe(false);

            queueManager.markVisited('https://example.com/app/page');

            expect(queueManager.isVisited('https://example.com/app/page')).toBe(true);
            expect(queueManager.getVisitedCount()).toBe(1);
        });

        it('should normalize URL when checking visited', () => {
            queueManager.markVisited('https://example.com/app/page/');

            expect(queueManager.isVisited('https://example.com/app/page')).toBe(true);
            expect(queueManager.isVisited('https://example.com/app/page#section')).toBe(true);
        });
    });

    describe('normalizeUrl()', () => {
        it('should remove hash fragments', () => {
            const normalized = queueManager.normalizeUrl('https://example.com/app/page#section');

            expect(normalized).toBe('https://example.com/app/page');
        });

        it('should remove trailing slashes', () => {
            const normalized = queueManager.normalizeUrl('https://example.com/app/page/');

            expect(normalized).toBe('https://example.com/app/page');
        });

        it('should cache normalized URLs', () => {
            const url = 'https://example.com/app/page#test';

            const first = queueManager.normalizeUrl(url);
            const second = queueManager.normalizeUrl(url);

            expect(first).toBe(second);
        });

        it('should return original URL if invalid', () => {
            const invalid = 'not-a-valid-url';

            const result = queueManager.normalizeUrl(invalid);

            expect(result).toBe(invalid);
        });
    });

    describe('saveCheckpoint() / clearCheckpoint()', () => {
        it('should save checkpoint with current state', () => {
            queueManager.markVisited('https://example.com/app/visited');
            queueManager.addJobs([
                { url: 'https://example.com/app/page1', depth: 1, actionChain: [] }
            ]);

            queueManager.saveCheckpoint();

            expect(mockSave).toHaveBeenCalledWith(
                'example.com',
                expect.objectContaining({
                    queue: expect.any(Array),
                    visitedUrls: expect.any(Set)
                })
            );
        });

        it('should clear checkpoint', () => {
            queueManager.clearCheckpoint();

            expect(mockClear).toHaveBeenCalledWith('example.com');
        });
    });

    describe('loadHealthyVisitedUrls()', () => {
        it('should skip when json directory does not exist', () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);

            queueManager.loadHealthyVisitedUrls();

            expect(fs.readdirSync).not.toHaveBeenCalled();
        });

        it('should seed URLs from past JSON files to queue', () => {
            const initialQueueLength = queueManager.getQueueLength();
            vi.mocked(fs.existsSync).mockReturnValue(true);
            // Return Dirent-like objects with proper methods
            vi.mocked(fs.readdirSync).mockReturnValue([
                { name: 'page1.json', isFile: () => true, isDirectory: () => false },
                { name: 'page2.json', isFile: () => true, isDirectory: () => false }
            ] as unknown as ReturnType<typeof fs.readdirSync>);
            vi.mocked(fs.readFileSync).mockImplementation((p: fs.PathOrFileDescriptor) => {
                if ((p as string).includes('page1')) {
                    return JSON.stringify({
                        url: 'https://example.com/app/page1',
                        metadata: { totalElements: 50 }
                    });
                }
                return JSON.stringify({
                    url: 'https://example.com/app/page2',
                    metadata: { totalElements: 5 }
                });
            });

            queueManager.loadHealthyVisitedUrls();

            // loadHealthyVisitedUrls adds matching URLs to queue, not visited set
            // URLs matching basePath (/app) should be added to queue
            expect(queueManager.getQueueLength()).toBeGreaterThan(initialQueueLength);
        });

        it('should handle JSON parse errors gracefully', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            // Return Dirent-like object with proper methods
            vi.mocked(fs.readdirSync).mockReturnValue([
                { name: 'invalid.json', isFile: () => true, isDirectory: () => false }
            ] as unknown as ReturnType<typeof fs.readdirSync>);
            vi.mocked(fs.readFileSync).mockReturnValue('not valid json');

            expect(() => queueManager.loadHealthyVisitedUrls()).not.toThrow();
        });
    });

    describe('getQueueLength() / getVisitedCount()', () => {
        it('should return correct queue length', () => {
            // Started with 1
            expect(queueManager.getQueueLength()).toBe(1);

            queueManager.addJobs([
                { url: 'https://example.com/app/a', depth: 1, actionChain: [] },
                { url: 'https://example.com/app/b', depth: 1, actionChain: [] }
            ]);

            expect(queueManager.getQueueLength()).toBe(3);

            queueManager.getNextJob();

            expect(queueManager.getQueueLength()).toBe(2);
        });

        it('should return correct visited count', () => {
            expect(queueManager.getVisitedCount()).toBe(0);

            queueManager.markVisited('https://example.com/app/a');
            queueManager.markVisited('https://example.com/app/b');

            expect(queueManager.getVisitedCount()).toBe(2);
        });
    });
});
