import { program } from 'commander';
import { Scraper } from './scraper.js';
import { Analyzer } from '../scripts/analyzer.js';
import { Generator } from '../scripts/generator.js';
import { AnalysisResult } from '../types/index.js';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

program
    .name('test-maker')
    .description('Automated Test Analysis Tool')
    .version('1.0.0');

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

    const visited = new Set<string>();
    const queue: { url: string; depth: number }[] = [{ url, depth: 0 }];
    const tempAuthFile = path.join(baseOutputDir, 'temp-auth.json');

    let analyzedCount = 0;
    let skippedCount = 0;

    try {
        while (queue.length > 0) {
            const current = queue.shift()!;
            const { url: currentUrl, depth: currentDepth } = current;

            if (visited.has(currentUrl)) continue;
            visited.add(currentUrl);

            console.log(`\n[TestMaker] --- [D${currentDepth}] Analyzing: ${currentUrl} ---`);

            const urlParsed = new URL(currentUrl);
            const pageDomain = urlParsed.hostname.replace(/\./g, '-');
            const urlPathName = urlParsed.pathname.replace(/\//g, '-').replace(/^-|-$/g, '') || 'index';
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

            const scrapeResult = await scraper.scrape({
                url: currentUrl,
                outputDir: path.join(baseOutputDir, 'screenshots', pageDomain),
                authFile: fs.existsSync(tempAuthFile) ? tempAuthFile : options.authFile,
                saveAuthFile: tempAuthFile,
                username: options.username,
                password: options.password,
                screenshotName: `screenshot-${urlPathName}.png`,
                headless: options.headless
            });

            const { elements, pageTitle, discoveredLinks, sidebarLinks } = scrapeResult as any;

            console.log(`[TestMaker] Found ${sidebarLinks?.length || 0} sidebar links, ${discoveredLinks?.length || 0} other links`);
            if (sidebarLinks?.length > 0) {
                console.log(`[TestMaker] Sidebar: ${sidebarLinks.slice(0, 5).join(', ')}${sidebarLinks.length > 5 ? '...' : ''}`);
            }

            if (options.recursive) {
                const nextDepth = currentDepth + 1;
                // Prioritize sidebar links, add all discovered links regardless of depth
                // Gather all links: Sidebar + Discovered + Modal Links
                const modalLinks = (scrapeResult as any).modalDiscoveries ? (scrapeResult as any).modalDiscoveries.flatMap((m: any) => m.links || []) : [];
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
            if (options.recursive && visited.size >= limit) break;
            await new Promise(r => setTimeout(r, 500));
        }

        console.log(`\n[TestMaker] Finished. Analyzed: ${analyzedCount}, Cached: ${skippedCount}`);
    } catch (e) {
        console.error('[TestMaker] Fatal Error:', e);
        process.exit(1);
    } finally {
        await scraper.close();
    }
});

program.parse();
