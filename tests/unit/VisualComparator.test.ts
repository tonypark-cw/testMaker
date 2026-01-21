import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';

// Mock dependencies before importing VisualComparator
vi.mock('fs', async () => {
    const actual = await vi.importActual('fs');
    return {
        ...actual,
        existsSync: vi.fn(),
        mkdirSync: vi.fn(),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn(),
        unlinkSync: vi.fn()
    };
});

vi.mock('sharp', () => {
    return {
        default: vi.fn(() => ({
            png: vi.fn().mockReturnThis(),
            toFile: vi.fn().mockResolvedValue(undefined),
            metadata: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
            resize: vi.fn().mockReturnThis()
        }))
    };
});

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

import { VisualComparator } from '../../src/regression/VisualComparator';
import pixelmatch from 'pixelmatch';

describe('VisualComparator', () => {
    let comparator: VisualComparator;

    beforeEach(() => {
        vi.clearAllMocks();

        // Setup default mocks
        vi.mocked(fs.existsSync).mockReturnValue(true);

        // Mock PNG read to return valid image data
        const mockPNGData = {
            data: Buffer.alloc(100 * 100 * 4), // RGBA for 100x100
            width: 100,
            height: 100
        };
        vi.mocked((PNG as any).sync.read).mockReturnValue(mockPNGData as any);
        vi.mocked((PNG as any).sync.write).mockReturnValue(Buffer.from([]));

        comparator = new VisualComparator(0.1, './test-output');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('constructor', () => {
        it('should create output directory if not exists', () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);

            new VisualComparator(0.1, './new-output');

            expect(fs.mkdirSync).toHaveBeenCalledWith(
                expect.stringContaining('diffs'),
                { recursive: true }
            );
        });

        it('should not create directory if exists', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);

            new VisualComparator();

            expect(fs.mkdirSync).not.toHaveBeenCalled();
        });
    });

    describe('compare()', () => {
        it('should return PASS when diff is below threshold', async () => {
            // Mock pixelmatch to return 0 diff pixels
            vi.mocked(pixelmatch).mockReturnValue(0);

            const result = await comparator.compare(
                '/path/to/baseline.png',
                '/path/to/current.png',
                'https://example.com/test'
            );

            expect(result.status).toBe('PASS');
            expect(result.diffPercentage).toBe(0);
            expect(result.diffPixels).toBe(0);
            expect(result.diffImagePath).toBeUndefined();
        });

        it('should return FAIL when diff exceeds 5%', async () => {
            const totalPixels = 100 * 100;
            const diffPixels = Math.floor(totalPixels * 0.1); // 10% diff

            vi.mocked(pixelmatch).mockReturnValue(diffPixels);

            const result = await comparator.compare(
                '/path/to/baseline.png',
                '/path/to/current.png',
                'https://example.com/test'
            );

            expect(result.status).toBe('FAIL');
            expect(result.diffPercentage).toBeCloseTo(10, 1);
        });

        it('should save diff image when differences exist', async () => {
            vi.mocked(pixelmatch).mockReturnValue(100);

            const result = await comparator.compare(
                '/path/to/baseline.png',
                '/path/to/current.png',
                'https://example.com/page'
            );

            expect(fs.writeFileSync).toHaveBeenCalled();
            expect(result.diffImagePath).toBeDefined();
            expect(result.diffImagePath).toContain('page_');
        });

        it('should handle WebP to PNG conversion', async () => {
            vi.mocked(pixelmatch).mockReturnValue(0);

            await comparator.compare(
                '/path/to/baseline.webp',
                '/path/to/current.webp',
                'https://example.com'
            );

            // Should have called sharp for conversion
            const sharp = await import('sharp');
            expect(sharp.default).toHaveBeenCalled();
        });

        it('should calculate correct diff percentage', async () => {
            const totalPixels = 100 * 100;
            const diffPixels = 500; // 5%

            vi.mocked(pixelmatch).mockReturnValue(diffPixels);

            const result = await comparator.compare(
                '/path/to/baseline.png',
                '/path/to/current.png',
                'https://example.com'
            );

            expect(result.totalPixels).toBe(totalPixels);
            expect(result.diffPixels).toBe(diffPixels);
            expect(result.diffPercentage).toBeCloseTo(5, 1);
        });

        it('should use threshold from constructor', async () => {
            const customComparator = new VisualComparator(0.2, './test-output');
            vi.mocked(pixelmatch).mockReturnValue(0);

            await customComparator.compare(
                '/path/to/baseline.png',
                '/path/to/current.png',
                'https://example.com'
            );

            expect(pixelmatch).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything(),
                expect.anything(),
                100,
                100,
                { threshold: 0.2 }
            );
        });

        it('should generate unique filename for diff image', async () => {
            vi.mocked(pixelmatch).mockReturnValue(100);

            const result = await comparator.compare(
                '/path/to/baseline.png',
                '/path/to/current.png',
                'https://example.com/users/profile'
            );

            expect(result.diffImagePath).toContain('users-profile');
        });

        it('should handle index page URL', async () => {
            vi.mocked(pixelmatch).mockReturnValue(100);

            const result = await comparator.compare(
                '/path/to/baseline.png',
                '/path/to/current.png',
                'https://example.com/'
            );

            expect(result.diffImagePath).toContain('index');
        });
    });
});
