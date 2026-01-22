/**
 * EventTracker: Browser-side script injected into the page to track user interactions.
 * It identifies the best selector for each action and communicates back to Node.js.
 */

(function () {
    if (window.__antigravity_recorder) return;
    window.__antigravity_recorder = true;

    console.log('[Antigravity] EventTracker injected and active.');

    function getOptimizedSelector(el: HTMLElement): string {
        // 1. data-testid (Best for testing)
        if (el.getAttribute('data-testid')) {
            return `[data-testid="${el.getAttribute('data-testid')}"]`;
        }

        // 2. ARIA labels or roles
        if (el.getAttribute('aria-label')) {
            return `[aria-label="${el.getAttribute('aria-label')}"]`;
        }

        // 3. Mantine specific attributes (common in ianaiERP)
        const mantineClasses = Array.from(el.classList).filter(c => c.startsWith('mantine-'));
        if (mantineClasses.length > 0) {
            // Use semantic part of mantine class if possible
            const semanticClass = mantineClasses.find(c => !c.includes('-root') && !/^[a-z0-9]{8}$/.test(c.split('-').pop() || ''));
            if (semanticClass) return `.${semanticClass}`;
        }

        // 4. ID (if stable looking)
        const id = el.id;
        if (id && !/^[0-9a-f-]{8,}/.test(id)) {
            return `#${id}`;
        }

        // 5. Name attribute (for inputs)
        if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
            if (el.name) return `[name="${el.name}"]`;
        }

        // 6. Text content (for buttons and links)
        if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'tab') {
            const text = el.innerText.trim();
            if (text && text.length < 50) {
                return `${el.tagName.toLowerCase()}:has-text("${text}")`;
            }
        }

        // 7. Fallback: Tag + simple class
        const tagName = el.tagName.toLowerCase();
        const classes = Array.from(el.classList).filter(c => !c.match(/[0-9a-z]{8}/)).join('.');
        return classes ? `${tagName}.${classes}` : tagName;
    }

    function recordEvent(type: string, event: Event) {
        const target = event.target as HTMLElement;
        if (!target) return;

        const selector = getOptimizedSelector(target);

        // Matches RecordedAction interface
        const data: {
            type: string;
            selector: string;
            tagName: string;
            innerText?: string;
            timestamp: number;
            location: string;
            value?: string;
        } = {
            type,
            selector,
            tagName: target.tagName,
            innerText: target.innerText?.substring(0, 50),
            timestamp: Date.now(),
            location: window.location.href
        };

        if (type === 'input' || type === 'change') {
            data.value = (target as HTMLInputElement).value;
        }

        // Send to Node.js via Playwright's exposeBinding/exposeFunction
        if (window.antigravity_recordAction) {
            window.antigravity_recordAction(data);
        } else {
            console.log('[Antigravity] Recorded Action (local):', data);
        }
    }

    // Capture at bubble phase for simplicity, or use capture phase to get them first
    document.addEventListener('click', (e) => recordEvent('click', e), true);
    document.addEventListener('input', (e) => recordEvent('input', e), true);
    document.addEventListener('change', (e) => recordEvent('change', e), true);

})();
