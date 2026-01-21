import { ExplorationContext } from './ExplorationContext.js';
import { IExplorationPhase, PhaseResult } from './IExplorationPhase.js';

/**
 * ExplorationOrchestrator manages the execution flow of specialized phases.
 */
export class ExplorationOrchestrator {
    private phases: IExplorationPhase[] = [];

    public addPhase(phase: IExplorationPhase): this {
        this.phases.push(phase);
        return this;
    }

    public async execute(context: ExplorationContext): Promise<PhaseResult> {
        console.log(`[Orchestrator] 🚀 Starting exploration for: ${context.url}`);

        for (const phase of this.phases) {
            console.log(`[Orchestrator] 🛰️ Executing Phase: ${phase.name}`);
            try {
                const result = await phase.execute(context);

                if (!result.success) {
                    console.error(`[Orchestrator] ❌ Phase ${phase.name} failed: ${result.error}`);
                    return result;
                }

                if (result.continue === false) {
                    console.log(`[Orchestrator] 🛑 Phase ${phase.name} requested early termination.`);
                    break;
                }
            } catch (e) {
                const error = e instanceof Error ? e.message : String(e);
                console.error(`[Orchestrator] 💥 Critical error in Phase ${phase.name}: ${error}`);
                return { success: false, error };
            }
        }

        console.log(`[Orchestrator] ✅ Exploration complete for: ${context.url}`);
        return { success: true };
    }
}
