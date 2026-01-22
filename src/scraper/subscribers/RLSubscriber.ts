import { ActionRecord } from '../../types/index.js';
import { EventBus } from '../../shared/events/EventBus.js';
import { RLStateManager } from '../rl/RLStateManager.js';

/**
 * RLSubscriber listens to scraper events and updates RL state.
 */
export class RLSubscriber {
    constructor(private rlManager: RLStateManager) {
        const eventBus = EventBus.getInstance();

        eventBus.subscribe('page.captured', this.handlePageCaptured.bind(this));
    }

    private async handlePageCaptured(data: {
        url: string;
        pageTitle: string;
        screenshotPath: string;
        actionChain: ActionRecord[];
        functionalPath: string;
        reliabilityScore: number;
        contaminationReasons: string[];
        screenshotHash: string;
    }) {
        console.log(`[RLSubscriber] 🧠 Recording RL state for: ${data.url}`);
        this.rlManager.recordState({
            url: data.url,
            action: 'initial_capture',
            timestamp: new Date().toISOString(),
            reliabilityScore: data.reliabilityScore,
            contaminationReasons: data.contaminationReasons,
            screenshotHash: data.screenshotHash
        });
    }
}
