import * as fs from 'fs';
import * as path from 'path';

export interface RLState {
    url: string;
    action: string;
    timestamp: string;
    reliabilityScore: number;
    contaminationReasons: string[];
    screenshotHash?: string;
}

/**
 * RLStateManager: Tracks the history of agent interactions and their outcomes (states).
 * Serves as the memory bank for future reinforcement learning optimization.
 */
export class RLStateManager {
    private history: RLState[] = [];
    private historyFile: string;

    constructor(outputDir: string) {
        this.historyFile = path.join(outputDir, 'rl_history.json');
        this.loadHistory();
    }

    private loadHistory() {
        if (fs.existsSync(this.historyFile)) {
            try {
                this.history = JSON.parse(fs.readFileSync(this.historyFile, 'utf-8'));
            } catch {
            /* Ignored */  this.history = [];
            }
        }
    }

    private saveHistory() {
        try {
            if (!fs.existsSync(path.dirname(this.historyFile))) {
                fs.mkdirSync(path.dirname(this.historyFile), { recursive: true });
            }
            fs.writeFileSync(this.historyFile, JSON.stringify(this.history, null, 2));
        } catch (e) {
            console.error('[RL State] Failed to save history:', e);
        }
    }

    /**
     * Records a new state-action-reward tuple (implicitly, where score is part of reward)
     */
    public recordState(state: RLState) {
        this.history.push(state);
        // Keep history size manageable (e.g. last 1000 steps)
        if (this.history.length > 2000) {
            this.history = this.history.slice(-1000);
        }
        this.saveHistory();
    }

    public getRecentHistory(limit: number = 10): RLState[] {
        return this.history.slice(-limit);
    }

    /**
     * Returns statistics for finding 'Golden Paths'
     */
    public getHighScoringPaths(threshold: number = 0.95): RLState[] {
        return this.history.filter(s => s.reliabilityScore >= threshold);
    }
}
