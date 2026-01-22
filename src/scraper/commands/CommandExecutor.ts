import { Command, CommandContext } from './Command.js';

/**
 * Options for CommandExecutor.
 */
export interface ExecutorOptions {
    /** Maximum retry attempts (default: 3) */
    maxRetries?: number;

    /** Delay between retries in ms (default: 500) */
    retryDelayMs?: number;

    /** Enable verbose logging (default: false) */
    verbose?: boolean;
}

/**
 * CommandExecutor centralizes command execution with retry logic.
 * Provides consistent error handling and logging across all commands.
 */
export class CommandExecutor {
    private maxRetries: number;
    private retryDelayMs: number;
    private verbose: boolean;

    constructor(
        private ctx: CommandContext,
        options: ExecutorOptions = {}
    ) {
        this.maxRetries = options.maxRetries ?? 3;
        this.retryDelayMs = options.retryDelayMs ?? 500;
        this.verbose = options.verbose ?? false;
    }

    /**
     * Execute a command with automatic retry logic.
     * @param command - The command to execute
     * @throws Error if all retry attempts fail
     */
    async execute(command: Command): Promise<void> {
        let lastError: Error | null = null;
        const totalAttempts = this.maxRetries + 1;

        for (let attempt = 1; attempt <= totalAttempts; attempt++) {
            try {
                if (this.verbose) {
                    console.log(`[Executor] Executing ${command.type}: "${command.label}" (attempt ${attempt}/${totalAttempts})`);
                }

                await command.execute(this.ctx);

                // Run validation if available
                if (command.validate) {
                    const isValid = await command.validate(this.ctx);
                    if (!isValid) {
                        throw new Error(`Execution completed but validation failed for ${command.type}`);
                    }
                }

                if (this.verbose) {
                    console.log(`[Executor] ✓ ${command.type}: "${command.label}" succeeded`);
                }

                return;
            } catch (e) {
                lastError = e as Error;

                if (attempt < totalAttempts) {
                    console.warn(`[Executor] ⚠️ Retry ${attempt}/${this.maxRetries} for ${command.type}: "${command.label}"`);
                    await this.ctx.page.waitForTimeout(this.retryDelayMs);
                }
            }
        }

        console.error(`[Executor] ❌ Failed after ${totalAttempts} attempt(s): ${command.type}: "${command.label}"`);
        throw lastError;
    }

    /**
     * Execute multiple commands sequentially.
     * @param commands - Array of commands to execute
     */
    async executeAll(commands: Command[]): Promise<void> {
        for (const command of commands) {
            await this.execute(command);
        }
    }

    /**
     * Execute a command without retry (single attempt).
     * @param command - The command to execute
     */
    async executeOnce(command: Command): Promise<void> {
        await command.execute(this.ctx);
    }
}
