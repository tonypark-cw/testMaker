
import { Page, TestInfo } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Captures context for AI-based Self-Healing when a test fails.
 * This includes:
 * 1. Full HTML Snapshot
 * 2. Accessibility Tree (JSON) for semantic understanding
 * 3. Error details and potential locator mapping
 */
export async function captureHealingContext(page: Page, testInfo: TestInfo) {
    if (testInfo.status !== 'failed') return;

    console.log(`[Healer] Capturing failure context for: ${testInfo.title}`);
    const attachmentDir = testInfo.outputDir; // Playwright ensures this exists

    // 1. Capture HTML Snapshot
    try {
        const html = await page.content();
        const htmlPath = path.join(attachmentDir, 'healing-snapshot.html');
        fs.writeFileSync(htmlPath, html);
        console.log(`[Healer] Saved HTML snapshot: ${htmlPath}`);
        // Attach to report
        testInfo.attachments.push({
            name: 'healing-snapshot-html',
            path: htmlPath,
            contentType: 'text/html'
        });
    } catch (e) {
        console.error('[Healer] Failed to capture HTML snapshot', e);
    }

    // 2. Capture Accessibility Tree (semantic structure)
    try {
        const accessibility = (page as any).accessibility;
        const snapshot = accessibility ? await accessibility.snapshot() : null;
        if (snapshot) {
            const treePath = path.join(attachmentDir, 'healing-accessibility.json');
            fs.writeFileSync(treePath, JSON.stringify(snapshot, null, 2));
            console.log(`[Healer] Saved Accessibility Tree: ${treePath}`);
            testInfo.attachments.push({
                name: 'healing-accessibility',
                path: treePath,
                contentType: 'application/json'
            });
        }
    } catch (e) {
        console.error('[Healer] Failed to capture accessibility snapshot', e);
    }

    // 3. Capture Error Metadata
    try {
        const errorData = {
            testTitle: testInfo.title,
            error: testInfo.error,
            timestamp: new Date().toISOString(),
            url: page.url()
        };
        const metaPath = path.join(attachmentDir, 'healing-metadata.json');
        fs.writeFileSync(metaPath, JSON.stringify(errorData, null, 2));
    } catch (e) {
        console.error('[Healer] Failed to capture error metadata', e);
    }
}
