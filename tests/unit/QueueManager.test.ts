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

vi.mock('../../src/core/lib/CheckpointManager', () => ({
    CheckpointManager: class MockCheckpointManager {
        load = mockLoad;
        save = mockSave;
        clear = mockClear;
    }
}));

import { QueueManager } from '../../src/core/lib/QueueManager';
import { ScraperConfig } from '../../src/core/types';

describe('QueueManager', () => {
    let queueManager: QueueManager;
    let mockLog: ReturnType<typeof vi.fn>;

    const baseConfig: ScraperConfig = {
        url: 'https://example.com/app',
        depth: 3,
        limit: 50,
        headless: true,
        recursive: true,
        resume: false
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockLog = vi.fn();
        mockLoad.mockReturnValue(null);

        queueManager = new QueueManager(baseConfig, './output', mockLog);
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
                    { url: 'https://example.com/page1', depth: 1, actionChain: [] },
                    { url: 'https://example.com/page2', depth: 2, actionChain: [] }
                ],
                visitedUrls: ['https://example.com/app']
            });

            const resumeManager = new QueueManager(resumeConfig, './output', mockLog);

            expect(resumeManager.getQueueLength()).toBe(2);
            expect(resumeManager.getVisitedCount()).toBe(1);
            expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Resuming from checkpoint'));
        });

        it('should start fresh when no checkpoint found', () => {
            const resumeConfig = { ...baseConfig, resume: true };
            mockLoad.mockReturnValue(null);

            const resumeManager = new QueueManager(resumeConfig, './output', mockLog);

            expect(resumeManager.getQueueLength()).toBe(1);
            expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('No checkpoint found'));
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
                { url: 'https://example.com/page1', depth: 1, actionChain: [] },
                { url: 'https://example.com/page2', depth: 1, actionChain: [] }
            ];

            const added = queueManager.addJobs(newJobs);

            expect(added).toBe(2);
            expect(queueManager.getQueueLength()).toBe(3); // 1 initial + 2 new
        });

        it('should not add duplicate URLs', () => {
            const jobs = [
                { url: 'https://example.com/page1', depth: 1, actionChain: [] },
                { url: 'https://example.com/page1', depth: 1, actionChain: [] } // Duplicate
            ];

            const added = queueManager.addJobs(jobs);

            expect(added).toBe(1);
        });

        it('should not add already visited URLs', () => {
            queueManager.markVisited('https://example.com/visited');

            const added = queueManager.addJobs([
                { url: 'https://example.com/visited', depth: 1, actionChain: [] }
            ]);

            expect(added).toBe(0);
        });

        it('should not add URLs already in queue', () => {
            queueManager.addJobs([
                { url: 'https://example.com/page1', depth: 1, actionChain: [] }
            ]);

            const added = queueManager.addJobs([
                { url: 'https://example.com/page1', depth: 1, actionChain: [] }
            ]);

            expect(added).toBe(0);
        });

        it('should normalize URLs before adding', () => {
            const added = queueManager.addJobs([
                { url: 'https://example.com/page#section', depth: 1, actionChain: [] }
            ]);

            expect(added).toBe(1);

            // Adding same URL without hash should be duplicate
            const addedAgain = queueManager.addJobs([
                { url: 'https://example.com/page', depth: 1, actionChain: [] }
            ]);

            expect(addedAgain).toBe(0);
        });
    });

    describe('markVisited() / isVisited()', () => {
        it('should mark URL as visited', () => {
            expect(queueManager.isVisited('https://example.com/page')).toBe(false);

            queueManager.markVisited('https://example.com/page');

            expect(queueManager.isVisited('https://example.com/page')).toBe(true);
            expect(queueManager.getVisitedCount()).toBe(1);
        });

        it('should normalize URL when checking visited', () => {
            queueManager.markVisited('https://example.com/page/');

            expect(queueManager.isVisited('https://example.com/page')).toBe(true);
            expect(queueManager.isVisited('https://example.com/page#section')).toBe(true);
        });
    });

    describe('normalizeUrl()', () => {
        it('should remove hash fragments', () => {
            const normalized = queueManager.normalizeUrl('https://example.com/page#section');

            expect(normalized).toBe('https://example.com/page');
        });

        it('should remove trailing slashes', () => {
            const normalized = queueManager.normalizeUrl('https://example.com/page/');

            expect(normalized).toBe('https://example.com/page');
        });

        it('should cache normalized URLs', () => {
            const url = 'https://example.com/page#test';

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
            queueManager.markVisited('https://example.com/visited');
            queueManager.addJobs([
                { url: 'https://example.com/page1', depth: 1, actionChain: [] }
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

        it('should load healthy pages as visited', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readdirSync).mockReturnValue(['page1.json', 'page2.json'] as any);
            vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
                if ((p as string).includes('page1')) {
                    return JSON.stringify({
                        url: 'https://example.com/page1',
                        metadata: { totalElements: 50 } // Healthy
                    });
                }
                return JSON.stringify({
                    url: 'https://example.com/page2',
                    metadata: { totalElements: 5 } // Not healthy
                });
            });

            queueManager.loadHealthyVisitedUrls();

            expect(queueManager.isVisited('https://example.com/page1')).toBe(true);
            expect(queueManager.isVisited('https://example.com/page2')).toBe(false);
        });

        it('should handle JSON parse errors gracefully', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readdirSync).mockReturnValue(['invalid.json'] as any);
            vi.mocked(fs.readFileSync).mockReturnValue('not valid json');

            expect(() => queueManager.loadHealthyVisitedUrls()).not.toThrow();
        });
    });

    describe('getQueueLength() / getVisitedCount()', () => {
        it('should return correct queue length', () => {
            expect(queueManager.getQueueLength()).toBe(1);

            queueManager.addJobs([
                { url: 'https://example.com/a', depth: 1, actionChain: [] },
                { url: 'https://example.com/b', depth: 1, actionChain: [] }
            ]);

            expect(queueManager.getQueueLength()).toBe(3);

            queueManager.getNextJob();

            expect(queueManager.getQueueLength()).toBe(2);
        });

        it('should return correct visited count', () => {
            expect(queueManager.getVisitedCount()).toBe(0);

            queueManager.markVisited('https://example.com/a');
            queueManager.markVisited('https://example.com/b');

            expect(queueManager.getVisitedCount()).toBe(2);
        });
    });
});
