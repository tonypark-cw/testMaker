import { ExplorationContext } from './ExplorationContext.js';

export interface PhaseResult {
    success: boolean;
    error?: string;
    continue?: boolean;
}

/**
 * Interface for all exploration phases (Strategy Pattern).
 */
export interface IExplorationPhase {
    readonly name: string;
    execute(context: ExplorationContext): Promise<PhaseResult>;
}
