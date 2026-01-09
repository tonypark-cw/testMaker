import { program } from 'commander';
import { Runner } from './runner.js';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { ScraperConfig } from './types.js';

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
    .option('--concurrency <number>', 'Number of parallel tabs', '3')
    .option('--format <format>', 'Output format: markdown | playwright | both', 'both')
    .option('--screenshots', 'Include screenshots', true)
    .option('--auth-file <path>', 'Initial auth file', process.env.TESTMAKER_AUTH_FILE)
    .option('--username <user>', 'Username', process.env.emailname)
    .option('--password <pass>', 'Password', process.env.password)
    .option('--force', 'Force re-analysis', false)
    .option('--headless', 'Run in headless mode', true)
    .option('--no-headless', 'Run in visible mode');

program.action(async (options) => {
    const url = options.url || process.env.TESTMAKER_URL;
    if (!url) {
        console.error('Error: URL is required.');
        process.exit(1);
    }

    const baseOutputDir = options.outputDir || './output';
    const initialDomain = new URL(url).hostname.replace(/\./g, '-');
    const screenshotsDir = path.join(baseOutputDir, 'screenshots', initialDomain);

    const limit = parseInt(options.limit, 10) || 50;
    const maxDepth = parseInt(options.depth, 10) || 1;
    const concurrency = parseInt(options.concurrency, 10) || 3;

    console.log(`\n[TestMaker] Target: ${url}`);
    console.log(`[TestMaker] Mode: Multi-Tab Parallel (Depth: ${maxDepth}, Limit: ${limit}, Threads: ${concurrency})`);

    const config: ScraperConfig = {
        url,
        depth: maxDepth,
        limit,
        headless: options.headless,
        force: options.force,
        username: options.username,
        password: options.password
    };

    const runner = new Runner(config, screenshotsDir, concurrency);

    // Handle Ctrl+C gracefully
    process.on('SIGINT', async () => {
        console.log('\n[TestMaker] Interrupted! Savings results...');
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
