import { Page } from 'playwright';
import { BrowserPage, NavigationOptions, WaitOptions, ScreenshotOptions } from '../BrowserPage.js';
import { BrowserElement } from '../BrowserElement.js';
import { PlaywrightElement } from './PlaywrightElement.js';
import { PlaywrightLocator } from './PlaywrightLocator.js';
import { BrowserLocator } from '../BrowserLocator.js';

export class PlaywrightPage implements BrowserPage {
    constructor(private page: Page) { }

    locator(selector: string): BrowserLocator {
        return new PlaywrightLocator(this.page.locator(selector));
    }

    url(): string {
        return this.page.url();
    }

    async title(): Promise<string> {
        return await this.page.title();
    }

    async goto(url: string, options?: NavigationOptions): Promise<void> {
        await this.page.goto(url, options);
    }

    async evaluate<T, R>(fn: ((arg: T) => R) | string, arg?: T): Promise<R> {
        return await this.page.evaluate(fn as any, arg);
    }

    async screenshot(options?: ScreenshotOptions): Promise<Buffer> {
        return await this.page.screenshot(options);
    }

    async waitForSelector(selector: string, options?: WaitOptions): Promise<BrowserElement | null> {
        const locator = this.page.locator(selector);
        try {
            await locator.waitFor(options);
            return new PlaywrightElement(locator);
        } catch {
            return null;
        }
    }

    async waitForFunction(fn: string | ((...args: any[]) => boolean), options?: { timeout?: number, arg?: any }): Promise<void> {
        await this.page.waitForFunction(fn as any, options?.arg, { timeout: options?.timeout });
    }

    async addInitScript(fn: ((arg: any) => void) | string, arg?: any): Promise<void> {
        await this.page.addInitScript(fn as any, arg);
    }

    async waitForLoadState(state?: 'load' | 'domcontentloaded' | 'networkidle', options?: { timeout?: number }): Promise<void> {
        await this.page.waitForLoadState(state, options);
    }

    async waitForTimeout(timeout: number): Promise<void> {
        await this.page.waitForTimeout(timeout);
    }

    async keyboardPress(key: string, options?: { delay?: number }): Promise<void> {
        await this.page.keyboard.press(key as any, options);
    }

    async keyboardType(text: string, options?: { delay?: number }): Promise<void> {
        await this.page.keyboard.type(text, options);
    }

    async isVisible(selector: string): Promise<boolean> {
        return await this.page.isVisible(selector);
    }
}
