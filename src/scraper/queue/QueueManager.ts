import * as fs from 'fs';
import * as path from 'path';
import { ScrapeJob, ScraperConfig, JobPriority } from '../../types/scraper.js';
import { CheckpointManager } from '../lib/CheckpointManager.js';

export class QueueManager {
    private queue: ScrapeJob[] = [];
    private visitedUrls = new Set<string>();
    private normalizedUrlMap = new Map<string, string>();
    private checkpointManager: CheckpointManager;
    private domain: string;
    private basePath: string;

    constructor(
        private config: ScraperConfig,
        private outputDir: string,
        private log: (msg: string) => void
    ) {
        const startUrl = new URL(this.config.url);
        this.domain = startUrl.hostname;
        this.basePath = startUrl.pathname.replace(/\/$/, '');
        this.checkpointManager = new CheckpointManager(this.outputDir);

        if (this.config.resume) {
            this.loadFromCheckpoint();
        }
    }

    private loadFromCheckpoint() {
        const checkpoint = this.checkpointManager.load(this.domain);
        if (checkpoint) {
            this.log(`[QueueManager] Resuming from checkpoint(${checkpoint.timestamp})`);
            this.queue = checkpoint.queue;
            checkpoint.visitedUrls.forEach(url => this.visitedUrls.add(url));
        }
    }

    public getNextJob(): EnhancedScrapeJob | undefined {
        // Sort by priority (descending) then by depth (ascending)
        this.queue.sort((a, b) => {
            const pA = a.priority ?? JobPriority.NORMAL;
            const pB = b.priority ?? JobPriority.NORMAL;
            if (pA !== pB) return pB - pA;
            return a.depth - b.depth;
        });
        return this.queue.shift();
    }

    public addJobs(jobs: EnhancedScrapeJob[]): number {
        let addedCount = 0;
        for (const job of jobs) {
            if (job.depth > (this.config.depth || 10)) continue;
            const normalized = this.normalizeUrl(job.url);

            try {
                const jobUrl = new URL(normalized);
                if (jobUrl.hostname !== this.domain) continue;

                const jobPath = jobUrl.pathname.replace(/\/$/, '');
                if (!jobPath.startsWith(this.basePath)) {
                    continue;
                }
            } catch { continue; }

            const existingIndex = this.queue.findIndex(j => this.normalizeUrl(j.url) === normalized);
            const alreadyVisited = this.visitedUrls.has(normalized);

            if (this.config.force ? true : !alreadyVisited) {
                if (existingIndex > -1) {
                    // Update priority if new one is higher
                    const currentPriority = this.queue[existingIndex].priority ?? JobPriority.NORMAL;
                    const newPriority = job.priority ?? JobPriority.NORMAL;
                    if (newPriority > currentPriority) {
                        this.queue[existingIndex].priority = newPriority;
                    }
                } else {
                    this.queue.push({ 
                        ...job, 
                        url: normalized,
                        priority: job.priority ?? JobPriority.NORMAL 
                    });
                    addedCount++;
                }
            }
        }
        return addedCount;
    }

    public markVisited(url: string) {
        this.visitedUrls.add(this.normalizeUrl(url));
    }

    public isVisited(url: string): boolean {
        if (this.config.force) return false;
        return this.visitedUrls.has(this.normalizeUrl(url));
    }

    public getQueueLength(): number { return this.queue.length; }
    public getVisitedCount(): number { return this.visitedUrls.size; }

    public normalizeUrl(url: string): string {
        try {
            const u = new URL(url);
            let normalized = u.origin + u.pathname;
            if (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
            return normalized;
        } catch { return url; }
    }

    /**
     * Aggressively find all past JSON files to seed the discovery queue.
     */
    public loadHealthyVisitedUrls(): void {
        const rootOutputDir = path.resolve(this.outputDir, '..'); // project/output/
        this.log(`[QueueManager] 🕵️ Scanning ${rootOutputDir} for past results...`);

        let seededCount = 0;
        const findJsonFiles = (dir: string) => {
            if (!fs.existsSync(dir)) return;
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    findJsonFiles(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.json') && !entry.name.includes('checkpoint')) {
                    try {
                        const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
                        if (data.url && data.url.includes(this.domain)) {
                            // Only seed if it matches the current re-entry basePath
                            const jobUrl = new URL(data.url);
                            if (jobUrl.pathname.startsWith(this.basePath)) {
                                this.addJobs([{ url: data.url, depth: 0, actionChain: [] }]);
                                seededCount++;
                            }
                        }
                    } catch (_e) {
                        /* ignore */
                    }
                }
            }
        };

        findJsonFiles(rootOutputDir);
        this.log(`[QueueManager] ✅ Successfully seeded ${seededCount} URLs from past records.`);
    }

    public saveCheckpoint() { this.checkpointManager.save(this.domain, { queue: this.queue, visitedUrls: this.visitedUrls }); }
    public clearCheckpoint() { this.checkpointManager.clear(this.domain); }
}
