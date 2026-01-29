
import * as fs from 'fs';
import { execSync } from 'child_process';

const env = process.argv[2] || 'dev';
const listPath = `output/${env}/blocked_flagged/rescan_list.json`;

if (!fs.existsSync(listPath)) {
    console.error(`No rescan list found at ${listPath}`);
    process.exit(1);
}

const paths = JSON.parse(fs.readFileSync(listPath, 'utf-8')) as string[];
const baseUrl = env === 'stage' ? 'https://stage.ianai.co' : 'https://dev.ianai.co';

console.log(`Found ${paths.length} paths to rescan. Start processing...`);

for (const path of paths) {
    if (path.startsWith('/modal/')) {
        console.log(`Skipping modal path: ${path}`);
        continue;
    }
    const fullUrl = baseUrl + path;
    console.log(`
========================================`);
    console.log(`Rescanning: ${fullUrl}`);
    console.log(`========================================
`);

    try {
        // Check for headless flag
        const isHeadless = process.argv.includes('--headless');
        const headlessFlag = isHeadless ? '--headless' : '';

        // Run with depth 1 to only capture this page, single concurrency
        execSync(`npm run search -- --url ${fullUrl} --limit 1 --depth 1 --epochs 1 ${headlessFlag}`, { stdio: 'inherit' });
        console.log(`✓ Completed: ${path}`);
    } catch {
        console.error(`❌ Failed: ${path}`);
    }

    // Cooldown
    execSync('sleep 3');
}
console.log('All rescans completed.');

