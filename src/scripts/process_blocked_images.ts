
import * as fs from 'fs';
import * as path from 'path';

interface QATags {
    [key: string]: string;
}

class BlockedImageProcessor {
    private env: string;
    private outputDir: string;
    private flagDir: string;
    private tagsPath: string;

    constructor(env: string = 'stage') {
        this.env = env;
        this.outputDir = path.join('./output', env);
        this.flagDir = path.join(this.outputDir, 'blocked_flagged');
        this.tagsPath = './data/qa-tags.json';

        if (!fs.existsSync(this.flagDir)) {
            fs.mkdirSync(this.flagDir, { recursive: true });
        }
    }

    async process() {
        console.log(`Processing BLOCK tagged images for: ${this.env}`);

        // 1. Read qa-tags.json
        if (!fs.existsSync(this.tagsPath)) {
            console.error(`Tags file not found: ${this.tagsPath}`);
            return;
        }

        const tagsData: QATags = JSON.parse(fs.readFileSync(this.tagsPath, 'utf-8'));

        // 2. Filter BLOCK tagged items for current environment
        const blockedItems = Object.entries(tagsData)
            .filter(([key, tag]) => tag === 'BLOCK' && key.includes(`/output/${this.env}/`));

        console.log(`Found ${blockedItems.length} BLOCK tagged items for ${this.env}`);

        // 3. Move files and collect URLs
        const urlSet = new Set<string>();
        let movedCount = 0;

        for (const [key] of blockedItems) {
            let filePath = key.split('#')[0];

            // Fix path: "/output/stage/..." -> "output/stage/..."
            if (filePath.startsWith('/output/')) {
                filePath = filePath.substring(1);
            }

            // Extract URL before moving
            const extractedUrl = this.extractPath(filePath);
            if (extractedUrl) {
                urlSet.add(extractedUrl);
            }

            // Move file
            if (fs.existsSync(filePath)) {
                try {
                    const basename = path.basename(filePath);
                    const dest = path.join(this.flagDir, basename);
                    fs.renameSync(filePath, dest);
                    console.log(`[MOVED] ${basename}`);
                    movedCount++;
                } catch (e) {
                    console.error(`Failed to move ${filePath}:`, e);
                }
            } else {
                console.warn(`File not found: ${filePath}`);
            }
        }

        // 4. Generate rescan list
        const uniqueUrls = Array.from(urlSet).sort();

        const rescanListPath = path.join(this.flagDir, 'rescan_list.json');
        fs.writeFileSync(rescanListPath, JSON.stringify(uniqueUrls, null, 2));

        console.log('\nSummary:');
        console.log(`- Moved ${movedCount} files to ${this.flagDir}`);
        console.log(`- Generated rescan list with ${uniqueUrls.length} unique URLs`);
        console.log(`- Rescan list saved to: ${rescanListPath}`);
        console.log('\nNote: UUID-based and modal paths were excluded from rescan list.');
    }

    private extractPath(filePath: string): string | null {
        // Extract URL path from file path
        // "output/stage/screenshots/stage-ianai-co/app-customer_2026.webp" -> "/app/customer"

        const filename = path.basename(filePath);
        // Remove date and extension: "app-customer_2026-01-22T12.webp" -> "app-customer"
        let baseName = filename.split('_')[0].replace(/\.(webp|png|jpg|jpeg)$/i, '');

        // Skip if UUID pattern detected (019...-...-...)
        if (/019[a-f0-9]{5}-[a-f0-9]{4}-[a-f0-9]{4}/.test(baseName)) {
            return null; // Skip complex UUID paths
        }

        // Skip modals
        if (baseName.startsWith('modal-')) {
            return null;
        }

        // Remove checkbox/tab/radio states
        baseName = baseName
            .replace(/_checkbox\d+-\w+$/, '')
            .replace(/_tab-.+$/, '')
            .replace(/_radio\d+$/, '');

        // Convert: "app-customer" -> "/app/customer"
        const urlPath = '/' + baseName.replace(/-/g, '/');

        return urlPath;
    }
}

// CLI execution
const env = process.argv[2] || 'stage';
const processor = new BlockedImageProcessor(env);
processor.process().catch(console.error);
