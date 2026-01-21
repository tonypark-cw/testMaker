/**
 * FileSystemWatcher
 * Hybrid file system watcher with Native (Win/Mac) or Polling (Linux) strategy
 */

import * as fs from 'fs';
import * as path from 'path';
import { getFileHash, getWebUrlForScreenshot } from './helpers.js';

export class FileSystemWatcher {
    private cache = new Map<string, any>();
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
        console.time('[Watcher] Initial Scan');
        this.scanAll();
        console.timeEnd('[Watcher] Initial Scan');
        console.log(`[Watcher] Indexed ${this.cache.size} files.`);
    }

    private scanAll() {
        const traverse = (currentDir: string) => {
            try {
                const items = fs.readdirSync(currentDir);
                items.forEach(item => {
                    const fullPath = path.join(currentDir, item);
                    try {
                        const stat = fs.statSync(fullPath);
                        if (stat.isDirectory()) {
                            traverse(fullPath);
                        } else if (item.endsWith('.webp') || item.endsWith('.png')) {
                            this.updateCache(fullPath, stat);
                        }
                    } catch {
                        /* ignored */
                    }
                });
            } catch {
                /* ignored */
            }
        };
        traverse(this.watchedDir);
    }

    private startStrategy() {
        const platform = process.platform;
        const isNativeRecursiveSupported = platform === 'win32' || platform === 'darwin';

        if (isNativeRecursiveSupported) {
            this.tryNativeWatch();
        } else {
            console.log(`[Watcher] Platform '${platform}' may not support recursive watch. Defaulting to Polling.`);
            this.startPolling();
        }
    }

    private tryNativeWatch() {
        try {
            console.log('[Watcher] Attempting to start Native Recursive Watcher (High Performance)...');
            this.nativeWatcher = fs.watch(this.watchedDir, { recursive: true }, (eventType, filename) => {
                if (!filename) return;
                if (filename.endsWith('.webp') || filename.endsWith('.png') || filename.endsWith('.json')) {
                    const fullPath = path.join(this.watchedDir, filename);
                    this.handleChange(fullPath);
                }
            });

            this.nativeWatcher.on('error', (e) => {
                console.error('[Watcher] Native watcher error:', e);
                console.log('[Watcher] Falling back to Polling strategy...');
                if (this.nativeWatcher) this.nativeWatcher.close();
                this.startPolling();
            });

            console.log('[Watcher] 🚀 Native Watcher Active (Win/Mac Mode)');
        } catch (e) {
            console.error('[Watcher] Failed to start native watcher:', e);
            this.startPolling();
        }
    }

    private startPolling() {
        console.log('[Watcher] 🐢 Polling Strategy Active (Compatibility Mode - 2s interval)');
        if (this.pollingInterval) clearInterval(this.pollingInterval);

        this.pollingInterval = setInterval(() => {
            this.scanAll();
        }, 2000);
    }

    private handleChange(fullPath: string) {
        try {
            if (fs.existsSync(fullPath)) {
                if (!fullPath.endsWith('.json')) {
                    const stat = fs.statSync(fullPath);
                    this.updateCache(fullPath, stat);
                }
            } else {
                this.removeFromCache(fullPath);
            }
        } catch {
            this.removeFromCache(fullPath);
        }
    }

    private updateCache(fullPath: string, stat: fs.Stats) {
        const relativePath = '/' + path.relative(process.cwd(), fullPath).replace(/\\/g, '/');
        const hash = getFileHash(fullPath, stat.mtimeMs);
        const metadata = getWebUrlForScreenshot(fullPath);

        if (stat.mtimeMs > this.latestChangeTime) {
            this.latestChangeTime = stat.mtimeMs;
        }

        const data = {
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

    public getScreenshots(environment: string): any[] {
        const filterPrefix = `/output/${environment}`;
        const results: any[] = [];

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
