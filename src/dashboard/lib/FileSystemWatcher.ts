/**
 * FileSystemWatcher
 * Hybrid file system watcher with Native (Win/Mac) or Polling (Linux) strategy
 */

import * as fs from 'fs';
import * as path from 'path';
import { getFileHash, getWebUrlForScreenshot, ScreenshotMetadata } from './helpers.js';

interface CachedScreenshot {
    url: string;
    hash: string;
    time: number;
    webUrl: string;
    metadata: ScreenshotMetadata | null;
    confidence: number | null;
    isStable: boolean | null;
    goldenPathReasons: string[];
}

export class FileSystemWatcher {
    private cache = new Map<string, CachedScreenshot>();
    private watchedDir: string;
    private nativeWatcher: fs.FSWatcher | null = null;
    private pollingInterval: ReturnType<typeof setInterval> | null = null;
    private latestChangeTime: number = 0;

    constructor(dir: string) {
        this.watchedDir = dir;
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        console.log(`[Watcher] Initializing file system watcher for: ${dir}`);
        this.initialScan();
        this.startStrategy();
    }

    private initialScan() {
        const scan = (dir: string) => {
            if (!fs.existsSync(dir)) return;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    scan(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.webp')) {
                    const stat = fs.statSync(fullPath);
                    this.updateCache(fullPath, stat);
                }
            }
        };
        scan(this.watchedDir);
        console.log(`[Watcher] Initial scan complete. ${this.cache.size} screenshots indexed.`);
    }

    private startStrategy() {
        try {
            this.nativeWatcher = fs.watch(this.watchedDir, { recursive: true }, (eventType, filename) => {
                if (filename && filename.endsWith('.webp')) {
                    const fullPath = path.join(this.watchedDir, filename);
                    if (fs.existsSync(fullPath)) {
                        const stat = fs.statSync(fullPath);
                        this.updateCache(fullPath, stat);
                    } else {
                        this.removeFromCache(fullPath);
                    }
                }
            });
            console.log('[Watcher] Using native fs.watch (recursive mode)');
        } catch {
            console.warn('[Watcher] Native watch failed, falling back to polling');
            this.pollingInterval = setInterval(() => {
                this.initialScan();
            }, 5000);
        }
    }


    private updateCache(fullPath: string, stat: fs.Stats) {
        const relativePath = '/' + path.relative(process.cwd(), fullPath).replace(/\\/g, '/');
        const hash = getFileHash(fullPath, stat.mtimeMs);
        const metadata = getWebUrlForScreenshot(fullPath);

        if (stat.mtimeMs > this.latestChangeTime) {
            this.latestChangeTime = stat.mtimeMs;
        }

        const data: CachedScreenshot = {
            url: relativePath,
            hash: hash,
            time: stat.mtimeMs,
            webUrl: metadata ? metadata.url : '',
            metadata: metadata,
            confidence: metadata?.goldenPath?.confidence ?? null,
            isStable: metadata?.goldenPath?.isStable ?? null,
            goldenPathReasons: metadata?.goldenPath?.reasons ?? []
        };
        this.cache.set(relativePath, data);
    }

    private removeFromCache(fullPath: string) {
        const relativePath = '/' + path.relative(process.cwd(), fullPath).replace(/\\/g, '/');
        this.cache.delete(relativePath);
    }

    public getScreenshots(environment: string): CachedScreenshot[] {
        const filterPrefix = `/output/${environment}`;
        const results: CachedScreenshot[] = [];

        for (const [key, value] of this.cache.entries()) {
            if (key.startsWith(filterPrefix)) {
                results.push(value);
            }
        }
        return results;
    }

    public getLatestScanTime(): number {
        return this.latestChangeTime;
    }

    public close() {
        if (this.nativeWatcher) {
            this.nativeWatcher.close();
            this.nativeWatcher = null;
        }
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }
}
