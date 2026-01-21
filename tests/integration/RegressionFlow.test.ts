import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'fs';

// Mock fs before imports
vi.mock('fs', async () => {
    const actual = await vi.importActual('fs');
    return {
        ...actual,
        existsSync: vi.fn(),
        mkdirSync: vi.fn(),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn(),
        copyFileSync: vi.fn(),
        statSync: vi.fn(),
        unlinkSync: vi.fn()
    };
});

vi.mock('sharp', () => ({
    default: vi.fn(() => ({
        png: vi.fn().mockReturnThis(),
        toFile: vi.fn().mockResolvedValue(undefined),
        metadata: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
        resize: vi.fn().mockReturnThis()
    }))
}));

vi.mock('pixelmatch', () => ({
    default: vi.fn()
}));

vi.mock('pngjs', () => {
    class MockPNG {
        data: Buffer;
        width: number;
        height: number;

        static sync = {
            read: vi.fn(),
            write: vi.fn()
        };

        constructor({ width, height }: { width: number; height: number }) {
            this.width = width;
            this.height = height;
            this.data = Buffer.alloc(width * height * 4);
        }
    }
    return { PNG: MockPNG };
});

import { BaselineManager } from '../../src/regression/BaselineManager';
import { ContentComparator } from '../../src/regression/ContentComparator';
import { ContentExtractor, PageContent } from '../../src/regression/ContentExtractor';
import { AnomalyDetector } from '../../src/regression/AnomalyDetector';
import { VisualComparator } from '../../src/regression/VisualComparator';
import { BaselineIndex } from '../../src/regression/types';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

describe('Regression Testing Integration', () => {
    let baselineManager: BaselineManager;
    let contentComparator: ContentComparator;
    let anomalyDetector: AnomalyDetector;
    let visualComparator: VisualComparator;

    const testUrl = 'https://example.com/dashboard';
    const testDomain = 'example.com';

    const mockBaselineIndex: BaselineIndex = {
        domain: testDomain,
        pages: {
            [testUrl]: {
                url: testUrl,
                domain: testDomain,
                screenshotPath: '/output/baselines/example.com/pages/dashboard/golden.webp',
                screenshotHash: 'abc123',
                metadata: {
                    timestamp: '2024-01-01T00:00:00Z',
                    pageTitle: 'Dashboard',
                    elementCount: 25
                },
                isGolden: true
            }
        }
    };

    const mockBaselineContent: PageContent = {
        url: testUrl,
        pageTitle: 'Dashboard',
        headings: { h1: ['Dashboard'], h2: ['Users', 'Orders'], h3: [] },
        tables: [
            { name: 'users-table', headers: ['ID', 'Name', 'Email', 'Status'], rowCount: 10, location: 'main' }
        ],
        buttons: ['Add User', 'Export', 'Refresh', 'Submit', 'Save'],
        inputs: [
            { label: 'Search', type: 'text', placeholder: 'Search...' },
            { label: 'Email', type: 'email' }
        ],
        links: ['Home', 'Users', 'Orders', 'Settings']
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(fs.existsSync).mockReturnValue(true);

        baselineManager = new BaselineManager('./test-output');
        contentComparator = new ContentComparator();
        anomalyDetector = new AnomalyDetector();
        visualComparator = new VisualComparator(0.1, './test-output');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Full Regression Flow: No Changes', () => {
        it('should pass when current page matches baseline exactly', () => {
            // Setup: baseline and current are identical
            const currentContent = { ...mockBaselineContent };

            // Step 1: Compare content
            const contentDiff = contentComparator.compare(mockBaselineContent, currentContent);

            // Step 2: Detect anomalies
            const anomalyReport = anomalyDetector.detect(contentDiff);

            // Assertions
            expect(contentDiff.score).toBe(100);
            expect(contentDiff.pageTitle.match).toBe(true);
            expect(contentDiff.tables.added).toHaveLength(0);
            expect(contentDiff.tables.removed).toHaveLength(0);
            expect(contentDiff.buttons.added).toHaveLength(0);
            expect(contentDiff.buttons.removed).toHaveLength(0);

            expect(anomalyReport.severity).toBe('INFO');
            expect(anomalyReport.score).toBe(0);
            expect(anomalyReport.issues).toHaveLength(0);
        });
    });

    describe('Full Regression Flow: Minor Changes (PASS)', () => {
        it('should pass with minor non-critical changes', () => {
            const currentContent: PageContent = {
                ...mockBaselineContent,
                buttons: ['Add User', 'Export', 'Refresh', 'Submit', 'Save', 'Help'], // Added Help
                links: ['Home', 'Users', 'Orders', 'Settings', 'Documentation'] // Added Documentation
            };

            const contentDiff = contentComparator.compare(mockBaselineContent, currentContent);
            const anomalyReport = anomalyDetector.detect(contentDiff);

            // Minor additions don't cause failure
            expect(contentDiff.score).toBeGreaterThanOrEqual(90);
            expect(contentDiff.buttons.added).toContain('Help');
            expect(anomalyReport.severity).toBe('INFO');
            expect(anomalyReport.score).toBeLessThan(40);
        });
    });

    describe('Full Regression Flow: Critical Changes (FAIL)', () => {
        it('should fail when critical buttons are removed', () => {
            const currentContent: PageContent = {
                ...mockBaselineContent,
                buttons: ['Add User', 'Export', 'Refresh'] // Submit and Save removed!
            };

            const contentDiff = contentComparator.compare(mockBaselineContent, currentContent);
            const anomalyReport = anomalyDetector.detect(contentDiff);

            expect(contentDiff.buttons.removed).toContain('Submit');
            expect(contentDiff.buttons.removed).toContain('Save');
            expect(anomalyReport.severity).toBe('WARNING');
            expect(anomalyReport.score).toBeGreaterThanOrEqual(60); // 30 * 2
            expect(anomalyReport.issues.some(i => i.type === 'CRITICAL_BUTTON_REMOVED')).toBe(true);
        });

        it('should fail when required input fields are removed', () => {
            const baselineWithRequired: PageContent = {
                ...mockBaselineContent,
                inputs: [
                    { label: 'Email', type: 'email' },
                    { label: 'Password', type: 'password' }
                ]
            };

            // Simulate ContentComparator marking inputs as required
            const currentContent: PageContent = {
                ...mockBaselineContent,
                inputs: [] // All inputs removed
            };

            const contentDiff = contentComparator.compare(baselineWithRequired, currentContent);

            // Manually add required flag for anomaly detection
            contentDiff.inputs.removed = [
                { label: 'Email', type: 'email', required: true },
                { label: 'Password', type: 'password', required: true }
            ];

            const anomalyReport = anomalyDetector.detect(contentDiff);

            expect(anomalyReport.issues.some(i => i.type === 'REQUIRED_FIELD_MISSING')).toBe(true);
            expect(anomalyReport.score).toBeGreaterThanOrEqual(50); // 25 * 2
        });

        it('should fail when table is deleted', () => {
            const currentContent: PageContent = {
                ...mockBaselineContent,
                tables: [] // Table removed!
            };

            const contentDiff = contentComparator.compare(mockBaselineContent, currentContent);
            const anomalyReport = anomalyDetector.detect(contentDiff);

            expect(contentDiff.tables.removed).toHaveLength(1);
            expect(contentDiff.tables.removed[0].name).toBe('users-table');
            expect(anomalyReport.issues.some(i => i.type === 'TABLE_DELETED')).toBe(true);
            expect(anomalyReport.score).toBeGreaterThanOrEqual(15);
        });
    });

    describe('Full Regression Flow: Table Structure Changes', () => {
        it('should detect column removal in tables', () => {
            const currentContent: PageContent = {
                ...mockBaselineContent,
                tables: [
                    { name: 'users-table', headers: ['ID', 'Name'], rowCount: 10, location: 'main' } // Email, Status removed
                ]
            };

            const contentDiff = contentComparator.compare(mockBaselineContent, currentContent);
            const anomalyReport = anomalyDetector.detect(contentDiff);

            expect(contentDiff.tables.modified).toHaveLength(1);
            expect(contentDiff.tables.modified[0].headerDiff.removed).toContain('Email');
            expect(contentDiff.tables.modified[0].headerDiff.removed).toContain('Status');
            expect(anomalyReport.issues.some(i => i.type === 'COLUMN_REMOVED')).toBe(true);
        });

        it('should detect row count changes when headers also differ', () => {
            const currentContent: PageContent = {
                ...mockBaselineContent,
                tables: [
                    { name: 'users-table', headers: ['ID', 'Name', 'Email', 'Status', 'Role'], rowCount: 5, location: 'main' } // Header added + row count changed
                ]
            };

            const contentDiff = contentComparator.compare(mockBaselineContent, currentContent);

            // Table is modified when headers change
            expect(contentDiff.tables.modified).toHaveLength(1);
            expect(contentDiff.tables.modified[0].headerDiff.added).toContain('Role');
            expect(contentDiff.tables.modified[0].rowCountChange).toBe(-5); // 5 - 10 = -5
        });
    });

    describe('Visual + Content Combined Flow', () => {
        it('should handle visual pass with content warning', async () => {
            // Setup visual comparison mock
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
                if ((p as string).includes('index.json')) {
                    return JSON.stringify(mockBaselineIndex);
                }
                if ((p as string).includes('content.json')) {
                    return JSON.stringify(mockBaselineContent);
                }
                return Buffer.from([]);
            });

            const mockPNGData = {
                data: Buffer.alloc(100 * 100 * 4),
                width: 100,
                height: 100
            };
            vi.mocked((PNG as any).sync.read).mockReturnValue(mockPNGData);
            vi.mocked((PNG as any).sync.write).mockReturnValue(Buffer.from([]));
            vi.mocked(pixelmatch).mockReturnValue(0); // No visual diff

            // Visual test
            const visualResult = await visualComparator.compare(
                '/path/baseline.png',
                '/path/current.png',
                testUrl
            );

            // Content test with changes
            const currentContent: PageContent = {
                ...mockBaselineContent,
                buttons: ['Add User', 'Export'] // Some buttons removed
            };
            const contentDiff = contentComparator.compare(mockBaselineContent, currentContent);
            const anomalyReport = anomalyDetector.detect(contentDiff);

            // Combined result
            const visualPass = visualResult.status === 'PASS';
            const contentPass = contentDiff.score >= 80;
            const anomalyPass = anomalyReport.severity !== 'CRITICAL';

            expect(visualPass).toBe(true);
            expect(contentPass).toBe(true); // Score might still be above 80
            expect(anomalyReport.severity).not.toBe('INFO'); // Has some issues
        });
    });

    describe('Baseline Management Flow', () => {
        it('should save and retrieve baseline correctly', () => {
            const metadata = {
                timestamp: new Date().toISOString(),
                pageTitle: 'Test Page',
                elementCount: 15,
                hash: 'test-hash'
            };

            vi.mocked(fs.existsSync).mockReturnValue(false);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ domain: testDomain, pages: {} }));

            // Save baseline
            const saved = baselineManager.saveBaseline(
                testUrl,
                '/tmp/screenshot.webp',
                metadata,
                mockBaselineContent
            );

            expect(saved.url).toBe(testUrl);
            expect(saved.domain).toBe(testDomain);
            expect(saved.isGolden).toBe(true);
            expect(fs.copyFileSync).toHaveBeenCalled();
            expect(fs.writeFileSync).toHaveBeenCalled();
        });

        it('should find existing baseline', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockBaselineIndex));

            const baseline = baselineManager.findBaseline(testUrl);

            expect(baseline).not.toBeNull();
            expect(baseline?.url).toBe(testUrl);
            expect(baseline?.isGolden).toBe(true);
        });

        it('should load baseline content', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
                if ((p as string).includes('index.json')) {
                    return JSON.stringify(mockBaselineIndex);
                }
                if ((p as string).includes('content.json')) {
                    return JSON.stringify(mockBaselineContent);
                }
                return '';
            });

            const content = baselineManager.loadBaselineContent(testUrl);

            expect(content).not.toBeNull();
            expect(content.pageTitle).toBe('Dashboard');
            expect(content.tables).toHaveLength(1);
        });
    });

    describe('Edge Cases', () => {
        it('should handle page with no baseline gracefully', () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);

            const baseline = baselineManager.findBaseline('https://example.com/new-page');

            expect(baseline).toBeNull();
        });

        it('should handle empty current page', () => {
            const emptyContent: PageContent = {
                url: testUrl,
                pageTitle: '',
                headings: { h1: [], h2: [], h3: [] },
                tables: [],
                buttons: [],
                inputs: [],
                links: []
            };

            const contentDiff = contentComparator.compare(mockBaselineContent, emptyContent);

            // Add required flags for anomaly detection to trigger CRITICAL
            contentDiff.inputs.removed = [
                { label: 'Email', type: 'email', required: true }
            ];

            const anomalyReport = anomalyDetector.detect(contentDiff);

            // Score reduced due to removed elements
            expect(contentDiff.score).toBeLessThan(80);
            // With critical buttons (Submit, Save) removed, severity should be at least WARNING
            expect(['WARNING', 'CRITICAL']).toContain(anomalyReport.severity);
        });

        it('should cap anomaly score at 100', () => {
            // Create scenario with many critical issues
            const contentDiff = contentComparator.compare(mockBaselineContent, {
                ...mockBaselineContent,
                buttons: [], // All buttons removed including Submit, Save
                inputs: [],
                tables: []
            });

            // Add required flags manually
            contentDiff.inputs.removed = [
                { label: 'Email', type: 'email', required: true },
                { label: 'Password', type: 'password', required: true }
            ];

            const anomalyReport = anomalyDetector.detect(contentDiff);

            expect(anomalyReport.score).toBeLessThanOrEqual(100);
            expect(anomalyReport.severity).toBe('CRITICAL');
        });
    });
});
