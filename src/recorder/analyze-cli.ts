#!/usr/bin/env node
/**
 * Analyze CLI
 * Analyzes recorded sessions to extract patterns for Imitation Learning.
 * 
 * Usage:
 *   npm run analyze:session -- --session ./output/recordings/sessions/session-xxx.json
 *   npm run analyze:session -- --all
 */

import * as fs from 'fs';
import * as path from 'path';
import { PatternAnalyzer } from './PatternAnalyzer.js';

interface AnalyzeOptions {
    session?: string;
    all: boolean;
    outputDir: string;
}

function parseArgs(): AnalyzeOptions {
    const args = process.argv.slice(2);
    const options: AnalyzeOptions = {
        all: false,
        outputDir: './output/learning'
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const next = args[i + 1];

        switch (arg) {
            case '--session':
            case '-s':
                options.session = next;
                i++;
                break;
            case '--all':
            case '-a':
                options.all = true;
                break;
            case '--output':
            case '-o':
                options.outputDir = next || options.outputDir;
                i++;
                break;
            case '--help':
            case '-h':
                console.log(`
Analyze CLI - Extract patterns from recorded sessions

Usage:
  npm run analyze:session -- --session <FILE>   Analyze a single session
  npm run analyze:session -- --all              Analyze all sessions in recordings folder

Options:
  --session, -s <FILE>   Path to session JSON file
  --all, -a              Analyze all sessions in ./output/recordings/sessions/
  --output, -o <DIR>     Output directory (default: ./output/learning)
  --help, -h             Show this help message

Examples:
  npm run analyze:session -- --session ./output/recordings/sessions/session-123.json
  npm run analyze:session -- --all
`);
                process.exit(0);
        }
    }

    return options;
}

async function main() {
    const options = parseArgs();
    const analyzer = new PatternAnalyzer(options.outputDir);

    if (options.all) {
        const sessionsDir = './output/recordings/sessions';
        if (!fs.existsSync(sessionsDir)) {
            console.error(`❌ Sessions directory not found: ${sessionsDir}`);
            process.exit(1);
        }

        const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
        console.log(`📂 Found ${files.length} session files\n`);

        for (const file of files) {
            const sessionPath = path.join(sessionsDir, file);
            try {
                analyzer.analyze(sessionPath);
            } catch (e) {
                console.error(`❌ Failed to analyze ${file}:`, e);
            }
        }
    } else if (options.session) {
        if (!fs.existsSync(options.session)) {
            console.error(`❌ Session file not found: ${options.session}`);
            process.exit(1);
        }
        analyzer.analyze(options.session);
    } else {
        console.error('❌ Error: --session or --all is required');
        console.error('   Usage: npm run analyze:session -- --session <FILE>');
        process.exit(1);
    }
}

main().catch(console.error);
