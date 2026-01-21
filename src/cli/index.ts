import { program } from 'commander';
import * as dotenv from 'dotenv';
import { searchAction } from './commands/search.js';
import { recordAction } from './commands/record.js';

dotenv.config();

program
    .name('test-maker')
    .description('Automated Test Search Tool (Multi-Tab Parallel)')
    .version('2.0.0');

program
    .command('search')
    .alias('s')
    .description('Run automated search exploration')
    .option('--url <url>', 'URL to search', process.env.TESTMAKER_URL)
    .option('--output-dir <path>', 'Output directory', './output')
    .option('--depth <number>', 'Maximum exploration depth', '1')
    .option('--limit <number>', 'Maximum number of pages', '50')
    .option('--concurrency <number>', 'Number of parallel tabs', '1')
    .option('--format <format>', 'Output format: markdown | playwright | both', 'both')
    .option('--no-screenshots', 'Disable screenshots')
    .option('--auth-file <path>', 'Initial auth file', process.env.TESTMAKER_AUTH_FILE)
    .option('--username <user>', 'Username (auto-detects dev/stage)', process.env.EMAIL)
    .option('--password <pass>', 'Password (auto-detects dev/stage)', process.env.PASSWORD)
    .option('--force', 'Force re-search', false)
    .option('--headless', 'Run in headless mode', false)
    .option('--no-headless', 'Run in visible mode')
    .option('--quiet', 'Suppress console logs (Agent mode)', false)
    .option('--resume', 'Resume from last checkpoint', false)
    .option('--epochs <number>', 'Number of sequential epochs', '1')
    .action(searchAction);

program
    .command('record')
    .description('Record a manual test session for imitation learning')
    .option('--url <url>', 'URL to record', process.env.TESTMAKER_URL)
    .option('--output-dir <path>', 'Output directory for recordings', './recordings')
    .action(recordAction);

program.parse();
