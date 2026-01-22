import { BrowserLocator } from './BrowserLocator.js';

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ClickOptions {
    force?: boolean;
    noWaitAfter?: boolean;
    timeout?: number;
}

export interface BrowserElement {
    getAttribute(name: string): Promise<string | null>;
    innerText(): Promise<string>;
    boundingBox(): Promise<Rect | null>;
    click(options?: ClickOptions): Promise<void>;
    fill(value: string): Promise<void>;
    check(): Promise<void>;
    uncheck(): Promise<void>;
    isChecked(): Promise<boolean>;
    selectOption(values: string | string[] | { value?: string, label?: string, index?: number }): Promise<string[]>;
    evaluate<R>(fn: (el: Element, arg?: unknown) => R, arg?: unknown): Promise<R>;
    isVisible(options?: { timeout?: number }): Promise<boolean>;
    isEnabled(options?: { timeout?: number }): Promise<boolean>;
    locator(selector: string): BrowserLocator;
    screenshot(options?: { type?: 'png' | 'jpeg' }): Promise<Buffer>;
}
