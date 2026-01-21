import * as fs from 'fs';
import * as path from 'path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { VisualDiff } from './types.js';

// Re-export for backwards compatibility
export type VisualDiffResult = VisualDiff;

export class VisualComparator {
    private threshold: number;
    private outputDir: string;

    constructor(threshold: number = 0.1, outputDir: string = './output') {
        this.threshold = threshold;
        this.outputDir = path.join(outputDir, 'regressions', 'diffs');

        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    /**
     * Compare two images and return diff
     */
    async compare(baselinePath: string, currentPath: string, url: string): Promise<VisualDiff> {
        // Convert both to PNG
        const baselinePNG = await this.convertToPNG(baselinePath);
        const currentPNG = await this.convertToPNG(currentPath);

        // Ensure same dimensions
        const { width, height } = await this.getDimensions(baselinePNG);
        const resizedCurrent = await this.resize(currentPNG, width, height);

        // Load as PNG objects
        const baseline = PNG.sync.read(fs.readFileSync(baselinePNG));
        const current = PNG.sync.read(fs.readFileSync(resizedCurrent));

        // Create diff image
        const diff = new PNG({ width, height });

        // Compare
        const diffPixels = pixelmatch(
            baseline.data,
            current.data,
            diff.data,
            width,
            height,
            { threshold: this.threshold }
        );

        const totalPixels = width * height;
        const diffPercentage = (diffPixels / totalPixels) * 100;

        // Save diff image if there are differences
        let diffImagePath: string | undefined;
        if (diffPixels > 0) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const urlObj = new URL(url);
            const pageName = urlObj.pathname.replace(/\//g, '-').replace(/^-|-$/g, '') || 'index';

            diffImagePath = path.join(this.outputDir, `${pageName}_${timestamp}.png`);
            fs.writeFileSync(diffImagePath, PNG.sync.write(diff));
        }

        // Clean up temporary files
        if (baselinePNG !== baselinePath && fs.existsSync(baselinePNG)) {
            fs.unlinkSync(baselinePNG);
        }
        if (resizedCurrent !== currentPNG && fs.existsSync(resizedCurrent)) {
            fs.unlinkSync(resizedCurrent);
        }
        if (currentPNG !== currentPath && fs.existsSync(currentPNG)) {
            fs.unlinkSync(currentPNG);
        }

        return {
            totalPixels,
            diffPixels,
            diffPercentage,
            status: diffPercentage > 5 ? 'FAIL' : 'PASS', // 5% threshold for pass/fail
            diffImagePath
        };
    }

    private async convertToPNG(imagePath: string): Promise<string> {
        if (imagePath.endsWith('.png')) return imagePath;

        const pngPath = imagePath.replace(/\.[^.]+$/, '.png');
        await sharp(imagePath).png().toFile(pngPath);
        return pngPath;
    }

    private async getDimensions(imagePath: string): Promise<{ width: number; height: number }> {
        const metadata = await sharp(imagePath).metadata();
        return { width: metadata.width!, height: metadata.height! };
    }

    private async resize(imagePath: string, width: number, height: number): Promise<string> {
        const resizedPath = imagePath.replace('.png', '_resized.png');
        await sharp(imagePath).resize(width, height).png().toFile(resizedPath);
        return resizedPath;
    }
}
