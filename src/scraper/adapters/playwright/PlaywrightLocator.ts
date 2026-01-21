import { Locator } from 'playwright';
import { BrowserLocator } from '../BrowserLocator.js';
import { BrowserElement } from '../BrowserElement.js';
import { PlaywrightElement } from './PlaywrightElement.js';

export class PlaywrightLocator implements BrowserLocator {
    constructor(private playwrightLocator: Locator) { }

    async all(): Promise<BrowserElement[]> {
        const elements = await (this.playwrightLocator as any).all();
        return elements.map((e: any) => new PlaywrightElement(e));
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
        return new PlaywrightLocator((this.playwrightLocator as any).locator(selector));
    }

    async isVisible(): Promise<boolean> {
        return await this.playwrightLocator.isVisible();
    }

    async isEnabled(): Promise<boolean> {
        return await this.playwrightLocator.isEnabled();
    }

    async innerText(): Promise<string> {
        return await this.playwrightLocator.innerText();
    }

    async getAttribute(name: string): Promise<string | null> {
        return await this.playwrightLocator.getAttribute(name);
    }

    async click(): Promise<void> {
        await (this.playwrightLocator as any).click();
    }

    async fill(value: string): Promise<void> {
        await (this.playwrightLocator as any).fill(value);
    }
}
