import { Page } from 'playwright';

export interface PageContent {
    url: string;
    pageTitle: string;
    headings: {
        h1: string[];
        h2: string[];
        h3: string[];
    };
    tables: TableStructure[];
    buttons: string[];
    inputs: InputField[];
    links: string[];
}

export interface TableStructure {
    name?: string;
    headers: string[];
    rowCount: number;
    location: string;
}

export interface InputField {
    label: string;
    placeholder?: string;
    type: string;
}

export class ContentExtractor {
    async extract(page: Page): Promise<PageContent> {
        return await page.evaluate(() => {
            // Extract headings
            const headings = {
                h1: Array.from(document.querySelectorAll('h1')).map(h => h.textContent?.trim() || ''),
                h2: Array.from(document.querySelectorAll('h2')).map(h => h.textContent?.trim() || ''),
                h3: Array.from(document.querySelectorAll('h3')).map(h => h.textContent?.trim() || '')
            };

            // Extract tables
            const tables = Array.from(document.querySelectorAll('table')).map((table, index) => {
                const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent?.trim() || '');
                const rows = table.querySelectorAll('tbody tr');

                return {
                    name: table.getAttribute('aria-label') || table.id || `table-${index}`,
                    headers,
                    rowCount: rows.length,
                    location: table.className || 'unknown'
                };
            });

            // Extract buttons
            const buttons = Array.from(document.querySelectorAll('button')).map(btn =>
                btn.textContent?.trim() || btn.getAttribute('aria-label') || ''
            ).filter(label => label.length > 0);

            // Extract inputs
            const inputs = Array.from(document.querySelectorAll('input')).map(input => ({
                label: input.getAttribute('aria-label') || input.getAttribute('placeholder') || input.name || '',
                placeholder: input.placeholder || undefined,
                type: input.type
            })).filter(input => input.label.length > 0);

            // Extract links
            const links = Array.from(document.querySelectorAll('a'))
                .map(a => a.textContent?.trim() || '')
                .filter(text => text.length > 0);

            return {
                url: window.location.href,
                pageTitle: document.title,
                headings,
                tables,
                buttons,
                inputs,
                links
            };
        });
    }
}
