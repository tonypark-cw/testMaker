import * as path from 'path';
import { spawnSync } from 'child_process';
import { Runner } from '../../scraper/runner.js';
import { ScraperConfig } from '../../shared/types.js';

export async function searchAction(options: any) {
    const url = options.url || process.env.TESTMAKER_URL;
    if (!url) {
        console.error('Error: URL is required.');
        process.exit(1);
    }

    // Auto-detect dev vs stage credentials
    const isDev = url.includes('dev.ianai.co');
    const isStage = url.includes('stage.ianai.co');
    const env = isDev ? 'dev' : isStage ? 'stage' : 'prod';

    const username = isDev && process.env.DEV_EMAIL ? process.env.DEV_EMAIL : (options.username || process.env.EMAIL);
    const password = isDev && process.env.DEV_PASSWORD ? process.env.DEV_PASSWORD : (options.password || process.env.PASSWORD);

    console.log(`[TestMaker] Environment: ${env.toUpperCase()}`);
    if (username) console.log(`[TestMaker] Using credentials for: ${username}`);

    // Environment-aware output directory
    const baseOutputDir = path.join(options.outputDir || './output', env);
    const initialDomain = new URL(url).hostname.replace(/\./g, '-');
    const screenshotsDir = path.join(baseOutputDir, 'screenshots', initialDomain);

    const limit = parseInt(options.limit, 10) || 50;
    const maxDepth = parseInt(options.depth, 10) || 1;
    const concurrency = parseInt(options.concurrency, 10) || 1;
    const epochs = parseInt(options.epochs, 10) || 1;

    console.log(`\n[TestMaker] Target: ${url}`);
    console.log(`[TestMaker] Mode: Sequential Crawl (Depth: ${maxDepth}, Limit: ${limit}, Epochs: ${epochs})`);

    const config: ScraperConfig = {
        url,
        depth: maxDepth,
        limit,
        headless: options.headless,
        force: options.force,
        username: username,
        password: password,
        quiet: options.quiet,
        resume: options.resume
    };

    // Handle Ctrl+C gracefully
    let currentRunner: Runner | null = null;
    const abortHandler = async () => {
        console.log('\n[TestMaker] Interrupted! Saving results...');
        if (currentRunner) await currentRunner.stop();
        process.exit();
    };
    process.on('SIGINT', abortHandler);

    for (let i = 1; i <= epochs; i++) {
        if (epochs > 1) {
            console.log(`\n=== EPOCH ${i} / ${epochs} STARTING ===`);
        }

        const runner = new Runner(config, screenshotsDir, concurrency);
        currentRunner = runner;

        try {
            await runner.start();
            await runner.stop(); // Ensure cleanup between epochs
        } catch (e) {
            console.error(`[TestMaker] Epoch ${i} Error:`, e);
        }

        currentRunner = null;

        if (i < epochs) {
            console.log('[TestMaker] Cooling down 5s before next epoch...');
            await new Promise(r => setTimeout(r, 5000));
        }
    }

    process.off('SIGINT', abortHandler);

    // [Step 2] Auto-run Consistency Validator
    try {
        console.log('\n[TestMaker] Generating Consistency Report...');
        const stdioMode = options.quiet ? 'ignore' : 'inherit';
        const tsxPath = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
        spawnSync('node', [tsxPath, 'scripts/validator.ts', '--env', env], {
            stdio: stdioMode as any,
            windowsHide: true,
            shell: false
        });
    } catch (e) {
        console.error('[TestMaker] Failed to generate consistency report:', e);
    }
}
