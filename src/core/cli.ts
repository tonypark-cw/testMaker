import { program } from 'commander';
import { Runner } from './runner.js';
import { ScraperConfig } from './types.js';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { execSync } from 'child_process';

dotenv.config();

program
    .name('test-maker')
    .description('Automated Test Search Tool (Multi-Tab Parallel)')
    .version('2.0.0');

program
    .option('--url <url>', 'URL to analyze', process.env.TESTMAKER_URL)
    .option('--output-dir <path>', 'Output directory', './output')
    .option('--depth <number>', 'Maximum exploration depth', '1')
    .option('--limit <number>', 'Maximum number of pages', '50')
    .option('--concurrency <number>', 'Number of parallel tabs', '1')
    .option('--format <format>', 'Output format: markdown | playwright | both', 'both')
    .option('--screenshots', 'Include screenshots', true)
    .option('--auth-file <path>', 'Initial auth file', process.env.TESTMAKER_AUTH_FILE)
    .option('--username <user>', 'Username (auto-detects dev/stage)', process.env.EMAIL)
    .option('--password <pass>', 'Password (auto-detects dev/stage)', process.env.PASSWORD)
    .option('--force', 'Force re-search', false)
    .option('--headless', 'Run in headless mode', false)
    .option('--no-headless', 'Run in visible mode')
    .option('--quiet', 'Suppress console logs (Agent mode)', false)
    .option('--epochs <number>', 'Number of sequential epochs', '1');

program.action(async (options) => {
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
        quiet: options.quiet
    };

    // Handle Ctrl+C gracefully (Shared handler)
    let currentRunner: Runner | null = null;
    process.on('SIGINT', async () => {
        console.log('\n[TestMaker] Interrupted! Saving results...');
        if (currentRunner) await currentRunner.stop();
        process.exit();
    });

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
            // Don't exit process, try next epoch? Or fail hard?
            // Recovery strategy: Try next epoch
        }

        currentRunner = null;

        // Small cooldown between epochs
        if (i < epochs) {
            console.log('[TestMaker] Cooling down 5s before next epoch...');
            await new Promise(r => setTimeout(r, 5000));
        }
    }

    // [Step 2] Auto-run Consistency Validator
    try {
        console.log('\n[TestMaker] Generating Consistency Report...');
        const stdioMode = options.quiet ? 'ignore' : 'inherit';
        execSync(`npx tsx scripts/validator.ts --env ${env}`, { stdio: stdioMode });
    } catch (e) {
        console.error('[TestMaker] Failed to generate consistency report:', e);
    }
});

program.parse();
