import * as fs from 'fs';
import * as path from 'path';
import { program } from 'commander';
import { ScoringProcessor } from '../src/core/lib/ScoringProcessor.js';

// Parse CLI arguments
program
    .option('--env <environment>', 'Environment (stage/dev/prod)', 'stage')
    .parse(process.argv);

const opts = program.opts();
const environment = opts.env || 'stage';

interface Action {
    type: string;
    label: string;
    url: string;
}

interface PageData {
    url: string;
    pageTitle: string;
    actionChain?: Action[];
    metadata?: {
        totalElements: number;
    };
    reliabilityScore?: number;
    functionalPath?: string;
}

async function runValidator() {
    console.log(`[Validator] Analyzing ${environment} environment...`);
    const jsonBaseDir = path.join(process.cwd(), 'output', environment, 'screenshots', 'json');

    if (!fs.existsSync(jsonBaseDir)) {
        console.error(`[Validator] JSON directory not found: ${jsonBaseDir}`);
        console.error('[Validator] Run the scraper first to generate data.');
        return;
    }

    // Auto-detect domains
    const domains = fs.readdirSync(jsonBaseDir).filter(d => {
        const dPath = path.join(jsonBaseDir, d);
        return fs.statSync(dPath).isDirectory();
    });

    if (domains.length === 0) {
        console.error('[Validator] No domain directories found.');
        return;
    }

    console.log(`[Validator] Found domains: ${domains.join(', ')}`);

    const results: any[] = [];
    const bySection: Record<string, any[]> = {};

    // Process each domain directory
    for (const domain of domains) {
        const jsonDir = path.join(jsonBaseDir, domain);
        const files = fs.readdirSync(jsonDir).filter(f => f.endsWith('.json'));

        console.log(`[Validator] Analyzing ${files.length} pages from ${domain}...`);

        for (const file of files) {
            const filePath = path.join(jsonDir, file);
            const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            const { score, reasons } = await ScoringProcessor.calculate(null, {
                url: content.url,
                pageTitle: content.pageTitle,
                functionalPath: content.functionalPath,
                actionChain: content.actionChain,
                totalElements: content.metadata?.totalElements
            });

            const urlObj = new URL(content.url);
            // Extract section from /app/SECTION/...
            const parts = urlObj.pathname.split('/');
            // parts[0] is empty, parts[1] is 'app', parts[2] is section
            let section = parts[2] || 'Home';

            // Exclude noise (Auditlog)
            if (section.toLowerCase().includes('auditlog')) continue;

            section = section.charAt(0).toUpperCase() + section.slice(1);

            if (!bySection[section]) {
                bySection[section] = [];
            }

            const resultItem = {
                file,
                url: content.url,
                title: content.pageTitle,
                score,
                reasons
            };

            results.push(resultItem);
            bySection[section].push(resultItem);
        }
    }

    const report: string[] = [];
    report.push('# UI & Path Consistency Report (By Menu)');
    report.push(`Generated: ${new Date().toLocaleString()}`);
    report.push(`Total Pages Analyzed: ${results.length}`);
    report.push('\n## Summary');

    const avgScore = results.reduce((acc, r) => acc + r.score, 0) / results.length;
    report.push(`- **Average Consistency Score:** ${avgScore.toFixed(1)}/100`);
    report.push(`- **Critical Issues (<40):** ${results.filter(r => r.score < 40).length}`);

    // Process Page per Section
    const sections = Object.keys(bySection).sort();

    for (const section of sections) {
        const sectionResults = bySection[section];
        // Sort by score ascending (issues first)
        sectionResults.sort((a, b) => a.score - b.score);

        const sectionAvg = sectionResults.reduce((acc, r) => acc + r.score, 0) / sectionResults.length;

        report.push(`\n## ${section} (Avg: ${sectionAvg.toFixed(1)})`);
        report.push('| Page | Score | Issues |');
        report.push('| :--- | :--- | :--- |');

        sectionResults.forEach(r => {
            const shortName = r.url.replace('https://stage.ianai.co/app', '').replace('https://dev.ianai.co/app', '');
            // Highlight low scores
            const scoreDisplay = r.score < 50 ? `**${r.score}** 🔴` : `**${r.score}**`;
            report.push(`| \`${shortName}\` | ${scoreDisplay} | ${r.reasons.join(', ') || 'None'} |`);
        });

        // [NEW] Schema Discovery Info
        const labelDir = path.join(process.cwd(), 'output', environment, 'print_label');
        if (fs.existsSync(labelDir)) {
            // Find labels matching this section
            const sectionLower = section.toLowerCase();
            const labelFiles = fs.readdirSync(labelDir).filter(f => f.toLowerCase().includes(sectionLower) && f.endsWith('.json'));

            if (labelFiles.length > 0) {
                report.push('\n**Discovered Schema Keys:**');
                labelFiles.forEach(lf => {
                    try {
                        const keys = JSON.parse(fs.readFileSync(path.join(labelDir, lf), 'utf-8'));
                        report.push(`- \`${lf.replace('.json', '')}\`: ${keys.length} keys captured`);
                    } catch { /* ignore */ }
                });
            }
        }
    }

    const reportPath = path.join('output', environment, 'consistency_report.md');
    fs.writeFileSync(reportPath, report.join('\n'));
    console.log(`[Validator] Report generated: ${reportPath}`);
}

runValidator().catch(console.error);
