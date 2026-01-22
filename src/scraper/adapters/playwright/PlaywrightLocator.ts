import { Locator } from 'playwright';
import { BrowserLocator } from '../BrowserLocator.js';
import { BrowserElement } from '../BrowserElement.js';
import { PlaywrightElement } from './PlaywrightElement.js';

export class PlaywrightLocator implements BrowserLocator {
    constructor(private playwrightLocator: Locator) { }

    async all(): Promise<BrowserElement[]> {
        const elements = await this.playwrightLocator.all();
        return elements.map((e: Locator) => new PlaywrightElement(e));
    }

    async count(): Promise<number> {
        return await this.playwrightLocator.count();
    }

    first(): BrowserLocator {
        return new PlaywrightLocator(this.playwrightLocator.first());
    }

    nth(index: number): BrowserLocator {
        return new PlaywrightLocator(this.playwrightLocator.nth(index));
    }

    locator(selector: string): BrowserLocator {
        return new PlaywrightLocator(this.playwrightLocator.locator(selector));
    }

    async isVisible(options?: { timeout?: number }): Promise<boolean> {
        return await this.playwrightLocator.isVisible(options);
    }

    async isEnabled(options?: { timeout?: number }): Promise<boolean> {
        return await this.playwrightLocator.isEnabled(options);
    }

    async innerText(): Promise<string> {
        return await this.playwrightLocator.innerText();
    }

    async getAttribute(name: string): Promise<string | null> {
        return await this.playwrightLocator.getAttribute(name);
    }

    async click(): Promise<void> {
        await this.playwrightLocator.click();
    }

    async fill(value: string): Promise<void> {
        await this.playwrightLocator.fill(value);
    }
}
