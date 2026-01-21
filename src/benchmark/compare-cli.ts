#!/usr/bin/env tsx
/**
 * Benchmark Comparison CLI
 * 
 * Stage 환경에서 Before/After 비교 테스트 실행
 * 
 * Usage:
 *   npm run benchmark -- --url "https://stage.ianai.co"
 *   npm run benchmark -- --url "https://stage.ianai.co" --weights output/learning/analysis-xxx.json
 */

import { BenchmarkRunner } from './BenchmarkRunner.js';
import { LearningWeightLoader } from './LearningWeightLoader.js';
import * as path from 'path';

interface BenchmarkOptions {
    url: string;
    weights?: string;
    depth: number;
    limit: number;
    timeout: number;
    headless: boolean;
    output: string;
}

function parseArgs(): BenchmarkOptions {
    const args = process.argv.slice(2);
    const options: BenchmarkOptions = {
        url: 'https://stage.ianai.co',
        depth: 3,
        limit: 50,
        timeout: 10,
        headless: true,
        output: 'output/benchmark'
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--url':
                options.url = args[++i];
                break;
            case '--weights':
                options.weights = args[++i];
                break;
            case '--depth':
                options.depth = parseInt(args[++i], 10);
                break;
            case '--limit':
                options.limit = parseInt(args[++i], 10);
                break;
            case '--timeout':
                options.timeout = parseInt(args[++i], 10);
                break;
            case '--headless':
                options.headless = args[++i] !== 'false';
                break;
            case '--output':
                options.output = args[++i];
                break;
            case '--help':
            case '-h':
                printHelp();
                process.exit(0);
        }
    }

    return options;
}

function printHelp() {
    console.log(`
📊 Benchmark Comparison Tool

Usage:
  npm run benchmark -- [options]

Options:
  --url <url>       Target URL (default: https://stage.ianai.co)
  --weights <path>  Path to learning analysis JSON (optional)
  --depth <n>       Max exploration depth (default: 3)
  --limit <n>       Max pages to explore (default: 50)
  --timeout <min>   Timeout in minutes (default: 10)
  --headless        Run headless (default: true)
  --output <dir>    Output directory (default: output/benchmark)
  --help, -h        Show this help

Examples:
  # Quick comparison with auto-detected weights
  npm run benchmark -- --url "https://stage.ianai.co"

  # Specify weights file
  npm run benchmark -- --url "https://stage.ianai.co" --weights output/learning/analysis-xxx.json
`);
}

async function main() {
    const options = parseArgs();

    console.log(`
╔═══════════════════════════════════════════════════╗
║       📊 Benchmark Comparison Tool                ║
╠═══════════════════════════════════════════════════╣
║  Target: ${options.url.padEnd(40)} ║
║  Depth:  ${options.depth.toString().padEnd(40)} ║
║  Limit:  ${options.limit.toString().padEnd(40)} ║
╚═══════════════════════════════════════════════════╝
`);

    const runner = new BenchmarkRunner(options.output);

    // 1. 가중치 로드 (지정 또는 자동 탐지)
    let weightsPath = options.weights;
    if (!weightsPath) {
        const latestWeights = LearningWeightLoader.loadLatest('output/learning');
        if (latestWeights) {
            console.log('✅ Auto-detected latest learning weights');
            // 자동 탐지된 경우 경로를 찾아서 설정
            const fs = await import('fs');
            const files = fs.readdirSync('output/learning')
                .filter((f: string) => f.startsWith('analysis-') && f.endsWith('.json'))
                .sort()
                .reverse();
            if (files.length > 0) {
                weightsPath = path.join('output/learning', files[0]);
            }
        } else {
            console.log('⚠️  No learning weights found - will run baseline only');
        }
    }

    if (weightsPath) {
        console.log(`📁 Using weights: ${weightsPath}\n`);
    }

    const runOptions = {
        depth: options.depth,
        limit: options.limit,
        timeout: options.timeout,
        headless: options.headless,
        outputDir: options.output
    };

    try {
        // 2. Baseline 실행
        console.log('━'.repeat(50));
        const baseline = await runner.runBaseline(options.url, runOptions);
        console.log(`   Baseline complete: ${baseline.discoveredLinks} links found`);

        // 3. Learned 실행 (가중치가 있는 경우만)
        if (weightsPath) {
            console.log('━'.repeat(50));
            const learned = await runner.runWithLearning(options.url, weightsPath, runOptions);
            console.log(`   Learned complete: ${learned.discoveredLinks} links found`);

            // 4. 비교 리포트 생성
            const report = runner.compareResults(baseline, learned);
            console.log(report.summary);

            // 5. 리포트 저장
            runner.saveReport(report);
        } else {
            console.log('\n⚠️  Skipping learned scan - no weights available');
            console.log(`   Baseline result: ${baseline.discoveredLinks} links found`);
        }

        console.log('\n✅ Benchmark complete!');

    } catch (error) {
        console.error('\n❌ Benchmark failed:', error);
        process.exit(1);
    }
}

main().catch(console.error);
