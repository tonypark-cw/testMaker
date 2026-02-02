
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

class RedCleaner {
    private targetDir: string;
    private flagDir: string;

    constructor(targetDir: string) {
        this.targetDir = targetDir;
        this.flagDir = path.join(targetDir, 'red_flagged');

        if (!fs.existsSync(this.flagDir)) {
            fs.mkdirSync(this.flagDir, { recursive: true });
        }
    }

    async scanAndClean() {
        if (!fs.existsSync(this.targetDir)) {
            console.error(`Target directory does not exist: ${this.targetDir}`);
            return;
        }

        const files = this.getAllFiles(this.targetDir).filter(f => /\.(png|webp|jpg|jpeg)$/i.test(f) && !f.includes('red_flagged'));
        console.log(`Checking ${files.length} images for red screen...`);

        const rescanUrls = new Set<string>();
        let movedCount = 0;

        for (const file of files) {
            try {
                const isRed = await this.isPredominantlyRed(file);
                if (isRed) {
                    const filename = path.basename(file);
                    const destPath = path.join(this.flagDir, filename);

                    // Move file instead of deleting (overwrite if exists)
                    await fs.promises.rename(file, destPath);
                    console.log(`[RED DETECTED] Moved: ${filename}`);
                    movedCount++;

                    // Extract URL clue from filename (e.g., "app-adjustment_..." -> "/app/adjustment")
                    const pageName = filename.split('_')[0];
                    const urlPath = '/' + pageName.replace(/-/g, '/');
                    rescanUrls.add(urlPath);
                }
            } catch (e) {
                console.error(`Error processing ${file}:`, e);
            }
        }

        if (rescanUrls.size > 0) {
            const listPath = path.join(this.flagDir, 'rescan_list.json');
            fs.writeFileSync(listPath, JSON.stringify(Array.from(rescanUrls), null, 2));
            console.log(`Saved ${rescanUrls.size} URLs to rescan in: ${listPath}`);
        }

        console.log(`Done. Moved ${movedCount} red-dominant images to ${this.flagDir}`);
    }

    private getAllFiles(dir: string, fileList: string[] = []): string[] {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                if (file !== 'red_flagged') { // skip destination
                    this.getAllFiles(fullPath, fileList);
                }
            } else {
                fileList.push(fullPath);
            }
        }
        return fileList;
    }

    private async isPredominantlyRed(imagePath: string): Promise<boolean> {
        try {
            // Convert to raw PNG buffer for pixel access
            // Using sharp to ensure standard format and small size for speed
            const { data, info } = await sharp(imagePath)
                .resize(200) // downscale for speed
                .raw()
                .toBuffer({ resolveWithObject: true });

            let redPixelCount = 0;
            const totalPixels = info.width * info.height;
            const channels = info.channels; // usually 3 (RGB) or 4 (RGBA)

            for (let i = 0; i < data.length; i += channels) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];

                // Heuristic for "predominantly red" (Profile page theme)
                if (r > 150 && g < 100 && b < 100) {
                    redPixelCount++;
                }
            }

            const redRatio = redPixelCount / totalPixels;
            // 30% red coverage is generous but safe for "red screen" detection
            return redRatio > 0.3;

        } catch (e) {
            console.warn(`Failed to analyze ${imagePath}:`, e);
            return false;
        }
    }
}

const targetDir = process.argv[2] || './output';
console.log(`Starting Red Screen Cleaner on: ${targetDir}`);
new RedCleaner(targetDir).scanAndClean().catch(console.error);
