import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import sharp from 'sharp';
import { IExplorationPhase, PhaseResult } from './IExplorationPhase.js';
import { ExplorationContext } from './ExplorationContext.js';
import { UISettler } from '../lib/UISettler.js';
import { ScoringProcessor } from '../lib/ScoringProcessor.js';
import { EventBus } from '../../shared/events/EventBus.js';

export class CapturePhase implements IExplorationPhase {
    readonly name = 'Capture';

    async execute(context: ExplorationContext): Promise<PhaseResult> {
        const { page, url, outputDir, timestamp, pageName, actionChain } = context;
        console.log(`[CapturePhase] 📸 Capturing screenshot for: ${url}`);

        try {
            if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

            await UISettler.settleAndCleanup(page);

            let screenshotPath = path.join(outputDir, `${pageName}_${timestamp}.webp`);
            let counter = 1;
            while (fs.existsSync(screenshotPath)) {
                screenshotPath = path.join(outputDir, `${pageName}_${timestamp}_${counter}.webp`);
                counter++;
            }

            const png = await page.screenshot({ fullPage: true, type: 'png' });

            // Check for blank screenshot
            const stats = await sharp(png).stats();
            const isBlank = stats.channels.every(ch => ch.mean > 250 && ch.stdev < 10);
            if (isBlank) {
                console.warn(`[CapturePhase] ⚠️ Warning: Screenshot appears blank for ${url}`);
            }

            const webp = await sharp(png).webp({ quality: 80 }).toBuffer();
            const hash = crypto.createHash('md5').update(webp).digest('hex');
            fs.writeFileSync(screenshotPath, webp);

            // Context Updates
            context.results.screenshotPath = screenshotPath;
            context.state.lastScreenshotHash = hash;

            // Save Metadata JSON
            const domain = new URL(url).hostname;
            const jsonDir = path.join(path.dirname(screenshotPath), 'json', domain);
            if (!fs.existsSync(jsonDir)) fs.mkdirSync(jsonDir, { recursive: true });

            const baseName = path.basename(screenshotPath, '.webp');
            const jsonPath = path.join(jsonDir, `${baseName}.json`);

            const pageTitle = await page.title();
            context.results.pageTitle = pageTitle;

            // Reliability Scoring
            const { score, reasons } = await ScoringProcessor.calculate(page, {
                url,
                pageTitle,
                screenshotPath,
                functionalPath: context.results.links.map(l => l.path).flat().join(' > '), // This is slightly flawed but keep it for now
                actionChain
            });
            console.log(`[CapturePhase] Reliability Score: ${score.toFixed(2)} (${reasons.join(', ') || 'Clean'})`);

            fs.writeFileSync(jsonPath, JSON.stringify({
                url,
                timestamp: new Date().toISOString(),
                hash,
                capturePhase: 'early',
                reliabilityScore: score,
                contaminationReasons: reasons
            }, null, 2));

            // Decoupled Notification via EventBus
            await EventBus.getInstance().publish('page.captured', {
                url,
                pageTitle,
                screenshotPath,
                actionChain,
                functionalPath: context.results.links.map(l => l.path).flat().join(' > '),
                reliabilityScore: score,
                contaminationReasons: reasons,
                screenshotHash: hash
            });

            return { success: true };
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error(`[CapturePhase] Capture failed: ${errorMessage}`);
            return { success: false, error: errorMessage };
        }
    }
}
