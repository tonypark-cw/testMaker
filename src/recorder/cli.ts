#!/usr/bin/env node
/**
 * Recorder CLI
 * Opens a browser for manual session recording to capture user actions.
 * 
 * Usage:
 *   npm run record -- --url "https://dev.ianai.co"
 *   npm run record -- --url "https://dev.ianai.co" --output ./output/recordings
 */

import { Recorder } from './index.js';

interface RecordOptions {
    url: string;
    output: string;
}

function parseArgs(): RecordOptions {
    const args = process.argv.slice(2);
    const options: RecordOptions = {
        url: '',
        output: './output/dev/recordings'
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const next = args[i + 1];

        switch (arg) {
            case '--url':
            case '-u':
                options.url = next || '';
                i++;
                break;
            case '--output':
            case '-o':
                options.output = next || options.output;
                i++;
                break;
            case '--help':
            case '-h':
                console.log(`
Recorder CLI - Capture user actions for Imitation Learning

Usage:
  npm run record -- --url <URL> [options]

Options:
  --url, -u <URL>       Target URL to record (required)
  --output, -o <DIR>    Output directory for recordings (default: ./output/dev/recordings)
  --help, -h            Show this help message

Examples:
  npm run record -- --url "https://dev.ianai.co"
  npm run record -- --url "https://stage.ianai.co" --output ./output/stage/recordings
`);
                process.exit(0);
        }
    }

    return options;
}

async function main() {
    const options = parseArgs();

    if (!options.url) {
        console.error('❌ Error: --url is required');
        console.error('   Usage: npm run record -- --url "https://example.com"');
        process.exit(1);
    }

    console.log(`
🎬 TestMaker Recorder
   URL: ${options.url}
   Output: ${options.output}

📋 Instructions:
   1. Browser will open with the target URL
   2. Perform your test scenario manually
   3. Press Ctrl+C in this terminal to stop and save

`);

    const recorder = new Recorder(options.output);

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n\n⏹️  Stopping recorder...');
        recorder.saveSession();
        console.log('✅ Session saved!');
        process.exit(0);
    });

    try {
        await recorder.start(options.url);
    } catch (e) {
        console.error('❌ Recorder error:', e);
        process.exit(1);
    }
}

main().catch(console.error);
