import * as fs from 'fs';
import * as path from 'path';
import { ScrapeJob, ScraperConfig } from '../../types/scraper.js';
import { CheckpointManager } from '../lib/CheckpointManager.js';

export class QueueManager {
    private queue: ScrapeJob[] = [];
    private visitedUrls = new Set<string>();
    private normalizedUrlMap = new Map<string, string>();
    private checkpointManager: CheckpointManager;
    private domain: string;

    constructor(
        private config: ScraperConfig,
        private outputDir: string,
        private log: (msg: string) => void
    ) {
        this.domain = new URL(this.config.url).hostname;
        this.checkpointManager = new CheckpointManager(this.outputDir);

        if (this.config.resume) {
            this.loadFromCheckpoint();
        }
        // [TEST-FIX] Don't auto-add start URL here - let Runner control queue initialization
    }

    private loadFromCheckpoint() {
        const checkpoint = this.checkpointManager.load(this.domain);
        if (checkpoint) {
            this.log(`[QueueManager] Resuming from checkpoint(${checkpoint.timestamp})`);
            this.queue = checkpoint.queue;
            checkpoint.visitedUrls.forEach(url => this.visitedUrls.add(url));
            this.log(`[QueueManager] Restored ${this.queue.length} jobs and ${this.visitedUrls.size} visited URLs.`);
        } else {
            this.log(`[QueueManager] No checkpoint found for ${this.domain}.Starting fresh with empty queue.`);
        }
    }

    public getNextJob(): ScrapeJob | undefined {
        return this.queue.shift();
    }

    public addJobs(jobs: ScrapeJob[]): number {
        let addedCount = 0;
        for (const job of jobs) {
            if (job.depth > this.config.depth) continue;

            const normalized = this.normalizeUrl(job.url);

            // [CRITICAL FIX] Only explore URLs under the start URL path
            // Example: if start URL is /app/auditlog, only allow /app/auditlog/xxx, not /app/adjustment
            const startUrlPath = new URL(this.config.url).pathname;
            const jobUrlPath = new URL(normalized).pathname;

            if (!jobUrlPath.startsWith(startUrlPath)) {
                this.log(`[QueueMgr] 🚫 Out of scope: ${normalized} (not under ${startUrlPath})`);
                continue;
            }

            const inQueue = this.queue.some(j => this.normalizeUrl(j.url) === normalized);

            if (!this.visitedUrls.has(normalized) && !inQueue) {
                this.queue.push({ ...job, url: normalized });
                addedCount++;
            } else {
                const reason = this.visitedUrls.has(normalized) ? 'already visited' : 'already in queue';
                this.log(`[QueueMgr] ⏭️  Skipped: ${normalized} (${reason})`);
            }
        }
        if (addedCount > 0) {
            this.log(`[QueueMgr] 📊 Queue summary: ${addedCount} added, ${this.queue.length} total queued, ${this.visitedUrls.size} visited`);
        }
        return addedCount;
    }

    public markVisited(url: string) {
        const normalized = this.normalizeUrl(url);
        const wasAlreadyVisited = this.visitedUrls.has(normalized);
        this.visitedUrls.add(normalized);

        if (wasAlreadyVisited) {
            this.log(`[QueueMgr] ⚠️  WARNING: ${normalized} was already marked as visited!`);
        } else {
            this.log(`[QueueMgr] ✅ Marked visited: ${normalized} (total: ${this.visitedUrls.size})`);
        }
    }

    public isVisited(url: string): boolean {
        const normalized = this.normalizeUrl(url);
        const result = this.visitedUrls.has(normalized);
        this.log(`[QueueMgr] 🔍 Check visited: ${normalized} → ${result ? 'YES (skip)' : 'NO (process)'} `);
        return result;
    }

    public getQueueLength(): number {
        return this.queue.length;
    }

    public getVisitedCount(): number {
        return this.visitedUrls.size;
    }

    public saveCheckpoint() {
        this.checkpointManager.save(this.domain, {
            queue: this.queue,
            visitedUrls: this.visitedUrls
        });
    }

    public clearCheckpoint() {
        this.checkpointManager.clear(this.domain);
    }

    public normalizeUrl(url: string): string {
        const cached = this.normalizedUrlMap.get(url);
        if (cached) return cached;

        try {
            const u = new URL(url);
            // Ignore fragments, normalize trailing slashes
            u.hash = '';
            const normalized: string = u.toString().replace(/\/$/, '');

            // Special case for dashboard IDs - treat /app/inventory/123 same as /app/inventory/456 for discovery purposes?
            // No, for now let's keep it simple.

            this.normalizedUrlMap.set(url, normalized);
            return normalized;
        } catch {
            return url;
        }
    }

    /**
     * Pre-scan existing results for healthy pages to skip.
     */
    public loadHealthyVisitedUrls() {
        const initialDomain = this.domain.replace(/\./g, '-');
        const jsonDir = path.join(this.outputDir, '..', 'json', initialDomain);

        if (fs.existsSync(jsonDir)) {
            const files = fs.readdirSync(jsonDir).filter(f => f.endsWith('.json'));
            this.log(`[QueueManager] Pre - scanning ${files.length} past results to identify healthy pages to skip...`);

            for (const file of files) {
                try {
                    const content = JSON.parse(fs.readFileSync(path.join(jsonDir, file), 'utf-8'));
                    const normalizedUrl = this.normalizeUrl(content.url);
                    const isHealthy = (content.metadata?.totalElements || 0) > 10;

                    if (isHealthy) {
                        this.visitedUrls.add(normalizedUrl);
                    } else {
                        this.visitedUrls.delete(normalizedUrl);
                    }
                } catch { /* ignore */ }
            }
        }
    }
}
