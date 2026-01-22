import { Locator } from 'playwright';
import { BrowserElement, Rect, ClickOptions } from '../BrowserElement.js';
import { BrowserLocator } from '../BrowserLocator.js';
import { PlaywrightLocator } from './PlaywrightLocator.js';

export class PlaywrightElement implements BrowserElement {
    constructor(private target: Locator) { }

    async getAttribute(name: string): Promise<string | null> {
        return await this.target.getAttribute(name);
    }

    async innerText(): Promise<string> {
        return await this.target.innerText();
    }

    async boundingBox(): Promise<Rect | null> {
        const box = await this.target.boundingBox();
        if (!box) return null;
        return {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height
        };
    }

    async click(options?: ClickOptions): Promise<void> {
        await this.target.click(options);
    }

    async fill(value: string): Promise<void> {
        await this.target.fill(value);
    }

    async check(): Promise<void> {
        await this.target.check();
    }

    async uncheck(): Promise<void> {
        await this.target.uncheck();
    }

    async isChecked(): Promise<boolean> {
        return await this.target.isChecked();
    }

    async selectOption(values: string | string[] | { value?: string; label?: string; index?: number }): Promise<string[]> {
        return await this.target.selectOption(values);
    }

    async evaluate<R>(fn: (el: Element, arg?: unknown) => R, arg?: unknown): Promise<R> {
        return await this.target.evaluate(fn, arg);
    }

    async isVisible(options?: { timeout?: number }): Promise<boolean> {
        return await this.target.isVisible(options);
    }

    async isEnabled(options?: { timeout?: number }): Promise<boolean> {
        return await this.target.isEnabled(options);
    }

    locator(selector: string): BrowserLocator {
        return new PlaywrightLocator(this.target.locator(selector));
    }

    async screenshot(options?: { type?: 'png' | 'jpeg' }): Promise<Buffer> {
        return await this.target.screenshot(options);
    }
}
