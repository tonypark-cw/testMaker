import * as fs from 'fs';
import * as path from 'path';
import { RunnerCheckpoint, ScrapeJob } from '../../types/scraper.js';

export class CheckpointManager {
    private checkpointDir: string;

    constructor(baseOutputDir: string) {
        this.checkpointDir = path.join(baseOutputDir, 'checkpoints');
        if (!fs.existsSync(this.checkpointDir)) {
            fs.mkdirSync(this.checkpointDir, { recursive: true });
        }
    }

    /**
     * Save current runner state to a checkpoint file.
     */
    public save(domain: string, state: { queue: ScrapeJob[], visitedUrls: Set<string> }): void {
        const checkpointPath = this.getCheckpointPath(domain);
        const checkpoint: RunnerCheckpoint = {
            domain,
            timestamp: new Date().toISOString(),
            queue: state.queue,
            visitedUrls: Array.from(state.visitedUrls)
        };

        fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
    }

    /**
     * Load state from a checkpoint file if it exists.
     */
    public load(domain: string): RunnerCheckpoint | null {
        const checkpointPath = this.getCheckpointPath(domain);
        if (!fs.existsSync(checkpointPath)) {
            return null;
        }

        try {
            const content = fs.readFileSync(checkpointPath, 'utf-8');
            return JSON.parse(content) as RunnerCheckpoint;
        } catch (error) {
            console.error(`[CheckpointManager] Failed to load checkpoint for ${domain}:`, error);
            return null;
        }
    }

    /**
     * Clear checkpoint after successful completion.
     */
    public clear(domain: string): void {
        const checkpointPath = this.getCheckpointPath(domain);
        if (fs.existsSync(checkpointPath)) {
            fs.unlinkSync(checkpointPath);
        }
    }

    private getCheckpointPath(domain: string): string {
        const safeDomain = domain.replace(/[^a-z0-9]/gi, '-').toLowerCase();
        return path.join(this.checkpointDir, `checkpoint-${safeDomain}.json`);
    }
}
