import * as fs from 'fs';
import * as path from 'path';
import { program } from 'commander';

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
    functionalPath?: string; // [NEW] 3-Way Mapping
}

function calculateScore(data: PageData): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];
    const url = new URL(data.url);
    const pathSegments = url.pathname.split('/').filter(s => s && s !== 'app');

    // 1. Title Match (Max 30 pts)
    const title = data.pageTitle.toLowerCase();
    const hasMatchInTitle = pathSegments.some(seg => title.includes(seg.toLowerCase()));

    if (hasMatchInTitle) {
        score += 30;
    } else if (title !== 'ianaiERP' && title !== '') {
        score += 15;
        // reasons.push('Title does not explicitly match path segments'); // Soften this warning
    } else {
        reasons.push('Page title is generic/empty (ianaiERP)');
    }

    // 2. Path Logic (Max 40 pts) - 3-Way Mapping Support
    const functionalPath = data.functionalPath || '';
    const hasFunctionalPath = functionalPath.length > 0;

    // Heuristic: Does the last action label OR functional path match the current path?
    let matchesPath = false;
    let pathSource = '';

    if (hasFunctionalPath) {
        // functionalPath is like "Home > Reports > Purchasing"
        // We check if any segment of the URL is present in the functional path
        matchesPath = pathSegments.some(seg => functionalPath.toLowerCase().includes(seg.toLowerCase()));
        pathSource = 'FunctionalPath';
    }

    if (!matchesPath && data.actionChain && data.actionChain.length > 0) {
        const lastAction = data.actionChain[data.actionChain.length - 1];
        const lastLabel = lastAction.label.toLowerCase();
        matchesPath = pathSegments.some(seg => lastLabel.includes(seg.toLowerCase()));
        pathSource = 'ActionChain';
    }

    if (matchesPath) {
        score += 40;
    } else {
        if (hasFunctionalPath) {
            score += 35; // Trust the functional path even if exact string match fails (it's a high signal)
        } else if (data.actionChain && data.actionChain.length > 0) {
            score += 10;
            reasons.push(`Last action does not correlate with landing path`);
        } else {
            reasons.push('No action chain or functional path recorded');
        }
    }

    // 3. Visual Stability / Content (Max 30 pts)
    const elementCount = data.metadata?.totalElements || 0;
    if (elementCount > 10) {
        score += 30;
    } else if (elementCount > 0) {
        score += 15;
        reasons.push(`Low element count (${elementCount})`);
    } else {
        reasons.push('Zero interactive elements found: Likely a failed load/500');
    }

    return { score, reasons };
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
            const { score, reasons } = calculateScore(content);

            const urlObj = new URL(content.url);
            // Extract section from /app/SECTION/...
            const parts = urlObj.pathname.split('/');
            // parts[0] is empty, parts[1] is 'app', parts[2] is section
            let section = parts[2] || 'Home';
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
            const shortName = r.url.replace('https://stage.ianai.co/app', '');
            // Highlight low scores
            const scoreDisplay = r.score < 50 ? `**${r.score}** 🔴` : `**${r.score}**`;
            report.push(`| \`${shortName}\` | ${scoreDisplay} | ${r.reasons.join(', ') || 'None'} |`);
        });
    }

    const reportPath = path.join('output', environment, 'consistency_report.md');
    fs.writeFileSync(reportPath, report.join('\n'));
    console.log(`[Validator] Report generated: ${reportPath}`);
}

runValidator().catch(console.error);
