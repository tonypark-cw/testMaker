import { Command, CommandContext, CommandTarget, CommandOptions } from './Command.js';
import { BrowserPage } from '../adapters/BrowserPage.js';
import { ActionRecord } from '../../../types/index.js';

/**
 * Options specific to InputCommand.
 */
export interface InputOptions extends CommandOptions {
    /** The value to input */
    value: string;
    /** Whether to clear existing content before typing (default: true) */
    clearFirst?: boolean;
    /** Whether this is a sensitive field like password (masks value in logs) */
    sensitive?: boolean;
}

/**
 * InputCommand encapsulates a fill/type action on an input element.
 * Provides automatic logging and value masking for sensitive fields.
 */
export class InputCommand implements Command {
    readonly type = 'input';
    readonly label: string;

    private selector: string;
    private executedUrl: string = '';
    private value: string;
    private clearFirst: boolean;
    private sensitive: boolean;

    constructor(
        private target: CommandTarget,
        private options: InputOptions
    ) {
        this.label = options.label || 'input';
        this.selector = options.selector || 'unknown';
        this.value = options.value;
        this.clearFirst = options.clearFirst ?? true;
        this.sensitive = options.sensitive ?? false;
    }

    /**
     * Execute the input action.
     * Clears existing content and fills with new value.
     */
    async execute(ctx: CommandContext): Promise<void> {
        const { page, actionChain, networkManager } = ctx;

        // Extract label if not provided
        if (this.label === 'input') {
            try {
                const placeholder = await this.target.getAttribute('placeholder');
                const ariaLabel = await this.target.getAttribute('aria-label');
                const name = await this.target.getAttribute('name');
                (this as { label: string }).label = placeholder || ariaLabel || name || 'input';
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

        // Detect if sensitive field
        if (!this.sensitive) {
            try {
                const type = await this.target.getAttribute('type');
                const name = await this.target.getAttribute('name');
                const label = this.label.toLowerCase();
                this.sensitive = type === 'password' ||
                    name?.toLowerCase().includes('password') ||
                    label.includes('password');
            } catch {
                /* ignore */
            }
        }

        // Store URL for record
        this.executedUrl = page.url();

        // Set current action for Network correlation
        if (networkManager && typeof networkManager.setCurrentAction === 'function') {
            const displayValue = this.sensitive ? '***' : this.value.substring(0, 20);
            networkManager.setCurrentAction(`Input: ${this.label} = ${displayValue}`);
        }

        // Add to action chain
        actionChain.push(this.toRecord(this.executedUrl));

        // Execute fill action
        // Note: fill() automatically clears existing content
        try {
            await this.target.fill(this.value);
        } catch {
            // Fallback: use type() for elements that don't support fill()
            await this.fallbackType(page);
        }
    }

    /**
     * Fallback strategy using keyboard typing.
     */
    private async fallbackType(page: BrowserPage): Promise<void> {
        try {
            await this.target.click();
            if (this.clearFirst) {
                await page.keyboardPress('Control+A');
                await page.keyboardPress('Backspace');
            }
            await page.keyboardType(this.value, { delay: 10 });
        } catch {
            // Last resort: evaluate
            await this.target.evaluate((el: HTMLInputElement, val: string) => {
                el.value = val;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }, this.value);
        }
    }

    /**
     * Validate that the value was correctly set.
     */
    async validate(_ctx: CommandContext): Promise<boolean> {
        try {
            const currentValue = await this.target.evaluate((el: HTMLInputElement) => el.value);
            return currentValue === this.value;
        } catch {
            return false;
        }
    }

    /**
     * Convert to ActionRecord for Golden Path tracking.
     * Masks sensitive values.
     */
    toRecord(url: string): ActionRecord {
        return {
            type: 'input',
            selector: this.selector,
            label: this.label.substring(0, 30),
            value: this.sensitive ? '***' : this.value.substring(0, 50),
            timestamp: new Date().toISOString(),
            url
        };
    }
}
