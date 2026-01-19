import * as fs from 'fs';
import * as path from 'path';
import { ScrapeJob, ScraperConfig, RunnerCheckpoint } from '../types.js';
import { CheckpointManager } from './CheckpointManager.js';

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
        } else {
            this.queue = [{ url: this.config.url, depth: 0, actionChain: [] }];
        }
    }

    private loadFromCheckpoint() {
        const checkpoint = this.checkpointManager.load(this.domain);
        if (checkpoint) {
            this.log(`[QueueManager] Resuming from checkpoint (${checkpoint.timestamp})`);
            this.queue = checkpoint.queue;
            checkpoint.visitedUrls.forEach(url => this.visitedUrls.add(url));
            this.log(`[QueueManager] Restored ${this.queue.length} jobs and ${this.visitedUrls.size} visited URLs.`);
        } else {
            this.log(`[QueueManager] No checkpoint found for ${this.domain}. Starting fresh.`);
            this.queue = [{ url: this.config.url, depth: 0, actionChain: [] }];
        }
    }

    public getNextJob(): ScrapeJob | undefined {
        return this.queue.shift();
    }

    public addJobs(jobs: ScrapeJob[]): number {
        let addedCount = 0;
        for (const job of jobs) {
            const normalized = this.normalizeUrl(job.url);
            // Check if already in queue or visited
            const inQueue = this.queue.some(q => q.url === normalized);
            if (!this.visitedUrls.has(normalized) && !inQueue) {
                this.queue.push({ ...job, url: normalized });
                addedCount++;
            } else {
                // this.log(`[QueueManager] ⏭️ Skipping duplicate/visited: ${normalized}`);
            }
        }
        return addedCount;
    }

    public markVisited(url: string) {
        this.visitedUrls.add(this.normalizeUrl(url));
    }

    public isVisited(url: string): boolean {
        return this.visitedUrls.has(this.normalizeUrl(url));
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
            let normalized = u.toString().replace(/\/$/, '');

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
            this.log(`[QueueManager] Pre-scanning ${files.length} past results to identify healthy pages to skip...`);

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
