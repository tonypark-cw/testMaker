import { ElementHandle, Locator } from 'playwright';
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
        await (this.target as any).check();
    }

    async uncheck(): Promise<void> {
        await (this.target as any).uncheck();
    }

    async isChecked(): Promise<boolean> {
        return await (this.target as any).isChecked();
    }

    async selectOption(values: any): Promise<string[]> {
        return await (this.target as any).selectOption(values);
    }

    async evaluate<T, R>(fn: (el: T, arg: any) => R, arg?: any): Promise<R> {
        return await this.target.evaluate(fn as any, arg);
    }

    async isVisible(): Promise<boolean> {
        return await this.target.isVisible();
    }

    async isEnabled(): Promise<boolean> {
        return await this.target.isEnabled();
    }

    locator(selector: string): BrowserLocator {
        return new PlaywrightLocator((this.target as any).locator(selector));
    }

    async screenshot(options?: { type?: 'png' | 'jpeg' }): Promise<Buffer> {
        return await (this.target as any).screenshot(options);
    }
}
