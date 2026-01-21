/**
 * ScreenshotCache - File watcher based screenshot cache
 *
 * Replaces TTL-based polling with event-driven updates.
 * Install: npm install chokidar
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { FSWatcher } from 'chokidar';

export interface ScreenshotMeta {
    url: string;           // Relative path like /output/screenshots/...
    hash: string;          // MD5 hash for deduplication
    time: number;          // mtime in ms
    webUrl: string;        // Original page URL
    metadata: any;         // Full JSON metadata
    confidence: number | null;
    isStable: boolean | null;
    goldenPathReasons: string[];
}

export class ScreenshotCache {
    private cache: Map<string, ScreenshotMeta> = new Map();
    private watcher: FSWatcher | null = null;
    private screenshotsDir: string;
    private jsonDir: string;
    private isReady = false;
    private readyCallbacks: Array<() => void> = [];

    constructor(outputDir: string) {
        this.screenshotsDir = path.join(outputDir, 'screenshots');
        this.jsonDir = path.join(this.screenshotsDir, 'json');
    }

    /**
     * Initialize the file watcher
     * Call this once at server startup
     */
    async init(): Promise<void> {
        // Dynamic import for chokidar (allows graceful fallback)
        let chokidar: typeof import('chokidar');
        try {
            chokidar = await import('chokidar');
        } catch (e) {
            console.warn('[ScreenshotCache] chokidar not installed. Run: npm install chokidar');
            console.warn('[ScreenshotCache] Falling back to direct scan mode');
            this.isReady = true;
            return;
        }

        // Watch for webp/png files
        const watchPattern = path.join(this.screenshotsDir, '**/*.{webp,png}');

        this.watcher = chokidar.watch(watchPattern, {
            persistent: true,
            ignoreInitial: false, // Process existing files on startup
            awaitWriteFinish: {
                stabilityThreshold: 500,
                pollInterval: 100
            }
        });

        this.watcher
            .on('add', (filePath: string) => this.onFileAdded(filePath))
            .on('change', (filePath: string) => this.onFileChanged(filePath))
            .on('unlink', (filePath: string) => this.onFileRemoved(filePath))
            .on('ready', () => {
                this.isReady = true;
                console.log(`[ScreenshotCache] Ready. Watching ${this.cache.size} screenshots`);
                this.readyCallbacks.forEach(cb => cb());
                this.readyCallbacks = [];
            })
            .on('error', (error: Error) => {
                console.error('[ScreenshotCache] Watcher error:', error);
            });
    }

    /**
     * Wait for initial scan to complete
     */
    waitForReady(): Promise<void> {
        if (this.isReady) return Promise.resolve();
        return new Promise(resolve => this.readyCallbacks.push(resolve));
    }

    /**
     * Get all screenshots (instant, from memory)
     */
    getAll(): ScreenshotMeta[] {
        return Array.from(this.cache.values())
            .sort((a, b) => b.time - a.time); // Most recent first
    }

    /**
     * Get screenshot count
     */
    get size(): number {
        return this.cache.size;
    }

    /**
     * Force refresh a specific file (e.g., after metadata update)
     */
    refresh(filePath: string): void {
        if (this.cache.has(filePath)) {
            this.onFileChanged(filePath);
        }
    }

    /**
     * Cleanup on shutdown
     */
    async close(): Promise<void> {
        if (this.watcher) {
            await this.watcher.close();
            this.watcher = null;
        }
        this.cache.clear();
    }

    // --- Private Methods ---

    private onFileAdded(filePath: string): void {
        try {
            const meta = this.buildMeta(filePath);
            if (meta) {
                this.cache.set(filePath, meta);
            }
        } catch (e) {
            // File might be in the process of being written
        }
    }

    private onFileChanged(filePath: string): void {
        this.onFileAdded(filePath); // Same logic, just update
    }

    private onFileRemoved(filePath: string): void {
        this.cache.delete(filePath);
    }

    private buildMeta(filePath: string): ScreenshotMeta | null {
        if (!fs.existsSync(filePath)) return null;

        const stat = fs.statSync(filePath);
        const relativePath = '/' + path.relative(process.cwd(), filePath);
        const hash = this.getFileHash(filePath, stat.mtimeMs);
        const metadata = this.loadMetadata(filePath);

        return {
            url: relativePath,
            hash,
            time: stat.mtimeMs,
            webUrl: metadata?.url || '',
            metadata,
            confidence: metadata?.goldenPath?.confidence ?? null,
            isStable: metadata?.goldenPath?.isStable ?? null,
            goldenPathReasons: metadata?.goldenPath?.reasons ?? []
        };
    }

    private hashCache = new Map<string, { mtime: number; hash: string }>();

    private getFileHash(filePath: string, mtime: number): string {
        const cached = this.hashCache.get(filePath);
        if (cached && cached.mtime === mtime) {
            return cached.hash;
        }

        const content = fs.readFileSync(filePath);
        const hash = crypto.createHash('md5').update(content).digest('hex');
        this.hashCache.set(filePath, { mtime, hash });
        return hash;
    }

    private loadMetadata(screenshotPath: string): any {
        const filename = path.basename(screenshotPath, path.extname(screenshotPath));
        const domainDir = path.basename(path.dirname(screenshotPath));
        const domainWithDots = domainDir.replace(/-/g, '.');

        const possiblePaths = [
            path.join(this.jsonDir, domainWithDots, `${filename}.json`),
            path.join(this.jsonDir, domainWithDots, `${domainWithDots}-${filename}.json`)
        ];

        for (const jsonPath of possiblePaths) {
            if (fs.existsSync(jsonPath)) {
                try {
                    return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
                } catch (e) {
                    // Invalid JSON, skip
                }
            }
        }

        return null;
    }
}

/**
 * Singleton instance for easy import
 */
let instance: ScreenshotCache | null = null;

export function getScreenshotCache(outputDir?: string): ScreenshotCache {
    if (!instance) {
        if (!outputDir) {
            throw new Error('ScreenshotCache: outputDir required for first initialization');
        }
        instance = new ScreenshotCache(outputDir);
    }
    return instance;
}
