
import * as fs from 'fs';
import * as path from 'path';

/**
 * Self-Healing CLI Wrapper
 * 
 * Usage: npx ts-node scripts/heal.ts [optional-test-result-dir]
 * 
 * Logic:
 * 1. Find the latest test failure directory in `test-results/`.
 * 2. Load failure context (metadata, accessibility tree, snapshot).
 * 3. (Future) Send to LLM for analysis.
 * 4. (Future) Apply patch.
 */

const TEST_RESULTS_DIR = path.join(process.cwd(), 'test-results');

function getLatestFailureDir(): string | null {
    if (!fs.existsSync(TEST_RESULTS_DIR)) return null;

    const dirs = fs.readdirSync(TEST_RESULTS_DIR)
        .map(name => path.join(TEST_RESULTS_DIR, name))
        .filter(p => fs.statSync(p).isDirectory())
        .filter(p => {
            // Check if it contains healing data
            return fs.existsSync(path.join(p, 'healing-metadata.json'));
        })
        .sort((a, b) => {
            return fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime();
        });

    return dirs.length > 0 ? dirs[0] : null;
}

async function analyzeFailure(dir: string) {
    console.log(`[Healer] Analyzing failure in: ${dir}`);

    const metaPath = path.join(dir, 'healing-metadata.json');
    if (!fs.existsSync(metaPath)) {
        console.error('[Healer] No healing metadata found.');
        return;
    }

    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    console.log(`[Healer] Test Title: ${metadata.testTitle}`);
    console.log(`[Healer] Failed URL: ${metadata.url}`);
    console.log(`[Healer] Error: ${metadata.error?.message || 'Unknown error'}`);

    const accPath = path.join(dir, 'healing-accessibility.json');
    if (fs.existsSync(accPath)) {
        console.log(`[Healer] Accessibility Snapshot available (${(fs.statSync(accPath).size / 1024).toFixed(2)} KB)`);
    }

    const htmlPath = path.join(dir, 'healing-snapshot.html');
    if (fs.existsSync(htmlPath)) {
        console.log(`[Healer] HTML Snapshot available (${(fs.statSync(htmlPath).size / 1024).toFixed(2)} KB)`);
    }

    console.log('\n[Healer] Ready for LLM Analysis (Not implemented yet).');
}

async function main() {
    const targetDir = process.argv[2] || getLatestFailureDir();

    if (!targetDir) {
        console.log('[Healer] No recent failed tests with healing context found.');
        return;
    }

    await analyzeFailure(targetDir);
}

main().catch(console.error);
