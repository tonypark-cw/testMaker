import { program } from 'commander';
import { Runner } from './runner.js';
import { ScraperConfig } from './types.js';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

program
    .name('test-maker')
    .description('Automated Test Analysis Tool (Multi-Tab Parallel)')
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
    .option('--force', 'Force re-analysis', false)
    .option('--headless', 'Run in headless mode', true)
    .option('--no-headless', 'Run in visible mode');

program.action(async (options) => {
    const url = options.url || process.env.TESTMAKER_URL;
    if (!url) {
        console.error('Error: URL is required.');
        process.exit(1);
    }

    // Auto-detect dev vs stage credentials
    const isDev = url.includes('dev.ianai.co');
    const username = isDev && process.env.DEV_EMAIL ? process.env.DEV_EMAIL : (options.username || process.env.EMAIL);
    const password = isDev && process.env.DEV_PASSWORD ? process.env.DEV_PASSWORD : (options.password || process.env.PASSWORD);

    console.log(`[TestMaker] Environment: ${isDev ? 'DEV' : 'STAGE/PROD'}`);
    if (username) console.log(`[TestMaker] Using credentials for: ${username}`);

    const baseOutputDir = options.outputDir || './output';
    const initialDomain = new URL(url).hostname.replace(/\./g, '-');
    const screenshotsDir = path.join(baseOutputDir, 'screenshots', initialDomain);

    const limit = parseInt(options.limit, 10) || 50;
    const maxDepth = parseInt(options.depth, 10) || 1;
    const concurrency = parseInt(options.concurrency, 10) || 1; // Default to 1 for session sharing

    console.log(`\n[TestMaker] Target: ${url}`);
    console.log(`[TestMaker] Mode: Sequential Crawl (Depth: ${maxDepth}, Limit: ${limit})`);

    const config: ScraperConfig = {
        url,
        depth: maxDepth,
        limit,
        headless: options.headless,
        force: options.force,
        username: username,
        password: password
    };

    const runner = new Runner(config, screenshotsDir, concurrency);

    // Handle Ctrl+C gracefully
    process.on('SIGINT', async () => {
        console.log('\n[TestMaker] Interrupted! Saving results...');
        await runner.stop();
        process.exit();
    });

    try {
        await runner.start();
    } catch (e) {
        console.error('[TestMaker] Fatal Error:', e);
        process.exit(1);
    }
});

program.parse();
