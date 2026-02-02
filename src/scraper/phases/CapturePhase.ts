import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import sharp from 'sharp';
import { IExplorationPhase, PhaseResult } from './IExplorationPhase.js';
import { ExplorationContext } from './ExplorationContext.js';
import { UISettler } from '../lib/UISettler.js';
import { ScoringProcessor } from '../lib/ScoringProcessor.js';
import { UIHasher } from '../lib/UIHasher.js';
import { EventBus } from '../../shared/events/EventBus.js';

export class CapturePhase implements IExplorationPhase {
    readonly name = 'Capture';

    async execute(context: ExplorationContext): Promise<PhaseResult> {
        const { page, url, outputDir, timestamp, pageName, actionChain } = context;
        console.log(`[CapturePhase] 📸 Capturing screenshot for: ${url}`);

        try {
            // Generate UI Hash (Structural fingerprint)
            const uiHash = await UIHasher.generateHash(page);
            context.results.uiHash = uiHash;
            console.log(`[CapturePhase] Layout Hash: ${uiHash}`);

            if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

            let attempts = 0;
            const MAX_ATTEMPTS = 3;
            let finalScore = 0;
            let finalReasons: string[] = [];
            let screenshotPath = path.join(outputDir, `${pageName}_${timestamp}.webp`);

            // Generate unique path
            let counter = 1;
            while (fs.existsSync(screenshotPath)) {
                screenshotPath = path.join(outputDir, `${pageName}_${timestamp}_${counter}.webp`);
                counter++;
            }

            // Loop for Retries
            while (attempts < MAX_ATTEMPTS) {
                attempts++;

                await UISettler.settleAndCleanup(page);

                // Take Screenshot
                const png = await page.screenshot({ fullPage: true, type: 'png' });

                // Check for blank screenshot (Visual Entropy part 1)
                const stats = await sharp(png).stats();
                const isBlank = stats.channels.every(ch => ch.mean > 250 && ch.stdev < 10);
                if (isBlank) {
                    console.warn(`[CapturePhase] ⚠️ Warning: Screenshot appears blank for ${url} (Attempt ${attempts}/${MAX_ATTEMPTS})`);
                }

                const webp = await sharp(png).webp({ quality: 80 }).toBuffer();
                fs.writeFileSync(screenshotPath, webp);

                // Calculate Score
                const pageTitle = await page.title();
                const { score, reasons } = await ScoringProcessor.calculate(page, {
                    url,
                    pageTitle,
                    screenshotPath,
                    functionalPath: context.results.links.map(l => l.path).flat().join(' > '),
                    actionChain,
                    totalElements: await page.evaluate(() => document.querySelectorAll('*').length).catch(() => 0)
                });

                finalScore = score;
                finalReasons = reasons;

                console.log(`[CapturePhase] Reliability Score: ${score.toFixed(2)} (${reasons.join(', ') || 'Clean'}) - Attempt ${attempts}`);

                if (score >= 70) {
                    break; // Good score, proceed
                }

                if (attempts < MAX_ATTEMPTS) {
                    console.warn(`[CapturePhase] Score ${score.toFixed(2)} is below 70. Retrying...`);
                    // Delete intermediate screenshot to clean up
                    try { fs.unlinkSync(screenshotPath); } catch { }
                    // Wait a bit before retry
                    await new Promise(r => setTimeout(r, 2000));
                } else {
                    console.warn(`[CapturePhase] Max retries reached. Keeping last screenshot with score ${score.toFixed(2)}`);
                }
            }

            // --- Save Final Results ---

            // Context Updates
            const webpBuffer = fs.readFileSync(screenshotPath);
            const hash = crypto.createHash('md5').update(webpBuffer).digest('hex');

            context.results.screenshotPath = screenshotPath;
            context.state.lastScreenshotHash = hash;
            context.results.pageTitle = await page.title();

            // Save Metadata JSON
            const domain = new URL(url).hostname;
            const jsonDir = path.join(path.dirname(screenshotPath), 'json', domain);
            if (!fs.existsSync(jsonDir)) fs.mkdirSync(jsonDir, { recursive: true });

            const baseName = path.basename(screenshotPath, '.webp');
            const jsonPath = path.join(jsonDir, `${baseName}.json`);

            fs.writeFileSync(jsonPath, JSON.stringify({
                url,
                timestamp: new Date().toISOString(),
                hash,
                uiHash, // [ENHANCE] Save UI hash in metadata
                capturePhase: 'early',
                reliabilityScore: finalScore,
                contaminationReasons: finalReasons
            }, null, 2));

            // Decoupled Notification via EventBus
            await EventBus.getInstance().publish('page.captured', {
                url,
                pageTitle: context.results.pageTitle,
                screenshotPath,
                actionChain,
                functionalPath: context.results.links.map(l => l.path).flat().join(' > '),
                reliabilityScore: finalScore,
                contaminationReasons: finalReasons,
                screenshotHash: hash,
                uiHash // [ENHANCE] Include UI hash in event
            });

            return { success: true };
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error(`[CapturePhase] Capture failed: ${errorMessage}`);
            return { success: false, error: errorMessage };
        }
    }
}
