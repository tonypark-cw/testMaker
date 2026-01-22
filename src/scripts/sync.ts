import { SyncService } from '../shared/network/SyncService.js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { program } from 'commander';

dotenv.config();

program
    .name('db-sync')
    .description('Manually synchronize local results to the remote database')
    .option('--env <env>', 'Environment (dev/stage/prod)', 'dev')
    .option('--url <url>', 'Base URL for the execution', process.env.TESTMAKER_URL)
    .option('--dir <path>', 'Custom JSON directory to sync')
    .action(async (options) => {
        const syncService = new SyncService();
        const env = options.env;
        const baseUrl = options.url;

        if (!baseUrl) {
            console.error('Error: --url or TESTMAKER_URL environment variable is required.');
            process.exit(1);
        }

        const domain = new URL(baseUrl).hostname.replace(/\./g, '-');
        const jsonDir = options.dir || path.join(process.cwd(), 'output', env, 'json', domain);

        console.log(`[Sync] Target Environment: ${env.toUpperCase()}`);
        console.log(`[Sync] Base URL: ${baseUrl}`);
        console.log(`[Sync] Target Directory: ${jsonDir}`);

        try {
            await syncService.syncDirectory(jsonDir, env, baseUrl);
        } catch (e) {
            console.error('[Sync] ❌ Fatal sync error:', e);
            process.exit(1);
        }
    });

program.parse();
