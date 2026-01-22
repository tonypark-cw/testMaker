import { TestableElement } from '../../types/index.js';
import { BrowserPage } from '../adapters/BrowserPage.js';
import { IExplorationPhase, PhaseResult } from './IExplorationPhase.js';
import { ExplorationContext } from './ExplorationContext.js';

export class ExtractionPhase implements IExplorationPhase {
    readonly name = 'Extraction';

    async execute(context: ExplorationContext): Promise<PhaseResult> {
        const { page } = context;
        console.log('[ExtractionPhase] ⛏️ Extracting DOM data and links...');

        const result = await page.evaluate(() => {
            const elements: TestableElement[] = [];
            const links = new Set<string>();
            const sidebarLinks = new Set<string>();

            // Stack-based DOM traversal
            const stack: Node[] = [document.body];
            while (stack.length > 0) {
                const node = stack.pop()!;
                if (node.nodeType === Node.ELEMENT_NODE) {
                    const el = node as HTMLElement;
                    const tag = el.tagName.toLowerCase();
                    const href = el.getAttribute('href');

                    if (href && (href.startsWith('http') || href.startsWith('/'))) {
                        const fullHref = (el as HTMLAnchorElement).href;
                        if (fullHref && fullHref.startsWith('http')) {
                            if (el.closest('nav, aside, .sidebar')) sidebarLinks.add(fullHref);
                            else links.add(fullHref);
                        }
                    }

                    const role = el.getAttribute('role');
                    if (['button', 'input', 'select', 'textarea', 'a'].includes(tag) || role === 'button') {
                        const rect = el.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            const label = el.innerText?.substring(0, 50) || el.getAttribute('aria-label') || '';
                            const elId = el.id || `auto-${elements.length}`;
                            const inputType = (el as HTMLInputElement).type || '';

                            let elType = 'custom';
                            if (tag === 'button' || role === 'button') elType = 'button';
                            else if (tag === 'a') elType = 'link';
                            else if (tag === 'select') elType = 'select';
                            else if (tag === 'textarea') elType = 'textarea';
                            else if (tag === 'input') {
                                if (inputType === 'checkbox') elType = 'checkbox';
                                else if (inputType === 'radio') elType = 'radio';
                                else if (inputType === 'file') elType = 'file-input';
                                else elType = 'text-input';
                            }

                            elements.push({
                                id: elId,
                                selector: el.id ? `#${el.id}` : el.getAttribute('data-testid') ? `[data-testid="${el.getAttribute('data-testid')}"]` : tag,
                                tag,
                                type: elType as any,
                                label,
                                rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
                                sectionIndex: 0,
                                state: {
                                    visible: true,
                                    enabled: !(el as HTMLButtonElement).disabled,
                                    required: (el as HTMLInputElement).required || false
                                },
                                attributes: {
                                    href: el.getAttribute('href') || '',
                                    placeholder: el.getAttribute('placeholder') || '',
                                    value: (el as HTMLInputElement).value || '',
                                    role: role || ''
                                }
                            });
                        }
                    }
                }
                if (node.childNodes) {
                    for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push(node.childNodes[i]);
                }
            }

            // SPA Route Merging
            if ((window as any).__discoveredRoutes) {
                (window as any).__discoveredRoutes.forEach((r: string) => links.add(r));
            }

            return {
                elements,
                links: Array.from(links),
                sidebarLinks: Array.from(sidebarLinks)
            };
        }, undefined);

        // Update Context Results
        context.results.elements = result.elements;
        context.results.sidebarLinks = result.sidebarLinks;

        // Smart Deduplication for Links
        const patternCounts: Record<string, number> = {};
        const LIMIT = 500;
        const idPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{20,}/i;
        const forbidden = ['logout', 'help', 'feedback', 'support'];

        result.links.forEach(href => {
            try {
                const url = new URL(href);
                const path = url.pathname;
                if (forbidden.some(kw => path.toLowerCase().includes(kw))) return;

                const pattern = path.replace(idPattern, '{id}');
                patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;

                if (patternCounts[pattern] <= LIMIT) {
                    // Avoid duplicating links already discovered by explorers
                    if (!context.results.links.find(l => l.url === href)) {
                        context.results.links.push({ url: href, path: [] }); // Default empty path for DOM links
                    }
                }
            } catch { /* ignore */ }
        });

        return { success: true };
    }
}
