import { BrowserElement } from './BrowserElement.js';
import { BrowserLocator } from './BrowserLocator.js';

export interface NavigationOptions {
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
    timeout?: number;
}

export interface WaitOptions {
    timeout?: number;
    state?: 'attached' | 'detached' | 'visible' | 'hidden';
}

export interface ScreenshotOptions {
    fullPage?: boolean;
    type?: 'png' | 'jpeg';
    quality?: number;
    path?: string;
}

export interface BrowserPage {
    locator(selector: string): BrowserLocator;
    url(): string;
    title(): Promise<string>;
    goto(url: string, options?: NavigationOptions): Promise<void>;
    goBack(options?: NavigationOptions): Promise<void>;
    evaluate<T, R>(fn: ((arg: T) => R) | string, arg?: T): Promise<R>;
    screenshot(options?: ScreenshotOptions): Promise<Buffer>;
    waitForSelector(selector: string, options?: WaitOptions): Promise<BrowserElement | null>;
    waitForFunction(fn: string | ((arg: unknown) => boolean | Promise<boolean>), options?: { timeout?: number, arg?: unknown }): Promise<void>;
    waitForLoadState(state: 'load' | 'domcontentloaded' | 'networkidle', options?: { timeout?: number }): Promise<void>;
    addInitScript(fn: ((arg: unknown) => void) | string, arg?: unknown): Promise<void>;
    waitForLoadState(state?: 'load' | 'domcontentloaded' | 'networkidle', options?: { timeout?: number }): Promise<void>;
    waitForTimeout(timeout: number): Promise<void>;
    keyboardPress(key: string, options?: { delay?: number }): Promise<void>;
    keyboardType(text: string, options?: { delay?: number }): Promise<void>;
    isVisible(selector: string): Promise<boolean>;
    mouse: {
        click(x: number, y: number, options?: { delay?: number; button?: 'left' | 'right' | 'middle'; clickCount?: number }): Promise<void>;
    };
}
