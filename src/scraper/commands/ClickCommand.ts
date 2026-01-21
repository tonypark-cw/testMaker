import { Command, CommandContext, CommandTarget, CommandOptions } from './Command.js';
import { BrowserPage } from '../adapters/BrowserPage.js';
import { ActionRecord } from '../../../types/index.js';

/**
 * ClickCommand encapsulates a click action on a target element.
 * Provides automatic logging, coordinate-based clicking, and fallback strategies.
 */
export class ClickCommand implements Command {
    readonly type = 'click';
    readonly label: string;

    private selector: string;
    private executedUrl: string = '';

    constructor(
        private target: CommandTarget,
        private options: ClickCommandOptions = {}
    ) {
        this.label = options.label || 'element';
        this.selector = options.selector || 'unknown';
    }

    /**
     * Execute the click action.
     * Uses coordinate-based clicking to bypass SPA event filtering.
     */
    async execute(ctx: CommandContext): Promise<void> {
        const { page, actionChain, networkManager } = ctx;

        // Extract label if not provided
        if (this.label === 'element') {
            try {
                const text = await this.target.innerText().catch(() => '');
                const trimmedText = text.trim();
                const ariaLabel = await this.target.getAttribute('aria-label');
                (this as { label: string }).label = trimmedText || ariaLabel || 'element';
            } catch {
                /* ignore */
            }
        }

        // Extract selector if not provided
        if (this.selector === 'unknown') {
            try {
                this.selector = (await this.target.getAttribute('class')) || 'unknown';
            } catch {
                /* ignore */
            }
        }

        // Store URL for record
        this.executedUrl = page.url();

        // Set current action for Network correlation
        if (networkManager && typeof networkManager.setCurrentAction === 'function') {
            networkManager.setCurrentAction(`Clicked: ${this.label.substring(0, 50)}`);
        }

        // Add to action chain
        actionChain.push(this.toRecord(this.executedUrl));

        // Execute click with coordinate-based strategy
        try {
            const box = await this.target.boundingBox();
            if (box) {
                const page = ctx.page;
                // Since BrowserPage evaluate doesn't have a direct mouse access in the interface yet 
                // we'll rely on the target.click() which is part of our abstraction.
                // However, our implementation for coordinate click was playwright-specific.
                // For now, BrowserElement.click() will handle this in PlaywrightElement.
                await this.target.click({ force: false });
            } else {
                await this.fallbackClick();
            }
        } catch {
            await this.fallbackClick();
        }
    }

    /**
     * Fallback click strategy using force click or evaluate.
     */
    private async fallbackClick(): Promise<void> {
        try {
            await this.target.click({ force: true });
        } catch {
            await this.target.evaluate((el: HTMLElement) => el.click());
        }
    }

    /**
     * Optional validation of click result.
     */
    async validate(ctx: CommandContext): Promise<boolean> {
        if (this.options.validator) {
            return await this.options.validator(ctx.page);
        }
        return true;
    }

    /**
     * Convert to ActionRecord for Golden Path tracking.
     */
    toRecord(url: string): ActionRecord {
        return {
            type: 'click',
            selector: this.selector,
            label: this.label.substring(0, 30),
            timestamp: new Date().toISOString(),
            url
        };
    }
}

/**
 * Enhanced CommandOptions with Validator support.
 */
export interface ClickCommandOptions extends CommandOptions {
    validator?: (page: BrowserPage) => Promise<boolean>;
}
