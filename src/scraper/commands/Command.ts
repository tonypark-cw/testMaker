import { Page, ElementHandle, Locator } from 'playwright';
import { ActionRecord } from '../../../types/index.js';
import { NetworkManager } from '../../shared/network/NetworkManager.js';

/**
 * Context passed to all Commands during execution.
 */
export interface CommandContext {
    page: Page;
    actionChain: ActionRecord[];
    networkManager?: NetworkManager;
}

/**
 * Command interface for encapsulating browser actions.
 * Enables automatic logging, retry logic, and Recorder/Scraper integration.
 */
export interface Command {
    /** Action type identifier (click, input, navigate, etc.) */
    readonly type: string;

    /** Human-readable label for logging */
    readonly label: string;

    /**
     * Execute the command.
     * @param ctx - Execution context containing page, action chain, and optional network manager
     */
    execute(ctx: CommandContext): Promise<void>;

    /**
     * Convert command to an ActionRecord for Golden Path tracking.
     * @param url - Current page URL at execution time
     */
    toRecord(url: string): ActionRecord;
}

/**
 * Options for Command creation.
 */
export interface CommandOptions {
    label?: string;
    selector?: string;
    retryOnFail?: boolean;
}

/**
 * Target element type (either ElementHandle or Locator).
 */
export type CommandTarget = ElementHandle<Element> | Locator;
