import { BrowserPage } from '../adapters/BrowserPage.js';
import * as crypto from 'crypto';

/**
 * UIHasher
 * Generates a structural fingerprint of a page to identify similar layouts.
 */
export class UIHasher {
    /**
     * Generates a hash based on the structural skeleton of the page.
     * Considers element tags, roles, and major container classes.
     */
    public static async generateHash(page: BrowserPage): Promise<string> {
        try {
            const skeleton = await page.evaluate(() => {
                // Focus on structural elements
                const selectors = [
                    'table', 'form', 'nav', 'aside', 
                    'button', 'input', 'select', 'textarea',
                    '[role="tablist"]', '[role="grid"]', '[role="dialog"]',
                    '.mantine-Table-root', '.mantine-Tabs-root'
                ];

                const elements = document.querySelectorAll(selectors.join(', '));
                const fingerprint = Array.from(elements).map(el => {
                    const tag = el.tagName.toLowerCase();
                    const role = el.getAttribute('role') || '';
                    const type = (el as HTMLInputElement).type || '';
                    const classList = Array.from(el.classList).filter(c => c.includes('mantine') || c.includes('root')).join('.');
                    
                    // Return a simplified string for this element
                    return `${tag}:${role}:${type}:${classList}`;
                }).join('|');

                return fingerprint;
            }, undefined);

            if (!skeleton) return 'empty';

            return crypto.createHash('md5').update(skeleton).digest('hex');
        } catch (e) {
            console.error('[UIHasher] Failed to generate hash:', e);
            return 'error';
        }
    }
}
