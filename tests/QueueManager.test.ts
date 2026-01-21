/**
 * QueueManager Unit Tests
 * Tests for visited URL lifecycle management
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { QueueManager } from '../src/core/lib/QueueManager.js';
import { ScraperConfig } from '../src/core/types.js';
import * as fs from 'fs';
import * as path from 'path';

describe('QueueManager - Visited URL Lifecycle', () => {
    let queueManager: QueueManager;
    let config: ScraperConfig;
    const testOutputDir = '/tmp/testmaker-test';
    const logs: string[] = [];

    beforeEach(() => {
        // Clean up test directory
        if (fs.existsSync(testOutputDir)) {
            fs.rmSync(testOutputDir, { recursive: true, force: true });
        }
        fs.mkdirSync(testOutputDir, { recursive: true });

        logs.length = 0; // Clear logs

        config = {
            url: 'https://test.example.com',
            depth: 3,
            limit: 100,
            headless: true,
            force: false,
            quiet: false,
            resume: false
        };

        queueManager = new QueueManager(config, testOutputDir, (msg) => logs.push(msg));
    });

    it('should NOT mark start URL as visited when adding to queue', () => {
        const startUrl = 'https://test.example.com/app/page1';

        queueManager.addJobs([{ url: startUrl, depth: 0, actionChain: [] }]);

        // CRITICAL: URL should NOT be visited yet
        expect(queueManager.isVisited(startUrl)).toBe(false);
        expect(queueManager.getQueueLength()).toBe(1);
    });

    it('should mark URL as visited only when explicitly calling markVisited', () => {
        const url = 'https://test.example.com/app/page2';

        queueManager.addJobs([{ url, depth: 0, actionChain: [] }]);

        // Before marking
        expect(queueManager.isVisited(url)).toBe(false);

        // Simulate worker processing
        queueManager.markVisited(url);

        // After marking
        expect(queueManager.isVisited(url)).toBe(true);
        expect(queueManager.getVisitedCount()).toBe(1);
    });

    it('should not add duplicate URLs to queue', () => {
        const url = 'https://test.example.com/app/page3';

        queueManager.addJobs([{ url, depth: 0, actionChain: [] }]);
        queueManager.addJobs([{ url, depth: 0, actionChain: [] }]); // Duplicate

        expect(queueManager.getQueueLength()).toBe(1); // Only one added
    });

    it('should not add visited URLs to queue', () => {
        const url = 'https://test.example.com/app/page4';

        // Mark as visited first
        queueManager.markVisited(url);

        // Try to add
        const added = queueManager.addJobs([{ url, depth: 0, actionChain: [] }]);

        expect(added).toBe(0); // Should not add
        expect(queueManager.getQueueLength()).toBe(0);
    });

    it('should warn when marking already-visited URL', () => {
        const url = 'https://test.example.com/app/page5';

        queueManager.markVisited(url);
        queueManager.markVisited(url); // Duplicate mark

        // Check logs for warning
        const warningLogs = logs.filter(log => log.includes('WARNING') && log.includes('already marked'));
        expect(warningLogs.length).toBeGreaterThan(0);
    });

    it('should follow correct lifecycle: addJobs → getNextJob → markVisited', () => {
        const url1 = 'https://test.example.com/app/page6';
        const url2 = 'https://test.example.com/app/page7';

        // Step 1: Add jobs
        queueManager.addJobs([
            { url: url1, depth: 0, actionChain: [] },
            { url: url2, depth: 1, actionChain: [] }
        ]);

        expect(queueManager.getQueueLength()).toBe(2);
        expect(queueManager.isVisited(url1)).toBe(false);

        // Step 2: Get next job (simulating worker)
        const job = queueManager.getNextJob();
        expect(job?.url).toBe(url1);
        expect(queueManager.getQueueLength()).toBe(1);

        // Step 3: Mark as visited (simulating worker completion)
        queueManager.markVisited(url1);
        expect(queueManager.isVisited(url1)).toBe(true);
        expect(queueManager.getVisitedCount()).toBe(1);
    });

    it('should respect depth limit when adding jobs', () => {
        const url = 'https://test.example.com/app/deep';

        // Try to add job beyond depth limit
        const added = queueManager.addJobs([{ url, depth: 10, actionChain: [] }]);

        expect(added).toBe(0); // Should not add
        expect(queueManager.getQueueLength()).toBe(0);
    });

    it('should normalize URLs correctly', () => {
        const url1 = 'https://test.example.com/page#section';
        const url2 = 'https://test.example.com/page';
        const url3 = 'https://test.example.com/page/';

        // All should be normalized to the same URL
        const norm1 = queueManager.normalizeUrl(url1);
        const norm2 = queueManager.normalizeUrl(url2);
        const norm3 = queueManager.normalizeUrl(url3);

        expect(norm1).toBe(norm2);
        expect(norm2).toBe(norm3);
    });
});

describe('QueueManager - Logging Behavior', () => {
    let queueManager: QueueManager;
    let config: ScraperConfig;
    const testOutputDir = '/tmp/testmaker-test-logs';
    const logs: string[] = [];

    beforeEach(() => {
        if (fs.existsSync(testOutputDir)) {
            fs.rmSync(testOutputDir, { recursive: true, force: true });
        }
        fs.mkdirSync(testOutputDir, { recursive: true });

        logs.length = 0;

        config = {
            url: 'https://test.example.com',
            depth: 3,
            limit: 100,
            headless: true,
            force: false,
            quiet: false,
            resume: false
        };

        queueManager = new QueueManager(config, testOutputDir, (msg) => logs.push(msg));
    });

    it('should log when adding jobs', () => {
        queueManager.addJobs([{ url: 'https://test.example.com/page1', depth: 0, actionChain: [] }]);

        const addLogs = logs.filter(log => log.includes('➕ Added to queue'));
        expect(addLogs.length).toBeGreaterThan(0);
    });

    it('should log when skipping duplicates', () => {
        const url = 'https://test.example.com/page2';
        queueManager.addJobs([{ url, depth: 0, actionChain: [] }]);
        queueManager.addJobs([{ url, depth: 0, actionChain: [] }]); // Duplicate

        const skipLogs = logs.filter(log => log.includes('⏭️  Skipped'));
        expect(skipLogs.length).toBeGreaterThan(0);
    });

    it('should log queue summary after adding', () => {
        queueManager.addJobs([
            { url: 'https://test.example.com/page3', depth: 0, actionChain: [] },
            { url: 'https://test.example.com/page4', depth: 0, actionChain: [] }
        ]);

        const summaryLogs = logs.filter(log => log.includes('📊 Queue summary'));
        expect(summaryLogs.length).toBeGreaterThan(0);
    });
});
