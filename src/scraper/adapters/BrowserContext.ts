import { BrowserPage } from './BrowserPage.js';

export interface BrowserContext {
    route(pattern: string | RegExp, handler: (route: unknown) => Promise<void>): Promise<void>;
    on(event: 'request' | 'response', handler: (data: unknown) => Promise<void>): void;
    newPage(): Promise<BrowserPage>;
    close(): Promise<void>;
}
