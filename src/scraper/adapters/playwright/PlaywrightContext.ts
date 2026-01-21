import { BrowserContext as PWContext } from 'playwright';
import { BrowserContext } from '../BrowserContext.js';
import { BrowserPage } from '../BrowserPage.js';
import { PlaywrightPage } from './PlaywrightPage.js';

export class PlaywrightContext implements BrowserContext {
    constructor(private context: PWContext) { }

    async route(pattern: string | RegExp, handler: (route: any) => Promise<void>): Promise<void> {
        await this.context.route(pattern, handler);
    }

    on(event: 'request' | 'response', handler: (data: any) => Promise<void>): void {
        this.context.on(event as any, handler);
    }

    async newPage(): Promise<BrowserPage> {
        const page = await this.context.newPage();
        return new PlaywrightPage(page);
    }

    async close(): Promise<void> {
        await this.context.close();
    }
}
