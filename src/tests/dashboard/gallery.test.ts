
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

// 1. Setup JSDOM environment
const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
    <div id="gallery"></div>
    <div id="selection-actions"></div>
    <button id="btn-toggle-select"></button>
</body>
</html>`, {
    url: "http://localhost/",
    pretendToBeVisual: true
});

global.window = dom.window as any;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Event = dom.window.Event;
global.MouseEvent = dom.window.MouseEvent;
global.CustomEvent = dom.window.CustomEvent;
global.IntersectionObserver = class IntersectionObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    root = null;
    rootMargin = '';
    thresholds = [];
    takeRecords = vi.fn();
    constructor() { }
} as any;

// Use vi.hoisted to share state mocks
const mocks = vi.hoisted(() => ({
    isSelectionMode: true,
    lastSelectedUrl: null as string | null,
    selectedImages: new Set(),
    tags: {},
    addImageSelection: vi.fn((url) => mocks.selectedImages.add(url)),
    toggleImageSelection: vi.fn((url) => {
        if (mocks.selectedImages.has(url)) mocks.selectedImages.delete(url);
        else mocks.selectedImages.add(url);
    }),
    setLastSelectedUrl: vi.fn((url) => { mocks.lastSelectedUrl = url; }),
    visualScreenshots: [] as any[],
    loading: { classList: { add: vi.fn(), remove: vi.fn() } }
}));

// Mock modules
// Note using correct relative paths based on previous attempts
vi.mock('../../dashboard/assets/js/state.js', () => ({
    get isSelectionMode() { return mocks.isSelectionMode; },
    get lastSelectedUrl() { return mocks.lastSelectedUrl; },
    get selectedImages() { return mocks.selectedImages; },
    get visualScreenshots() { return mocks.visualScreenshots; },
    get tags() { return mocks.tags; },
    addImageSelection: mocks.addImageSelection,
    toggleImageSelection: mocks.toggleImageSelection,
    setLastSelectedUrl: mocks.setLastSelectedUrl,
    loading: mocks.loading
}));

vi.mock('../../dashboard/assets/js/selection.js', () => ({
    updateSelectionUI: vi.fn()
}));

vi.mock('../../dashboard/assets/js/filter.js', () => ({
    getScreenshotType: () => 'PAGE'
}));

// Import subject under test
import * as gallery from '../../dashboard/assets/js/gallery.js';

describe('Gallery Selection Logic', () => {

    beforeEach(() => {
        // Reset state
        mocks.isSelectionMode = true;
        mocks.lastSelectedUrl = null;
        mocks.selectedImages.clear();
        mocks.visualScreenshots.length = 0;
        document.getElementById('gallery')!.innerHTML = '';
        vi.clearAllMocks();
    });

    function createMockCard(id: number) {
        const url = `/path/to/img_${id}.webp`;
        const hash = `hash_${id}`;
        const shot = { url, webUrl: url, hash };

        // Add to visual list just like app does
        mocks.visualScreenshots.push(shot);

        const card = gallery.createCard(shot);
        document.getElementById('gallery')!.appendChild(card);
        return { card, url, hash, key: `${url}#${hash}` };
    }

    it('should set lastSelectedUrl on single click', () => {
        const { card, key } = createMockCard(1);
        const checkbox = card.querySelector('.card-checkbox') as HTMLInputElement;

        // Normal click
        checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(mocks.toggleImageSelection).toHaveBeenCalledWith(key);
        expect(mocks.setLastSelectedUrl).toHaveBeenCalledWith(key);
    });

    it('should select range on Shift+Click', () => {
        // Create 3 cards in DOM order
        const c1 = createMockCard(1);
        const c2 = createMockCard(2);
        const c3 = createMockCard(3);

        // 1. Select first card (Normal click)
        const cb1 = c1.card.querySelector('.card-checkbox') as HTMLInputElement;
        cb1.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: false }));

        // Verify state
        expect(mocks.setLastSelectedUrl).toHaveBeenCalledWith(c1.key);
        expect(mocks.lastSelectedUrl).toBe(c1.key);

        // 2. Shift+Click third card (Gmail-style: always selects range)
        const cb3 = c3.card.querySelector('.card-checkbox') as HTMLInputElement;
        cb3.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));

        // Expect all cards in range to be selected (c1, c2, c3)
        expect(mocks.addImageSelection).toHaveBeenCalledWith(c1.key);
        expect(mocks.addImageSelection).toHaveBeenCalledWith(c2.key);
        expect(mocks.addImageSelection).toHaveBeenCalledWith(c3.key);
        expect((c2.card.querySelector('.card-checkbox') as HTMLInputElement).checked).toBe(true);
    });

    it('should select range in reverse order', () => {
        const c1 = createMockCard(1);
        const c2 = createMockCard(2);
        const c3 = createMockCard(3);

        // 1. Click Last (normal click on c3)
        const cb3 = c3.card.querySelector('.card-checkbox') as HTMLInputElement;
        cb3.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(mocks.lastSelectedUrl).toBe(c3.key);

        // 2. Shift+Click First (reverse direction: c3 -> c1)
        const cb1 = c1.card.querySelector('.card-checkbox') as HTMLInputElement;
        cb1.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));

        // All cards in range should be selected (c1, c2, c3)
        expect(mocks.addImageSelection).toHaveBeenCalledWith(c1.key);
        expect(mocks.addImageSelection).toHaveBeenCalledWith(c2.key);
        expect(mocks.addImageSelection).toHaveBeenCalledWith(c3.key);
        expect((c2.card.querySelector('.card-checkbox') as HTMLInputElement).checked).toBe(true);
    });
});
