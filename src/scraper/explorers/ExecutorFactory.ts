/**
 * Executor Factory
 *
 * Provides standardized CommandExecutor configurations.
 * Eliminates duplicated executor initialization patterns across explorers.
 */

import { CommandExecutor } from '../commands/CommandExecutor.js';
import { BaseExplorationContext } from './types.js';
import { RETRY } from '../config/constants.js';

/**
 * Pre-defined executor configurations
 */
export const ExecutorConfig = {
    /** Standard configuration with default retries */
    STANDARD: {
        maxRetries: RETRY.MAX_RETRIES,
        retryDelayMs: RETRY.RETRY_DELAY
    },
    /** Fast-fail with minimal retries (for UI exploration) */
    FAST_FAIL: {
        maxRetries: 1,
        retryDelayMs: 200
    },
    /** Medium retries for filter/form interactions */
    MEDIUM: {
        maxRetries: 2,
        retryDelayMs: 300
    },
    /** No retries (for quick row clicks) */
    NO_RETRY: {
        maxRetries: 0,
        retryDelayMs: 0
    }
} as const;

export type ExecutorConfigType = keyof typeof ExecutorConfig;

export class ExecutorFactory {
    /**
     * Create a CommandExecutor with standard configuration
     */
    static createStandard(ctx: BaseExplorationContext): CommandExecutor {
        return new CommandExecutor(
            {
                page: ctx.page,
                actionChain: ctx.actionChain,
                networkManager: ctx.networkManager
            },
            ExecutorConfig.STANDARD
        );
    }

    /**
     * Create a CommandExecutor with fast-fail configuration
     * Use for UI exploration where failures are expected
     */
    static createFastFail(ctx: BaseExplorationContext): CommandExecutor {
        return new CommandExecutor(
            {
                page: ctx.page,
                actionChain: ctx.actionChain,
                networkManager: ctx.networkManager
            },
            ExecutorConfig.FAST_FAIL
        );
    }

    /**
     * Create a CommandExecutor with medium retry configuration
     * Use for filter/form interactions
     */
    static createMedium(ctx: BaseExplorationContext): CommandExecutor {
        return new CommandExecutor(
            {
                page: ctx.page,
                actionChain: ctx.actionChain,
                networkManager: ctx.networkManager
            },
            ExecutorConfig.MEDIUM
        );
    }

    /**
     * Create a CommandExecutor with no retries
     * Use for quick batch operations like row clicks
     */
    static createNoRetry(ctx: BaseExplorationContext): CommandExecutor {
        return new CommandExecutor(
            {
                page: ctx.page,
                actionChain: ctx.actionChain,
                networkManager: ctx.networkManager
            },
            ExecutorConfig.NO_RETRY
        );
    }

    /**
     * Create a CommandExecutor with custom configuration
     */
    static create(
        ctx: BaseExplorationContext,
        config: ExecutorConfigType | { maxRetries: number; retryDelayMs: number }
    ): CommandExecutor {
        const resolvedConfig = typeof config === 'string'
            ? ExecutorConfig[config]
            : config;

        return new CommandExecutor(
            {
                page: ctx.page,
                actionChain: ctx.actionChain,
                networkManager: ctx.networkManager
            },
            resolvedConfig
        );
    }
}

export default ExecutorFactory;
