#!/usr/bin/env node
import { program } from 'commander';
import { chromium } from 'playwright';
import { BaselineManager } from './BaselineManager.js';
import { VisualComparator } from './VisualComparator.js';
import { ContentExtractor } from './ContentExtractor.js';
import { ContentComparator } from './ContentComparator.js';
import { AnomalyDetector } from './AnomalyDetector.js';
import { BaselineIntegrator } from './BaselineIntegrator.js';
import { BatchRunner } from './BatchRunner.js';
import * as fs from 'fs';
import * as path from 'path';

program
    .name('regression-test')
    .description('Visual + Content Regression Testing CLI')
    .version('1.0.0');

program
    .command('baseline')
    .description('Create baseline from existing screenshot')
    .requiredOption('--url <url>', 'URL to create baseline for')
    .option('--output <dir>', 'Output directory', './output')
    .option('--extract-content', 'Extract content for verification', true)
    .action(async (options) => {
        try {
            const manager = new BaselineManager(options.output);

            // Find existing screenshot
            const screenshotPath = findExistingScreenshot(options.url, options.output);
            if (!screenshotPath) {
                console.error(`❌ No screenshot found for URL: ${options.url}`);
                console.log('Expected location: output/{domain}/screenshots/{domain}/{page}.webp');
                process.exit(1);
            }

            console.log(`Found screenshot: ${screenshotPath}`);

            // Load metadata if exists
            const jsonPath = screenshotPath.replace(/screenshots\/[^/]+\//, 'screenshots/json/').replace('.webp', '.json');
            let metadata: any = {
                timestamp: fs.statSync(screenshotPath).mtime.toISOString(),
                pageTitle: 'Unknown',
                elementCount: 0
            };

            if (fs.existsSync(jsonPath)) {
                const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
                metadata = {
                    timestamp: jsonData.timestamp || metadata.timestamp,
                    pageTitle: jsonData.pageTitle || 'Unknown',
                    elementCount: jsonData.elements?.length || 0
                };
            }

            // Extract content if requested
            let content = null;
            if (options.extractContent) {
                console.log('📝 Extracting page content...');
                const browser = await chromium.launch({ headless: true });
                const page = await browser.newPage();
                await page.goto(options.url, { waitUntil: 'networkidle', timeout: 60000 });

                const extractor = new ContentExtractor();
                content = await extractor.extract(page);
                await browser.close();

                console.log(`   Tables: ${content.tables.length}`);
                console.log(`   Buttons: ${content.buttons.length}`);
                console.log(`   Inputs: ${content.inputs.length}`);
            }

            // Save as baseline
            const baseline = manager.saveBaseline(options.url, screenshotPath, metadata, content);

            console.log('✅ Baseline created successfully!');
            console.log(`   URL: ${baseline.url}`);
            console.log(`   Screenshot: ${baseline.screenshotPath}`);
            console.log(`   Page Title: ${baseline.metadata.pageTitle}`);
            console.log(`   Elements: ${baseline.metadata.elementCount}`);
            if (content) {
                console.log(`   Content: Saved`);
            }
        } catch (error) {
            console.error('❌ Error creating baseline:', error);
            process.exit(1);
        }
    });

program
    .command('test')
    .description('Run regression test against baseline')
    .requiredOption('--url <url>', 'URL to test')
    .option('--threshold <number>', 'Pixelmatch threshold (0-1)', '0.1')
    .option('--output <dir>', 'Output directory', './output')
    .option('--headless', 'Run in headless mode', true)
    .option('--visual-only', 'Only run visual comparison', false)
    .option('--content-only', 'Only run content comparison', false)
    .action(async (options) => {
        try {
            const manager = new BaselineManager(options.output);
            const comparator = new VisualComparator(parseFloat(options.threshold), options.output);

            // Find baseline
            const baseline = manager.findBaseline(options.url);
            if (!baseline) {
                console.error(`❌ No baseline found for URL: ${options.url}`);
                console.log('💡 Create a baseline first:');
                console.log(`   npm run regression:baseline -- --url ${options.url}`);
                process.exit(1);
            }

            console.log('🔍 Running regression test...');
            console.log(`   URL: ${options.url}`);
            console.log(`   Baseline: ${baseline.screenshotPath}`);

            const runVisual = !options.contentOnly;
            const runContent = !options.visualOnly;

            // Capture current page
            const browser = await chromium.launch({ headless: options.headless });
            const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

            await page.goto(options.url, { waitUntil: 'networkidle', timeout: 60000 });

            let visualDiff, contentDiff;

            // Visual comparison
            if (runVisual) {
                console.log('📸 Capturing current screenshot...');
                const currentPath = `/tmp/current_${Date.now()}.png`;
                await page.screenshot({ path: currentPath, fullPage: true, type: 'png' });

                console.log('⚖️  Comparing screenshots...');
                visualDiff = await comparator.compare(baseline.screenshotPath, currentPath, options.url);

                if (fs.existsSync(currentPath)) {
                    fs.unlinkSync(currentPath);
                }
            }

            // Content comparison
            if (runContent) {
                const baselineContent = manager.loadBaselineContent(options.url);
                if (baselineContent) {
                    console.log('📝 Comparing page content...');
                    const extractor = new ContentExtractor();
                    const currentContent = await extractor.extract(page);

                    const contentComparator = new ContentComparator();
                    contentDiff = contentComparator.compare(baselineContent, currentContent);
                } else {
                    console.log('⚠️  No baseline content found (skipping content comparison)');
                }
            }

            await browser.close();

            // Display results
            if (visualDiff) {
                console.log('\n📊 Visual Results:');
                console.log(`   Total Pixels: ${visualDiff.totalPixels.toLocaleString()}`);
                console.log(`   Diff Pixels: ${visualDiff.diffPixels.toLocaleString()}`);
                console.log(`   Diff Percentage: ${visualDiff.diffPercentage.toFixed(2)}%`);
                console.log(`   Status: ${visualDiff.status === 'PASS' ? '✅ PASS' : '❌ FAIL'}`);

                if (visualDiff.diffImagePath) {
                    console.log(`   Diff Image: ${visualDiff.diffImagePath}`);
                }
            }

            if (contentDiff) {
                console.log('\n📝 Content Results:');
                console.log(`   Page Title: ${contentDiff.pageTitle.match ? '✅' : '❌'} ${contentDiff.pageTitle.current}`);

                if (contentDiff.tables.added.length > 0) {
                    console.log(`   ➕ Tables Added: ${contentDiff.tables.added.length}`);
                }
                if (contentDiff.tables.removed.length > 0) {
                    console.log(`   ➖ Tables Removed: ${contentDiff.tables.removed.length}`);
                }
                if (contentDiff.tables.modified.length > 0) {
                    console.log(`   🔄 Tables Modified: ${contentDiff.tables.modified.length}`);
                    contentDiff.tables.modified.forEach(t => {
                        if (t.headerDiff.added.length > 0) {
                            console.log(`      - ${t.name}: +${t.headerDiff.added.length} cols (${t.headerDiff.added.join(', ')})`);
                        }
                        if (t.headerDiff.removed.length > 0) {
                            console.log(`      - ${t.name}: -${t.headerDiff.removed.length} cols (${t.headerDiff.removed.join(', ')})`);
                        }
                    });
                }

                if (contentDiff.buttons.added.length > 0) {
                    console.log(`   ➕ Buttons Added: ${contentDiff.buttons.added.join(', ')}`);
                }
                if (contentDiff.buttons.removed.length > 0) {
                    console.log(`   ➖ Buttons Removed: ${contentDiff.buttons.removed.join(', ')}`);
                }

                console.log(`   Similarity Score: ${contentDiff.score}%`);

                // Anomaly detection
                const anomalyDetector = new AnomalyDetector();
                const anomalyReport = anomalyDetector.detect(contentDiff);

                if (anomalyReport.issues.length > 0 || anomalyReport.severity !== 'INFO') {
                    console.log('\n🔍 Anomaly Detection:');
                    console.log(`   Severity: ${getSeverityIcon(anomalyReport.severity)} ${anomalyReport.severity}`);
                    console.log(`   Score: ${anomalyReport.score}/100`);

                    if (anomalyReport.issues.length > 0) {
                        console.log(`\n   Issues Found (${anomalyReport.issues.length}):`);
                        anomalyReport.issues.forEach((issue, idx) => {
                            const icon = issue.severity === 'CRITICAL' ? '🚨' : issue.severity === 'WARNING' ? '⚠️' : 'ℹ️';
                            console.log(`   ${icon} ${idx + 1}. ${issue.description}`);
                            console.log(`      Impact: ${issue.impact}`);
                        });
                    }

                    console.log(`\n   💡 ${anomalyReport.recommendation}`);
                }

                // Combined pass/fail (include anomaly)
                const visualPass = !visualDiff || visualDiff.status === 'PASS';
                const contentPass = !contentDiff || contentDiff.score >= 80;
                const anomalyPass = !anomalyReport || anomalyReport.severity !== 'CRITICAL';

                console.log(`\n${visualPass && contentPass && anomalyPass ? '✅' : '❌'} Overall: ${visualPass && contentPass && anomalyPass ? 'PASS' : 'FAIL'}`);

                process.exit(visualPass && contentPass && anomalyPass ? 0 : 1);
            } else {
                // No content diff - only visual
                const visualPass = !visualDiff || visualDiff.status === 'PASS';
                console.log(`\n${visualPass ? '✅' : '❌'} Overall: ${visualPass ? 'PASS' : 'FAIL'}`);
                process.exit(visualPass ? 0 : 1);
            }
        } catch (error) {
            console.error('❌ Error running regression test:', error);
            process.exit(1);
        }
    });

program
    .command('list')
    .description('List all baselines for a domain')
    .requiredOption('--domain <domain>', 'Domain to list baselines for')
    .option('--output <dir>', 'Output directory', './output')
    .action(async (options) => {
        try {
            const manager = new BaselineManager(options.output);
            const baselines = manager.listBaselines(options.domain);

            if (baselines.length === 0) {
                console.log(`No baselines found for domain: ${options.domain}`);
                process.exit(0);
            }

            console.log(`\n📋 Baselines for ${options.domain} (${baselines.length}):\n`);
            baselines.forEach((baseline, index) => {
                console.log(`${index + 1}. ${baseline.url}`);
                console.log(`   Screenshot: ${baseline.screenshotPath}`);
                console.log(`   Page: ${baseline.metadata.pageTitle}`);
                console.log(`   Elements: ${baseline.metadata.elementCount}`);
                console.log(`   Updated: ${baseline.metadata.timestamp}`);
                console.log('');
            });
        } catch (error) {
            console.error('❌ Error listing baselines:', error);
            process.exit(1);
        }
    });

program
    .command('init')
    .description('Register crawler output as regression baselines')
    .option('--url <url>', 'URL prefix to filter (e.g., https://dev.ianai.co/app/inventory)')
    .option('--output <dir>', 'Output directory', './output')
    .action(async (options) => {
        try {
            console.log('🔧 Baseline Integrator');
            console.log('');

            const integrator = new BaselineIntegrator(options.output);

            // Find crawler outputs
            const domains = integrator.findCrawlerOutputDirs();
            if (domains.length === 0) {
                console.log('❌ No crawler output found in output/stage/screenshots/');
                console.log('   Run the crawler first: npm run analyze -- --url <url>');
                process.exit(1);
            }

            console.log(`📁 Found crawler output for: ${domains.join(', ')}`);
            console.log('');

            // Register baselines
            console.log('📝 Registering baselines...');
            const result = await integrator.registerBaselines(options.url);

            console.log('');
            console.log('═══════════════════════════════════════');
            console.log('📊 REGISTRATION RESULT');
            console.log('═══════════════════════════════════════');
            console.log(`Total Pages:  ${result.totalPages}`);
            console.log(`✅ Registered: ${result.registered}`);
            console.log(`⏭️  Skipped:    ${result.skipped}`);
            console.log(`❌ Errors:     ${result.errors.length}`);

            if (result.errors.length > 0) {
                console.log('');
                console.log('Errors:');
                result.errors.forEach(e => console.log(`  - ${e}`));
            }

            console.log('');
            console.log('✅ Baselines registered! Run regression tests with:');
            if (options.url) {
                console.log(`   npm run regression -- --url "${options.url}"`);
            } else {
                console.log('   npm run regression -- --url "https://your-domain.com"');
            }
        } catch (error) {
            console.error('❌ Error:', error);
            process.exit(1);
        }
    });

program
    .command('run')
    .description('Run regression tests (single page or batch for URL prefix)')
    .requiredOption('--url <url>', 'URL to test (or URL prefix for batch mode)')
    .option('--threshold <number>', 'Pixelmatch threshold (0-1)', '0.1')
    .option('--output <dir>', 'Output directory', './output')
    .option('--headless', 'Run in headless mode', true)
    .option('--batch', 'Run batch mode for all pages under URL prefix', false)
    .option('--force-baseline', 'Force recreate baseline even if exists', false)
    .action(async (options) => {
        try {
            const manager = new BaselineManager(options.output);

            console.log('🔍 Regression Test Runner');
            console.log(`   URL: ${options.url}`);
            console.log('');

            // Check if batch mode or auto-detect
            const urlObj = new URL(options.url);
            const domain = urlObj.hostname;
            const baselines = manager.listBaselines(domain);
            const matchingBaselines = baselines.filter(b => b.url.startsWith(options.url));

            // Auto-detect batch mode: if URL matches multiple baselines
            const isBatchMode = options.batch || (matchingBaselines.length > 1 && !baselines.find(b => b.url === options.url));

            if (isBatchMode && matchingBaselines.length > 0) {
                // BATCH MODE
                console.log(`📦 Batch Mode: ${matchingBaselines.length} pages to test`);
                console.log('');

                const runner = new BatchRunner({
                    headless: options.headless,
                    threshold: parseFloat(options.threshold),
                    outputDir: options.output
                });

                const result = await runner.run(options.url, (current, total, url) => {
                    const shortUrl = url.replace(options.url, '...');
                    console.log(`   [${current}/${total}] ${shortUrl}`);
                });

                // Print report
                console.log('');
                console.log(runner.generateReport(result));

                process.exit(result.failed === 0 && result.errors === 0 ? 0 : 1);
            }

            // SINGLE PAGE MODE
            const comparator = new VisualComparator(parseFloat(options.threshold), options.output);

            // Step 1: Check for existing baseline
            let baseline = manager.findBaseline(options.url);

            if (!baseline || options.forceBaseline) {
                console.log('📸 Step 1: Creating baseline...');

                // Find existing screenshot or capture new one
                let screenshotPath = findExistingScreenshot(options.url, options.output);

                if (!screenshotPath) {
                    console.log('   Capturing new screenshot...');
                    const browser = await chromium.launch({ headless: options.headless });
                    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
                    await page.goto(options.url, { waitUntil: 'networkidle', timeout: 60000 });

                    screenshotPath = `/tmp/baseline_${Date.now()}.png`;
                    await page.screenshot({ path: screenshotPath, fullPage: true, type: 'png' });
                    await browser.close();
                }

                // Extract content
                console.log('   Extracting page content...');
                const browser = await chromium.launch({ headless: true });
                const page = await browser.newPage();
                await page.goto(options.url, { waitUntil: 'networkidle', timeout: 60000 });

                const extractor = new ContentExtractor();
                const content = await extractor.extract(page);

                const metadata = {
                    timestamp: new Date().toISOString(),
                    pageTitle: content.pageTitle || 'Unknown',
                    elementCount: content.buttons.length + content.inputs.length + content.tables.length
                };

                await browser.close();

                // Save baseline
                baseline = manager.saveBaseline(options.url, screenshotPath, metadata, content);
                console.log('   ✅ Baseline created!');
                console.log('');
            } else {
                console.log('📋 Step 1: Baseline exists');
                console.log(`   Created: ${baseline.metadata.timestamp}`);
                console.log('');
            }

            // Step 2: Capture current state and compare
            console.log('📸 Step 2: Capturing current state...');
            const browser = await chromium.launch({ headless: options.headless });
            const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
            await page.goto(options.url, { waitUntil: 'networkidle', timeout: 60000 });

            // Visual comparison
            const currentScreenshot = `/tmp/current_${Date.now()}.png`;
            await page.screenshot({ path: currentScreenshot, fullPage: true, type: 'png' });

            console.log('⚖️  Step 3: Comparing...');
            const visualDiff = await comparator.compare(baseline.screenshotPath, currentScreenshot, options.url);

            // Content comparison
            const baselineContent = manager.loadBaselineContent(options.url);
            let contentDiff = null;
            let anomalyReport = null;

            if (baselineContent) {
                const extractor = new ContentExtractor();
                const currentContent = await extractor.extract(page);

                const contentComparator = new ContentComparator();
                contentDiff = contentComparator.compare(baselineContent, currentContent);

                const anomalyDetector = new AnomalyDetector();
                anomalyReport = anomalyDetector.detect(contentDiff);
            }

            await browser.close();

            // Cleanup temp file
            if (fs.existsSync(currentScreenshot)) {
                fs.unlinkSync(currentScreenshot);
            }

            // Step 4: Display results
            console.log('');
            console.log('═══════════════════════════════════════');
            console.log('📊 RESULTS');
            console.log('═══════════════════════════════════════');

            // Visual results
            console.log('\n🖼️  Visual Comparison:');
            console.log(`   Diff: ${visualDiff.diffPercentage.toFixed(2)}%`);
            console.log(`   Status: ${visualDiff.status === 'PASS' ? '✅ PASS' : '❌ FAIL'}`);
            if (visualDiff.diffImagePath) {
                console.log(`   Diff Image: ${visualDiff.diffImagePath}`);
            }

            // Content results
            if (contentDiff) {
                console.log('\n📝 Content Comparison:');
                console.log(`   Similarity: ${contentDiff.score}%`);

                if (contentDiff.tables.removed.length > 0) {
                    console.log(`   ⚠️  Tables removed: ${contentDiff.tables.removed.length}`);
                }
                if (contentDiff.buttons.removed.length > 0) {
                    console.log(`   ⚠️  Buttons removed: ${contentDiff.buttons.removed.join(', ')}`);
                }
                if (contentDiff.inputs.removed.length > 0) {
                    console.log(`   ⚠️  Inputs removed: ${contentDiff.inputs.removed.length}`);
                }
            }

            // Anomaly results
            if (anomalyReport && anomalyReport.issues.length > 0) {
                console.log('\n🔍 Anomaly Detection:');
                console.log(`   Severity: ${getSeverityIcon(anomalyReport.severity)} ${anomalyReport.severity}`);
                console.log(`   Risk Score: ${anomalyReport.score}/100`);

                if (anomalyReport.issues.length > 0) {
                    console.log('\n   Issues:');
                    anomalyReport.issues.forEach((issue, idx) => {
                        const icon = issue.severity === 'CRITICAL' ? '🚨' : '⚠️';
                        console.log(`   ${icon} ${idx + 1}. ${issue.description}`);
                    });
                }

                console.log(`\n   💡 ${anomalyReport.recommendation}`);
            }

            // Final verdict
            const visualPass = visualDiff.status === 'PASS';
            const contentPass = !contentDiff || contentDiff.score >= 80;
            const anomalyPass = !anomalyReport || anomalyReport.severity !== 'CRITICAL';
            const overallPass = visualPass && contentPass && anomalyPass;

            console.log('\n═══════════════════════════════════════');
            console.log(`${overallPass ? '✅' : '❌'} OVERALL: ${overallPass ? 'PASS' : 'FAIL'}`);
            console.log('═══════════════════════════════════════');

            process.exit(overallPass ? 0 : 1);
        } catch (error) {
            console.error('❌ Error:', error);
            process.exit(1);
        }
    });

program.parse();

/**
 * Get severity icon for display
 */
function getSeverityIcon(severity: string): string {
    switch (severity) {
        case 'CRITICAL': return '🚨';
        case 'WARNING': return '⚠️';
        default: return 'ℹ️';
    }
}

/**
 * Find existing screenshot for a URL in output directory
 */
function findExistingScreenshot(url: string, outputDir: string): string | null {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    // Convert pathname to filename format
    const pageName = pathname.replace(/\//g, '-').replace(/^-|-$/g, '') || 'index';

    // Search recursively in all screenshot directories
    const screenshotsBase = path.join(outputDir);

    if (!fs.existsSync(screenshotsBase)) return null;

    // Find all screenshot directories
    const screenshotDirs: string[] = [];

    function findScreenshotDirs(dir: string, depth: number = 0) {
        if (depth > 4) return; // Limit recursion depth

        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.name === 'screenshots' || entry.name.includes('-ianai-co')) {
                        screenshotDirs.push(fullPath);
                    }
                    findScreenshotDirs(fullPath, depth + 1);
                }
            }
        } catch (err) {
            // Skip directories we can't read
        }
    }

    findScreenshotDirs(screenshotsBase);

    // Search in all found screenshot directories
    for (const dir of screenshotDirs) {
        const found = findLatestScreenshot(dir, pageName);
        if (found) return found;
    }

    return null;
}

function findLatestScreenshot(dir: string, pageName: string): string | null {
    if (!fs.existsSync(dir)) return null;

    try {
        const files = fs.readdirSync(dir);
        const pattern = new RegExp(`^${pageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*\\.webp$`);

        const matches = files.filter(f => pattern.test(f));
        if (matches.length === 0) return null;

        // Return most recent
        matches.sort((a, b) => {
            const statA = fs.statSync(path.join(dir, a));
            const statB = fs.statSync(path.join(dir, b));
            return statB.mtime.getTime() - statA.mtime.getTime();
        });

        return path.join(dir, matches[0]);
    } catch (err) {
        return null;
    }
}
