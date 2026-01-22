/**
 * Navigation Helper
 *
 * Consolidates duplicated navigation and modal handling logic from explorers.
 */

import { UISettler } from '../lib/UISettler.js';
import { TIMING } from '../config/constants.js';
import { BrowserPage } from '../adapters/BrowserPage.js';
import { ModalDiscovery } from '../../types/index.js';

export interface PostClickContext {
    discoveredLinks: Array<{ url: string; path: string[] }>;
    modalDiscoveries: ModalDiscovery[];
    previousPath: string[];
    outputDir: string;
    timestamp: string;
    capturedModalHashes: Set<string>;
}

export class NavigationHelper {
    /**
     * Handle navigation or modal after a click action
     * Returns true if navigation occurred
     */
    static async handlePostClick(
        page: BrowserPage,
        targetUrl: string,
        label: string,
        ctx: PostClickContext
    ): Promise<boolean> {
        await page.waitForTimeout(TIMING.NAVIGATION_DELAY);

        const newUrl = page.url();
        const normalizedTarget = targetUrl.replace(/\/$/, '');
        const normalizedNew = newUrl.replace(/\/$/, '');

        if (normalizedNew !== normalizedTarget) {
            // Navigation occurred
            ctx.discoveredLinks.push({
                url: newUrl,
                path: [...ctx.previousPath, label]
            });

            // Return to target URL
            await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => {});
            await page.waitForTimeout(TIMING.NAVIGATION_DELAY);

            return true;
        } else {
            // No navigation - check for modal
            const discovery = await UISettler.extractModalContent(
                page,
                label,
                targetUrl,
                ctx.outputDir,
                ctx.timestamp,
                ctx.capturedModalHashes
            );

            if (discovery) {
                ctx.modalDiscoveries.push(discovery);
            }

            return false;
        }
    }

    /**
     * Handle navigation without modal tracking
     * Simpler version for NavExplorer
     */
    static async handleSimpleNavigation(
        page: BrowserPage,
        targetUrl: string,
        label: string,
        discoveredLinks: Array<{ url: string; path: string[] }>,
        previousPath: string[]
    ): Promise<boolean> {
        await page.waitForTimeout(TIMING.NAVIGATION_DELAY);

        const newUrl = page.url();

        if (newUrl !== targetUrl) {
            discoveredLinks.push({
                url: newUrl,
                path: [...previousPath, label]
            });

            await page.goto(targetUrl, { waitUntil: 'networkidle' }).catch(() => {});
            return true;
        }

        return false;
    }

    /**
     * Extract href and add to discovered links if valid
     */
    static addLinkFromHref(
        href: string | null,
        targetUrl: string,
        label: string,
        discoveredLinks: Array<{ url: string; path: string[] }>,
        previousPath: string[]
    ): boolean {
        if (!href) return false;

        if (href.startsWith('http') || href.startsWith('/')) {
            try {
                const fullUrl = new URL(href, targetUrl).toString();
                discoveredLinks.push({
                    url: fullUrl,
                    path: [...previousPath, label]
                });
                return true;
            } catch {
                // Invalid URL
                return false;
            }
        }

        return false;
    }

    /**
     * Check if URL should be excluded from discovery
     */
    static shouldExcludeUrl(url: string): boolean {
        const excludePatterns = [
            'logout',
            'signout',
            'sign-out',
            'delete',
            'remove',
            'cancel'
        ];

        const lowerUrl = url.toLowerCase();
        return excludePatterns.some(pattern => lowerUrl.includes(pattern));
    }
}

export default NavigationHelper;
