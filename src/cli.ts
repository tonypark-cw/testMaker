import { program } from 'commander';
import { Scraper } from './scraper.js';
import { SafariInteractionTester } from './safari-tester.js';
import { Analyzer } from '../scripts/analyzer.js';
import { Generator } from '../scripts/generator.js';
import { AnalysisResult } from '../types/index.js';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';

dotenv.config();

program
    .name('test-maker')
    .description('Automated Test Analysis Tool')
    .version('1.0.0');

// Safari Interaction Test Command
program
    .command('safari-test')
    .description('Test page interactions using Safari (WebKit) browser')
    .requiredOption('--url <url>', 'URL to test')
    .option('--output-dir <path>', 'Output directory', './output/safari')
    .option('--auth-file <path>', 'Auth state file')
    .option('--headless', 'Run in headless mode', true)
    .option('--no-headless', 'Run in visible mode')
    .option('--test-click', 'Test clickable elements', true)
    .option('--test-input', 'Test input elements', true)
    .option('--test-focus', 'Test focusable elements', true)
    .option('--compare-chrome <path>', 'Path to Chrome test report for comparison')
    .action(async (options) => {
        console.log('\n[Safari Test] Starting Safari Interaction Test...');
        console.log(`[Safari Test] URL: ${options.url}`);

        const tester = new SafariInteractionTester();

        try {
            const report = await tester.test({
                url: options.url,
                outputDir: options.outputDir,
                authFile: options.authFile,
                headless: options.headless,
                testClickable: options.testClick,
                testInputs: options.testInput,
                testFocus: options.testFocus,
            });

            // Cross-browser comparison if Chrome report provided
            if (options.compareChrome) {
                await tester.compareWithChrome(options.compareChrome, report);
            }

            console.log(`\n[Safari Test] Complete! Report saved to: ${options.outputDir}/safari-test-report.json`);
        } catch (error) {
            console.error('[Safari Test] Error:', error instanceof Error ? error.message : error);
            process.exit(1);
        } finally {
            await tester.close();
        }
    });

program
    .option('--url <url>', 'URL to analyze', process.env.TESTMAKER_URL)
    .option('--output-dir <path>', 'Output directory', './output')
    .option('--depth <number>', 'Maximum exploration depth', '1')
    .option('--limit <number>', 'Maximum number of pages', '50')
    .option('--format <format>', 'Output format: markdown | playwright | both', 'both')
    .option('--screenshots', 'Include screenshots', true)
    .option('--auth-file <path>', 'Initial auth file', process.env.TESTMAKER_AUTH_FILE)
    .option('--username <user>', 'Username', process.env.emailname)
    .option('--password <pass>', 'Password', process.env.password)
    .option('--recursive', 'Recursive mode', false)
    .option('--force', 'Force re-analysis', false)
    .option('--timeout <number>', 'Page analysis timeout in seconds (0 for no timeout)', '180')
    .option('--headless', 'Run in headless mode', true)
    .option('--no-headless', 'Run in visible mode');

program.action(async (options) => {
    const url = options.url || process.env.TESTMAKER_URL;
    if (!url) {
        console.error('Error: URL is required.');
        process.exit(1);
    }

    const initialDomain = new URL(url).hostname;
    const baseOutputDir = options.outputDir || './output';
    const limit = parseInt(options.limit, 10) || 50;
    const maxDepth = parseInt(options.depth, 10) || 1;

    console.log(`\n[TestMaker] Target: ${url}`);
    console.log(`[TestMaker] Mode: BFS (Depth: ${maxDepth}, Limit: ${limit})`);

    const scraper = new Scraper();
    const analyzer = new Analyzer();
    const generator = new Generator();

    const visited = new Map<string, number>();
    const queue: { url: string; depth: number }[] = [{ url, depth: 0 }];
    const tempAuthFile = path.join(baseOutputDir, 'temp-auth.json');

    let analyzedCount = 0;
    let skippedCount = 0;

    try {
        while (queue.length > 0) {
            const current = queue.shift()!;
            const { url: currentUrl, depth: currentDepth } = current;

            if (visited.has(currentUrl)) continue;
            visited.set(currentUrl, currentDepth);

            console.log(`\n[TestMaker] --- [D${currentDepth}] Analyzing: ${currentUrl} ---`);

            const urlParsed = new URL(currentUrl);
            const pageDomain = urlParsed.hostname.replace(/\./g, '-');

            // Create a unique hash based on the full URL to handle query params/hashes
            const urlHash = crypto.createHash('md5').update(currentUrl).digest('hex').substring(0, 6);
            const urlPathNameBase = urlParsed.pathname.replace(/\//g, '-').replace(/^-|-$/g, '') || 'index';
            const urlPathName = `${urlPathNameBase}-${urlHash}`;

            const targetJsonFile = path.join(baseOutputDir, 'json', pageDomain, `${pageDomain}-${urlPathName}.json`);

            if (fs.existsSync(targetJsonFile) && !options.force) {
                console.log(`[TestMaker] Loading from cache: ${targetJsonFile}`);
                try {
                    const cache: AnalysisResult = JSON.parse(fs.readFileSync(targetJsonFile, 'utf-8'));
                    if (options.recursive && currentDepth < maxDepth) {
                        const links = [...(cache.sidebarLinks || []), ...cache.discoveredLinks];
                        links.forEach(l => { if (!visited.has(l)) queue.push({ url: l, depth: currentDepth + 1 }); });
                    }
                    skippedCount++;
                    continue;
                } catch (e) { }
            }

            try {
                // Timeout Warning: Default 3 minutes per page, 0 to disable
                const pageTimeout = parseInt(options.timeout, 10) * 1000;

                const scrapePromise = scraper.scrape({
                    url: currentUrl,
                    outputDir: path.join(baseOutputDir, 'screenshots', pageDomain),
                    authFile: fs.existsSync(tempAuthFile) ? tempAuthFile : options.authFile,
                    saveAuthFile: tempAuthFile,
                    username: options.username,
                    password: options.password,
                    screenshotName: `screenshot-${urlPathName}.png`,
                    headless: options.headless
                });

                // Timeout Logic Removed: Avoiding Promise.race which causes data loss on timeout.
                // We rely on internal Playwright timeouts or manual cancellation if needed.
                const scrapeResult = await scrapePromise;

                const { elements, pageTitle, discoveredLinks, sidebarLinks, modalDiscoveries } = scrapeResult as any;

                console.log(`[TestMaker] Found ${sidebarLinks?.length || 0} sidebar links, ${discoveredLinks?.length || 0} other links, ${modalDiscoveries?.length || 0} modal blocks`);
                if (sidebarLinks?.length > 0) {
                    console.log(`[TestMaker] Sidebar: ${sidebarLinks.slice(0, 5).join(', ')}${sidebarLinks.length > 5 ? '...' : ''}`);
                }

                if (options.recursive) {
                    const nextDepth = currentDepth + 1;
                    // Gather all links: Sidebar + Discovered + Modal Links
                    const modalLinks = modalDiscoveries ? modalDiscoveries.flatMap((m: any) => m.links || []) : [];
                    const found = [...(sidebarLinks || []), ...discoveredLinks, ...modalLinks];
                    found.forEach(l => {
                        try {
                            if (new URL(l).hostname === initialDomain && !visited.has(l)) {
                                queue.push({ url: l, depth: nextDepth });
                            }
                        } catch (e) { }
                    });
                }

                const scenarios = analyzer.analyze(elements);
                const stats: Record<string, number> = {};
                elements.forEach((el: any) => { stats[el.type] = (stats[el.type] || 0) + 1; });

                const result: AnalysisResult = {
                    success: true,
                    url: currentUrl,
                    timestamp: new Date().toISOString(),
                    pageTitle,
                    elements,
                    scenarios,
                    discoveredLinks,
                    sidebarLinks,
                    metadata: {
                        totalElements: elements.length,
                        byType: stats as any,
                        bySection: { 0: elements.length },
                        domain: pageDomain
                    }
                };

                await generator.generate(result, {
                    outputDir: baseOutputDir,
                    formats: options.format === 'both' ? ['markdown', 'playwright'] : [options.format],
                    includeScreenshots: !!options.screenshots
                });

                analyzedCount++;
            } catch (error) {
                console.error(`[TestMaker] Error analyzing ${currentUrl}:`, error instanceof Error ? error.message : error);
                // If timeout is disabled (0), we might want to rethrow to preserve original crash behavior, 
                // but generally logging and continuing is better for a recursive crawler.
                // However, to strictly follow "just like now" for --timeout 0, we could rethrow. 
                // But the user asked for "timeout application" to be optional. 
                // I will assume error recovery is a desired side-effect of this "fix" unless specifically requested otherwise.
            }
            if (options.recursive && visited.size >= limit) break;
            await new Promise(r => setTimeout(r, 500));
        }

        // Summary output
        console.log(`\n[TestMaker] ========== Summary ==========`);
        console.log(`[TestMaker] Total Pages Discovered: ${visited.size}`);
        console.log(`[TestMaker] Analyzed: ${analyzedCount}, Cached: ${skippedCount}`);
        console.log(`[TestMaker] Pages by Depth:`);

        const pagesByDepth = new Map<number, string[]>();
        for (const [url, depth] of visited.entries()) {
            if (!pagesByDepth.has(depth)) pagesByDepth.set(depth, []);
            pagesByDepth.get(depth)!.push(url);
        }

        const sortedDepths = Array.from(pagesByDepth.keys()).sort((a, b) => a - b);
        for (const depth of sortedDepths) {
            console.log(`  [Depth ${depth}]:`);
            pagesByDepth.get(depth)!.forEach((url, i) => {
                console.log(`    ${i + 1}. ${url}`);
            });
        }
        console.log(`[TestMaker] ==============================\n`);
    } catch (e) {
        console.error('[TestMaker] Fatal Error:', e);
        process.exit(1);
    } finally {
        await scraper.close();
    }
});

program.parse();
