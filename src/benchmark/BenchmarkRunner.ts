/**
 * BenchmarkRunner
 * 
 * Before/After 비교를 위한 Scraper 실행 및 결과 측정
 */

import * as fs from 'fs';
import * as path from 'path';
import { Runner } from '../scraper/runner.js';
import { ScraperConfig } from '../shared/types.js';
import { LearningWeightLoader, LearningWeights } from './LearningWeightLoader.js';
import * as dotenv from 'dotenv';

dotenv.config();

export interface BenchmarkResult {
    mode: 'baseline' | 'learned';
    discoveredLinks: number;
    interactions: number;
    uniquePages: Set<string>;
    screenshotsCaptured: number;
    duration: number;  // milliseconds
    timestamp: string;
}

export interface ComparisonReport {
    baseline: BenchmarkResult;
    learned: BenchmarkResult;
    improvement: {
        linksChange: number;      // percentage
        interactionsChange: number;
        pagesChange: number;
        durationChange: number;
    };
    summary: string;
}

export interface RunOptions {
    depth?: number;
    limit?: number;
    timeout?: number;  // minutes
    headless?: boolean;
    outputDir?: string;
}

export class BenchmarkRunner {
    private outputDir: string;
    private learningWeights?: LearningWeights;

    constructor(outputDir: string = 'output/benchmark') {
        this.outputDir = path.resolve(outputDir);
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    /**
     * 기준선 (Baseline) 스캔 실행 - 학습 가중치 없이
     */
    async runBaseline(url: string, options: RunOptions = {}): Promise<BenchmarkResult> {
        console.log('\n📊 [Benchmark] Running BASELINE scan (no learning weights)...');
        return this.runScan(url, 'baseline', undefined, options);
    }

    /**
     * 학습 적용 스캔 실행 - Imitation Learning 가중치 적용
     */
    async runWithLearning(
        url: string,
        weightsPath: string,
        options: RunOptions = {}
    ): Promise<BenchmarkResult> {
        console.log('\n📊 [Benchmark] Running LEARNED scan (with priority weights)...');
        const weights = LearningWeightLoader.load(weightsPath);
        console.log(`   Loaded ${Object.keys(weights.priorityWeights).length} priority weights`);
        console.log(`   Loaded ${weights.pagePatterns.length} page patterns`);
        this.learningWeights = weights;
        return this.runScan(url, 'learned', weights, options);
    }

    /**
     * 스캔 실행 - Runner를 사용하여 실제 탐색 수행
     */
    private async runScan(
        url: string,
        mode: 'baseline' | 'learned',
        weights?: LearningWeights,
        options: RunOptions = {}
    ): Promise<BenchmarkResult> {
        const startTime = Date.now();

        // 환경 감지 및 자격 증명 설정
        const isDev = url.includes('dev.ianai.co');
        const username = isDev && process.env.DEV_EMAIL
            ? process.env.DEV_EMAIL
            : process.env.EMAIL;
        const password = isDev && process.env.DEV_PASSWORD
            ? process.env.DEV_PASSWORD
            : process.env.PASSWORD;

        // 모드별 출력 디렉토리 분리
        const modeOutputDir = path.join(this.outputDir, mode);
        if (!fs.existsSync(modeOutputDir)) {
            fs.mkdirSync(modeOutputDir, { recursive: true });
        }

        // ScraperConfig 구성 (기존 Runner 인터페이스와 호환)
        const config: ScraperConfig = {
            url,
            depth: options.depth || 2,
            limit: options.limit || 50,
            headless: options.headless !== undefined ? options.headless : true,
            force: true, // 벤치마크에서는 항상 새로 스캔
            username,
            password,
            quiet: false
        };

        // learning weights를 환경변수로 전달 (임시 방안)
        if (weights) {
            process.env.BENCHMARK_LEARNING_WEIGHTS = JSON.stringify(weights.priorityWeights);
        } else {
            delete process.env.BENCHMARK_LEARNING_WEIGHTS;
        }

        const runner = new Runner(config, modeOutputDir, 1);

        try {
            await runner.start();
        } catch (e) {
            console.error(`[Benchmark] Scan failed: ${e}`);
        }

        // 결과 수집 (output 디렉토리에서 분석)
        const result: BenchmarkResult = {
            mode,
            discoveredLinks: this.countDiscoveredLinks(modeOutputDir),
            interactions: this.countInteractions(modeOutputDir),
            uniquePages: this.getUniquePages(modeOutputDir),
            screenshotsCaptured: this.countScreenshots(modeOutputDir),
            duration: Date.now() - startTime,
            timestamp: new Date().toISOString()
        };

        return result;
    }

    /**
     * output 디렉토리에서 발견된 링크 수 계산
     */
    private countDiscoveredLinks(outputDir: string): number {
        const cacheFile = path.join(outputDir, 'visited_urls.json');
        if (fs.existsSync(cacheFile)) {
            const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
            return Array.isArray(data) ? data.length : 0;
        }
        return 0;
    }

    /**
     * 상호작용 횟수 계산 (action_chain 파일들에서)
     */
    private countInteractions(outputDir: string): number {
        const actionsDir = path.join(outputDir, 'actions');
        if (!fs.existsSync(actionsDir)) return 0;

        let total = 0;
        const files = fs.readdirSync(actionsDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(actionsDir, file), 'utf-8'));
                total += Array.isArray(data) ? data.length : 0;
            } catch { /* ignore */ }
        }
        return total;
    }

    /**
     * 고유 페이지 경로 수집
     */
    private getUniquePages(outputDir: string): Set<string> {
        const pages = new Set<string>();
        const cacheFile = path.join(outputDir, 'visited_urls.json');
        if (fs.existsSync(cacheFile)) {
            const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
            if (Array.isArray(data)) {
                for (const url of data) {
                    try {
                        const pathname = new URL(url).pathname;
                        pages.add(pathname);
                    } catch { /* ignore */ }
                }
            }
        }
        return pages;
    }

    /**
     * 스크린샷 수 계산
     */
    private countScreenshots(outputDir: string): number {
        const screenshotsDir = path.join(outputDir, 'screenshots');
        if (!fs.existsSync(screenshotsDir)) return 0;

        const countPngs = (dir: string): number => {
            let count = 0;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.isDirectory()) {
                    count += countPngs(path.join(dir, entry.name));
                } else if (entry.name.endsWith('.png')) {
                    count++;
                }
            }
            return count;
        };

        return countPngs(screenshotsDir);
    }

    /**
     * Before/After 결과 비교 리포트 생성
     */
    compareResults(baseline: BenchmarkResult, learned: BenchmarkResult): ComparisonReport {
        const calcChange = (before: number, after: number): number => {
            if (before === 0) return after > 0 ? 100 : 0;
            return ((after - before) / before) * 100;
        };

        const report: ComparisonReport = {
            baseline,
            learned,
            improvement: {
                linksChange: calcChange(baseline.discoveredLinks, learned.discoveredLinks),
                interactionsChange: calcChange(baseline.interactions, learned.interactions),
                pagesChange: calcChange(baseline.uniquePages.size, learned.uniquePages.size),
                durationChange: calcChange(baseline.duration, learned.duration)
            },
            summary: ''
        };

        // 요약 생성
        const linksSymbol = report.improvement.linksChange >= 0 ? '↑' : '↓';
        const pagesSymbol = report.improvement.pagesChange >= 0 ? '↑' : '↓';

        report.summary = `
📊 Benchmark Comparison Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              | Baseline | Learned |    Δ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Links         |    ${baseline.discoveredLinks.toString().padStart(4)}   |   ${learned.discoveredLinks.toString().padStart(4)}  | ${linksSymbol}${Math.abs(report.improvement.linksChange).toFixed(1)}%
Interactions  |    ${baseline.interactions.toString().padStart(4)}   |   ${learned.interactions.toString().padStart(4)}  | ${report.improvement.interactionsChange >= 0 ? '↑' : '↓'}${Math.abs(report.improvement.interactionsChange).toFixed(1)}%
Pages         |    ${baseline.uniquePages.size.toString().padStart(4)}   |   ${learned.uniquePages.size.toString().padStart(4)}  | ${pagesSymbol}${Math.abs(report.improvement.pagesChange).toFixed(1)}%
Duration      | ${this.formatDuration(baseline.duration)} | ${this.formatDuration(learned.duration)} | ${report.improvement.durationChange >= 0 ? '↑' : '↓'}${Math.abs(report.improvement.durationChange).toFixed(1)}%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

        return report;
    }

    /**
     * 리포트를 파일로 저장
     */
    saveReport(report: ComparisonReport): string {
        const filename = `comparison-${Date.now()}.json`;
        const filepath = path.join(this.outputDir, filename);

        // Set을 배열로 변환하여 JSON으로 저장 가능하게
        const serializable = {
            ...report,
            baseline: {
                ...report.baseline,
                uniquePages: Array.from(report.baseline.uniquePages)
            },
            learned: {
                ...report.learned,
                uniquePages: Array.from(report.learned.uniquePages)
            }
        };

        fs.writeFileSync(filepath, JSON.stringify(serializable, null, 2));
        console.log(`\n📁 Report saved: ${filepath}`);
        return filepath;
    }

    private formatDuration(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes}m ${secs.toString().padStart(2, '0')}s`;
    }
}
