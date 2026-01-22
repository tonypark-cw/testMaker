import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('fs', async () => {
    const actual = await vi.importActual('fs');
    return {
        ...actual,
        existsSync: vi.fn(),
        mkdirSync: vi.fn(),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn(),
        copyFileSync: vi.fn()
    };
});

import { BaselineManager } from '../../regression/BaselineManager.js';
import { BaselineData, BaselineIndex } from '../../regression/types.js';

describe('BaselineManager', () => {
    let manager: BaselineManager;

    const mockIndex: BaselineIndex = {
        domain: 'example.com',
        pages: {
            'https://example.com/page1': {
                url: 'https://example.com/page1',
                domain: 'example.com',
                screenshotPath: '/output/baselines/example.com/pages/page1/golden.webp',
                screenshotHash: 'abc123',
                metadata: { timestamp: '2024-01-01', pageTitle: 'Page 1', elementCount: 10 },
                isGolden: true
            },
            'https://example.com/page2': {
                url: 'https://example.com/page2',
                domain: 'example.com',
                screenshotPath: '/output/baselines/example.com/pages/page2/golden.webp',
                screenshotHash: 'def456',
                metadata: { timestamp: '2024-01-02', pageTitle: 'Page 2', elementCount: 20 },
                isGolden: true
            }
        }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(fs.existsSync).mockReturnValue(true);
        manager = new BaselineManager('./test-output');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('constructor', () => {
        it('should create baselines directory if not exists', () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);

            new BaselineManager('./output');

            expect(fs.mkdirSync).toHaveBeenCalledWith(
                expect.stringContaining('baselines'),
                { recursive: true }
            );
        });

        it('should not create directory if already exists', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);

            new BaselineManager('./output');

            expect(fs.mkdirSync).not.toHaveBeenCalled();
        });

        it('should use default output directory when not specified', () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);

            new BaselineManager();

            expect(fs.mkdirSync).toHaveBeenCalledWith(
                expect.stringContaining(path.join('output', 'baselines')),
                { recursive: true }
            );
        });
    });

    describe('findBaseline()', () => {
        it('should return null if domain directory does not exist', () => {
            vi.mocked(fs.existsSync).mockImplementation((p: any) => {
                if (p.includes('example.com')) return false;
                return true;
            });

            const result = manager.findBaseline('https://example.com/page1');

            expect(result).toBeNull();
        });

        it('should return null if index.json does not exist', () => {
            vi.mocked(fs.existsSync).mockImplementation((p: any) => {
                if (p.includes('index.json')) return false;
                return true;
            });

            const result = manager.findBaseline('https://example.com/page1');

            expect(result).toBeNull();
        });

        it('should return baseline data when found', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockIndex));

            const result = manager.findBaseline('https://example.com/page1');

            expect(result).not.toBeNull();
            expect(result?.url).toBe('https://example.com/page1');
            expect(result?.domain).toBe('example.com');
            expect(result?.isGolden).toBe(true);
        });

        it('should return null when URL not in index', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockIndex));

            const result = manager.findBaseline('https://example.com/nonexistent');

            expect(result).toBeNull();
        });

        it('should handle different domains correctly', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockIndex));

            manager.findBaseline('https://other-domain.com/page');

            expect(fs.existsSync).toHaveBeenCalledWith(
                expect.stringContaining('other-domain.com')
            );
        });
    });

    describe('saveBaseline()', () => {
        const mockMetadata = {
            timestamp: '2024-01-15',
            pageTitle: 'Test Page',
            elementCount: 15,
            hash: 'xyz789'
        };

        beforeEach(() => {
            vi.mocked(fs.existsSync).mockReturnValue(false);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ domain: 'example.com', pages: {} }));
        });

        it('should create necessary directories', () => {
            manager.saveBaseline(
                'https://example.com/new-page',
                '/tmp/screenshot.webp',
                mockMetadata
            );

            expect(fs.mkdirSync).toHaveBeenCalledWith(
                expect.stringContaining('pages'),
                { recursive: true }
            );
        });

        it('should copy screenshot to golden path', () => {
            manager.saveBaseline(
                'https://example.com/new-page',
                '/tmp/screenshot.webp',
                mockMetadata
            );

            expect(fs.copyFileSync).toHaveBeenCalledWith(
                '/tmp/screenshot.webp',
                expect.stringContaining('golden.webp')
            );
        });

        it('should save metadata as JSON', () => {
            manager.saveBaseline(
                'https://example.com/new-page',
                '/tmp/screenshot.webp',
                mockMetadata
            );

            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('metadata.json'),
                expect.stringContaining('Test Page')
            );
        });

        it('should save content when provided', () => {
            const content = {
                url: 'https://example.com/new-page',
                pageTitle: 'New Page',
                headings: { h1: [], h2: [], h3: [] },
                tables: [],
                buttons: ['Submit'],
                inputs: [],
                links: []
            };

            manager.saveBaseline(
                'https://example.com/new-page',
                '/tmp/screenshot.webp',
                mockMetadata,
                content
            );

            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('content.json'),
                expect.stringContaining('Submit')
            );
        });

        it('should not save content when not provided', () => {
            manager.saveBaseline(
                'https://example.com/new-page',
                '/tmp/screenshot.webp',
                mockMetadata
            );

            const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls;
            const contentJsonCalls = writeFileCalls.filter(call =>
                (call[0] as string).includes('content.json')
            );

            expect(contentJsonCalls).toHaveLength(0);
        });

        it('should return BaselineData with correct structure', () => {
            const result = manager.saveBaseline(
                'https://example.com/new-page',
                '/tmp/screenshot.webp',
                mockMetadata
            );

            expect(result.url).toBe('https://example.com/new-page');
            expect(result.domain).toBe('example.com');
            expect(result.screenshotPath).toContain('golden.webp');
            expect(result.screenshotHash).toBe('xyz789');
            expect(result.isGolden).toBe(true);
            expect(result.metadata).toEqual(mockMetadata);
        });

        it('should update index.json', () => {
            manager.saveBaseline(
                'https://example.com/new-page',
                '/tmp/screenshot.webp',
                mockMetadata
            );

            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('index.json'),
                expect.any(String)
            );
        });

        it('should handle root URL correctly', () => {
            const result = manager.saveBaseline(
                'https://example.com/',
                '/tmp/screenshot.webp',
                mockMetadata
            );

            expect(result.screenshotPath).toContain('index');
        });

        it('should handle nested URL paths', () => {
            manager.saveBaseline(
                'https://example.com/admin/users/list',
                '/tmp/screenshot.webp',
                mockMetadata
            );

            expect(fs.mkdirSync).toHaveBeenCalledWith(
                expect.stringContaining('admin-users-list'),
                { recursive: true }
            );
        });
    });

    describe('loadBaselineContent()', () => {
        const mockContent = {
            buttons: ['Submit', 'Cancel'],
            inputs: [{ label: 'Email', type: 'email' }]
        };

        it('should return null if baseline not found', () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);

            const result = manager.loadBaselineContent('https://example.com/nonexistent');

            expect(result).toBeNull();
        });

        it('should return null if content.json does not exist', () => {
            vi.mocked(fs.existsSync).mockImplementation((p: any) => {
                if (p.includes('content.json')) return false;
                return true;
            });
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockIndex));

            const result = manager.loadBaselineContent('https://example.com/page1');

            expect(result).toBeNull();
        });

        it('should return parsed content when available', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
                if ((p as string).includes('index.json')) {
                    return JSON.stringify(mockIndex);
                }
                if ((p as string).includes('content.json')) {
                    return JSON.stringify(mockContent);
                }
                return '';
            });

            const result = manager.loadBaselineContent('https://example.com/page1');

            expect(result).not.toBeNull();
            expect(result!.buttons).toContain('Submit');
            expect(result!.inputs).toHaveLength(1);
        });
    });

    describe('listBaselines()', () => {
        it('should return empty array if index does not exist', () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);

            const result = manager.listBaselines('example.com');

            expect(result).toEqual([]);
        });

        it('should return all baselines for domain', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockIndex));

            const result = manager.listBaselines('example.com');

            expect(result).toHaveLength(2);
            expect(result[0].url).toBe('https://example.com/page1');
            expect(result[1].url).toBe('https://example.com/page2');
        });

        it('should return empty array for domain with no baselines', () => {
            const emptyIndex: BaselineIndex = { domain: 'empty.com', pages: {} };
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(emptyIndex));

            const result = manager.listBaselines('empty.com');

            expect(result).toEqual([]);
        });
    });
});
