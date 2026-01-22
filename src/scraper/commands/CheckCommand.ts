import { Command, CommandContext, CommandTarget, CommandOptions } from './Command.js';
import { ActionRecord } from '../../types/index.js';

/**
 * Options specific to CheckCommand.
 */
export interface CheckOptions extends CommandOptions {
    /** Whether to check or uncheck (default: true = check) */
    check?: boolean;
}

/**
 * CheckCommand encapsulates a check/uncheck action on a checkbox or toggle element.
 */
export class CheckCommand implements Command {
    readonly type = 'check';
    readonly label: string;

    private selector: string;
    private executedUrl: string = '';
    private shouldCheck: boolean;

    constructor(
        private target: CommandTarget,
        private options: CheckOptions = {}
    ) {
        this.label = options.label || 'checkbox';
        this.selector = options.selector || 'unknown';
        this.shouldCheck = options.check ?? true;
    }

    /**
     * Execute the check/uncheck action.
     */
    async execute(ctx: CommandContext): Promise<void> {
        const { page, actionChain, networkManager } = ctx;

        // Extract label if not provided
        if (this.label === 'checkbox') {
            try {
                const ariaLabel = await this.target.getAttribute('aria-label');
                const name = await this.target.getAttribute('name');
                const id = await this.target.getAttribute('id');
                // Try to find associated label element
                (this as { label: string }).label = ariaLabel || name || id || 'checkbox';
            } catch {
                /* ignore */
            }
        }

        // Extract selector if not provided
        if (this.selector === 'unknown') {
            try {
                const id = await this.target.getAttribute('id');
                const name = await this.target.getAttribute('name');
                const cls = await this.target.getAttribute('class');
                this.selector = id ? `#${id}` : name ? `[name="${name}"]` : cls || 'unknown';
            } catch {
                /* ignore */
            }
        }

        // Store URL for record
        this.executedUrl = page.url();

        // Set current action for Network correlation
        if (networkManager && typeof networkManager.setCurrentAction === 'function') {
            const action = this.shouldCheck ? 'Check' : 'Uncheck';
            networkManager.setCurrentAction(`${action}: ${this.label}`);
        }

        // Add to action chain
        actionChain.push(this.toRecord(this.executedUrl));

        // Execute check/uncheck action
        try {
            if (this.shouldCheck) {
                await this.target.check();
            } else {
                await this.target.uncheck();
            }
        } catch {
            // Fallback: use click toggle
            await this.fallbackToggle();
        }
    }

    /**
     * Fallback toggle strategy using click.
     */
    private async fallbackToggle(): Promise<void> {
        try {
            // Check current state and click if needed
            const isChecked = await this.target.isChecked();

            if ((this.shouldCheck && !isChecked) || (!this.shouldCheck && isChecked)) {
                await this.target.click({ force: true });
            }
        } catch {
            // Last resort: just click
            await this.target.click({ force: true }).catch(() => {
                /* ignore */
            });
        }
    }

    /**
     * Convert to ActionRecord for Golden Path tracking.
     */
    toRecord(url: string): ActionRecord {
        return {
            type: 'check',
            selector: this.selector,
            label: this.label.substring(0, 30),
            value: this.shouldCheck ? 'checked' : 'unchecked',
            timestamp: new Date().toISOString(),
            url
        };
    }
}
