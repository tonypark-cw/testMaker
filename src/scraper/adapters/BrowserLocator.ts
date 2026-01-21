import { BrowserElement } from './BrowserElement.js';

export interface BrowserLocator {
    all(): Promise<BrowserElement[]>;
    count(): Promise<number>;
    first(): BrowserLocator;
    nth(index: number): BrowserLocator;
    locator(selector: string): BrowserLocator;
    isVisible(): Promise<boolean>;
    isEnabled(): Promise<boolean>;
    innerText(): Promise<string>;
    getAttribute(name: string): Promise<string | null>;
    click(): Promise<void>;
    fill(value: string): Promise<void>;
}
