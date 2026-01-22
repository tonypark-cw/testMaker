import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { ActionRecord, ModalDiscovery, TestableElement } from '../../types/index.js';
import { CommandExecutor } from '../commands/CommandExecutor.js';
import { ClickCommand } from '../commands/ClickCommand.js';
import { NetworkManager } from '../../shared/network/NetworkManager.js';
import { BrowserPage } from '../adapters/BrowserPage.js';
import { BrowserElement } from '../adapters/BrowserElement.js';

/**
 * UISettler
 * Handles UI stability, modal extraction, and smart interaction logic
 */
export class UISettler {
    /**
     * Close any open modals/drawers
     */
    /**
     * Close any open modals/drawers
     */
    public static async closeModals(page: BrowserPage) {
        await page.keyboardPress('Escape');
        await page.waitForTimeout(300);
        await page.evaluate(() => {
            const sel = '.ianai-Modal-close, .mantine-Modal-close, [aria-label="Close"], .ianai-CloseButton-root, button[class*="CloseButton"], .ianai-Drawer-close, .mantine-Drawer-close';
            document.querySelectorAll(sel).forEach(btn => (btn as HTMLElement).click());
        }, undefined);
        await page.waitForTimeout(300);
    }

    /**
     * Check if a modal/drawer is currently open
     */
    public static async isModalOpen(page: BrowserPage): Promise<boolean> {
        return await page.evaluate(() => {
            const selectors = [
                '.ianai-Modal-content', '.mantine-Modal-content', '.mantine-Modal-inner',
                '.ianai-Drawer-content', '.mantine-Drawer-content',
                '[role="dialog"]', '[role="alertdialog"]', '.modal-content', '.modal-body',
                '.ant-modal', '.ant-drawer', '.MuiDialog-root', '.MuiDrawer-paper'
            ];
            const modals = document.querySelectorAll(selectors.join(', '));
            for (const modal of modals) {
                const style = window.getComputedStyle(modal);
                if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                    const rect = modal.getBoundingClientRect();
                    if (rect.width > 20 && rect.height > 20) return true;
                }
            }
            return false;
        }, undefined);
    }

    /**
     * Settle UI and clean up transient elements (popovers, etc.)
     */
    public static async settleAndCleanup(page: BrowserPage) {
        console.log('[UISettler] Settling UI and cleaning ghost elements...');

        // Smart Dismiss: Click "Stay" on "Leave without saving" modals
        try {
            const modalText = await page.evaluate(() => document.body.innerText, undefined).catch(() => '');
            if (modalText.includes('leave without saving') || modalText.includes('Discard') || modalText.includes('Unsaved')) {
                const stayBtn = await page.locator('button:has-text("Stay")').first();
                if (await stayBtn.isVisible()) {
                    console.log('[UISettler] Detected "Leave without saving" modal - clicking "Stay".');
                    await stayBtn.click();
                    await page.waitForTimeout(300);
                }
            }
        } catch { /* ignore */ }

        await page.evaluate(() => {
            const selectors = [
                '.mantine-Select-dropdown', '.mantine-MultiSelect-dropdown',
                '.mantine-Popover-dropdown', '.mantine-Menu-dropdown',
                '.ianai-Select-dropdown', '.ianai-Popover-dropdown',
                '[role="listbox"]', '[role="menu"]', '.mantine-Tooltip-root',
                'div[class*="dropdown"]', 'div[class*="Dropdown"]',
                'div[class*="popover"]', 'div[class*="Tooltip"]',
                '.mantine-Overlay-root', '.ianai-Overlay-root'
            ];
            selectors.forEach(s => {
                document.querySelectorAll(s).forEach(el => {
                    const htmlEl = el as HTMLElement;
                    if (!el.closest('.ianai-Modal-content') && !el.closest('.mantine-Modal-content') && !el.closest('[role="dialog"]')) {
                        const style = window.getComputedStyle(htmlEl);
                        if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0) {
                            console.log(`[DEBUG] UISettler: Hiding element: ${s} (${htmlEl.className})`);
                            htmlEl.style.opacity = '0';
                            htmlEl.style.pointerEvents = 'none';
                        }
                    }
                });
            });
        }, undefined).catch(() => { });
        await page.waitForTimeout(500);
    }

    /**
     * Extract content from an open modal
     */
    public static async extractModalContent(
        page: BrowserPage,
        triggerText: string,
        url: string,
        outputDir: string,
        timestamp: string,
        capturedModalHashes: Set<string>
    ): Promise<ModalDiscovery | null> {
        if (!(await this.isModalOpen(page))) return null;
        console.log('[UISettler] Modal detected, extracting content...');

        const modalData = await page.evaluate((currentUrl) => {
            const selectors = [
                '.ianai-Modal-content', '.mantine-Modal-content', '.mantine-Modal-inner',
                '.ianai-Drawer-content', '.mantine-Drawer-content',
                '[role="dialog"]', '.modal-content', '.ant-modal-content', '.MuiDialog-container'
            ];
            const modals = document.querySelectorAll(selectors.join(', '));
            let modal: Element | null = null;
            for (const m of modals) {
                const style = window.getComputedStyle(m);
                if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                    const rect = m.getBoundingClientRect();
                    if (rect.width > 20 && rect.height > 20) {
                        modal = m;
                        break;
                    }
                }
            }
            if (!modal) return null;

            const titleEl = modal.querySelector('.ianai-Modal-title, .mantine-Modal-title, h1, h2, h3, [class*="title"], [role="heading"]');
            const modalTitle = titleEl?.textContent?.trim() || 'Untitled Modal';

            const links = Array.from(modal.querySelectorAll('a[href]'))
                .map(a => {
                    const href = (a as HTMLAnchorElement).getAttribute('href') || '';
                    try {
                        return new URL(href, currentUrl).toString();
                    } catch {
                        return href.startsWith('http') ? href : '';
                    }
                })
                .filter(h => h && !h.startsWith('blob:') && !h.startsWith('javascript:'));

            const elements: TestableElement[] = [];
            modal.querySelectorAll('button, a[href], input, textarea, select, [role="button"], [role="tab"], [data-testid]').forEach((el, idx) => {
                const rect = el.getBoundingClientRect();
                if (rect.width < 2 || rect.height < 2) return;
                elements.push({
                    id: `modal-el-${idx}`,
                    tag: el.tagName.toLowerCase(),
                    label: (el as HTMLElement).innerText?.trim().substring(0, 50) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '',
                    type: 'button' as any,
                    selector: `modal-el-${idx}`,
                    rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
                    sectionIndex: 0,
                    state: { visible: true, enabled: true, required: false },
                    attributes: {}
                });
            });
            return { modalTitle, links, elements };
        }, page.url());

        if (!modalData) return null;

        let screenshotPath: string | undefined;
        try {
            const modalEl = await page.waitForSelector('.ianai-Modal-content, .mantine-Modal-content, [role="dialog"], .ianai-Drawer-content', { timeout: 2000 });
            if (modalEl) {
                const png = await modalEl.screenshot({ type: 'png' });
                const stats = await sharp(png).stats();
                const isBlank = stats.channels.every(ch => ch.mean > 250 && ch.stdev < 10);

                if (!isBlank) {
                    const webp = await sharp(png).webp({ quality: 80 }).toBuffer();
                    const hash = crypto.createHash('md5').update(webp).digest('hex');

                    if (!capturedModalHashes.has(hash)) {
                        capturedModalHashes.add(hash);
                        const safeName = modalData.modalTitle.replace(/[^a-zA-Z0-9가-힣]/g, '_').substring(0, 40) || 'modal';
                        screenshotPath = path.join(outputDir, `modal-${safeName}_${timestamp}.webp`);

                        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
                        fs.writeFileSync(screenshotPath, webp);

                        // Save JSON metadata
                        try {
                            const domain = new URL(url).hostname;
                            const jsonDir = path.join(outputDir, 'json', domain);
                            if (!fs.existsSync(jsonDir)) fs.mkdirSync(jsonDir, { recursive: true });

                            const jsonFilename = `modal-${safeName}_${timestamp}.json`;
                            const jsonPath = path.join(jsonDir, jsonFilename);
                            fs.writeFileSync(jsonPath, JSON.stringify({
                                url: url,
                                title: modalData.modalTitle,
                                timestamp: new Date().toISOString(),
                                hash,
                                type: 'modal'
                            }, null, 2));
                        } catch { /* ignore */ }

                        console.log(`[UISettler] Saved unique modal: ${safeName}`);
                    }
                }
            }
        } catch { /* ignore */ }


        return {
            triggerText,
            modalTitle: modalData.modalTitle,
            elements: modalData.elements,
            links: modalData.links,
            screenshotPath
        };
    }

    /**
     * Coordinate-based clicking to bypass SPA event filtering.
     * Uses CommandExecutor for centralized retry logic and automatic logging.
     */
    public static async smartClick(
        page: BrowserPage,
        handle: BrowserElement,
        actionChain: ActionRecord[],
        networkManager?: NetworkManager
    ): Promise<void> {
        const executor = new CommandExecutor(
            { page, actionChain, networkManager },
            { maxRetries: 2, retryDelayMs: 300 }
        );

        const command = new ClickCommand(handle as any);

        try {
            await executor.execute(command);
        } catch (e) {
            // Silently fail for non-critical clicks (existing behavior)
            // Error already logged by CommandExecutor
        }
    }
}
