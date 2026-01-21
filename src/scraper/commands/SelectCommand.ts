import { Command, CommandContext, CommandTarget, CommandOptions } from './Command.js';
import { BrowserPage } from '../adapters/BrowserPage.js';
import { ActionRecord } from '../../../types/index.js';

/**
 * Options specific to SelectCommand.
 */
export interface SelectOptions extends CommandOptions {
    /** Value to select (option value attribute) */
    value?: string;
    /** Index to select (0-based) */
    index?: number;
    /** Label text to select */
    labelText?: string;
}

/**
 * SelectCommand encapsulates a select action on a dropdown/select element.
 * Supports selection by value, index, or label text.
 */
export class SelectCommand implements Command {
    readonly type = 'select';
    readonly label: string;

    private selector: string;
    private executedUrl: string = '';
    private selectValue: string | undefined;
    private selectIndex: number | undefined;
    private selectLabel: string | undefined;

    constructor(
        private target: CommandTarget,
        private options: SelectOptions = {}
    ) {
        this.label = options.label || 'select';
        this.selector = options.selector || 'unknown';
        this.selectValue = options.value;
        this.selectIndex = options.index;
        this.selectLabel = options.labelText;
    }

    /**
     * Execute the select action.
     */
    async execute(ctx: CommandContext): Promise<void> {
        const { page, actionChain, networkManager } = ctx;

        // Extract label if not provided
        if (this.label === 'select') {
            try {
                const ariaLabel = await this.target.getAttribute('aria-label');
                const name = await this.target.getAttribute('name');
                const id = await this.target.getAttribute('id');
                (this as { label: string }).label = ariaLabel || name || id || 'select';
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
            const displayValue = this.selectValue || this.selectLabel || `index:${this.selectIndex}`;
            networkManager.setCurrentAction(`Select: ${this.label} = ${displayValue}`);
        }

        // Add to action chain
        actionChain.push(this.toRecord(this.executedUrl));

        // Execute select action
        try {
            if (this.selectValue !== undefined) {
                await this.target.selectOption({ value: this.selectValue });
            } else if (this.selectIndex !== undefined) {
                await this.target.selectOption({ index: this.selectIndex });
            } else if (this.selectLabel !== undefined) {
                await this.target.selectOption({ label: this.selectLabel });
            } else {
                // Default: select first non-empty option
                await this.target.selectOption({ index: 1 });
            }
        } catch {
            // Fallback: click to open and select via keyboard
            await this.fallbackSelect(page);
        }
    }

    /**
     * Fallback select strategy using keyboard navigation.
     */
    private async fallbackSelect(page: BrowserPage): Promise<void> {
        try {
            await this.target.click();
            await page.waitForTimeout(200);

            if (this.selectIndex !== undefined) {
                for (let i = 0; i <= this.selectIndex; i++) {
                    await page.keyboardPress('ArrowDown');
                }
            } else {
                await page.keyboardPress('ArrowDown');
            }
            await page.keyboardPress('Enter');
        } catch {
            /* ignore */
        }
    }

    /**
     * Convert to ActionRecord for Golden Path tracking.
     */
    toRecord(url: string): ActionRecord {
        const value = this.selectValue || this.selectLabel ||
            (this.selectIndex !== undefined ? `index:${this.selectIndex}` : 'default');
        return {
            type: 'select',
            selector: this.selector,
            label: this.label.substring(0, 30),
            value: value.substring(0, 50),
            timestamp: new Date().toISOString(),
            url
        };
    }
}
