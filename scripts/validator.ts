import * as fs from 'fs';
import * as path from 'path';

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
    reliabilityScore?: number; // Might be in elements or custom
}

function calculateScore(data: PageData): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];
    const url = new URL(data.url);
    const pathSegments = url.pathname.split('/').filter(s => s && s !== 'app');

    // 1. Title Match (Max 30 pts)
    // Heuristic: Does the path segment (e.g. 'users') exist in the title or label?
    const title = data.pageTitle.toLowerCase();
    const hasMatchInTitle = pathSegments.some(seg => title.includes(seg.toLowerCase()));
    if (hasMatchInTitle) {
        score += 30;
    } else if (title !== 'ianaiERP' && title !== '') {
        score += 15; // Partial credit for non-default title
        reasons.push('Title does not explicitly match path segments');
    } else {
        reasons.push('Page title is generic/empty (ianaiERP)');
    }

    // 2. Path Logic (Max 40 pts)
    // Heuristic: Does the last action label match the current path?
    if (data.actionChain && data.actionChain.length > 0) {
        const lastAction = data.actionChain[data.actionChain.length - 1];
        const lastLabel = lastAction.label.toLowerCase();
        const matchesPath = pathSegments.some(seg => lastLabel.includes(seg.toLowerCase()));

        if (matchesPath) {
            score += 40;
        } else {
            score += 10; // Found path but no label match
            reasons.push(`Last action "${lastAction.label}" does not correlate with landing path ${url.pathname}`);
        }
    } else {
        reasons.push('No action chain recorded (Direct navigation or history lost)');
    }

    // 3. Visual Stability / Content (Max 30 pts)
    const elementCount = data.metadata?.totalElements || 0;
    if (elementCount > 10) {
        score += 30;
    } else if (elementCount > 0) {
        score += 15;
        reasons.push(`Low element count (${elementCount}): Possibly a blank or loading page`);
    } else {
        reasons.push('Zero interactive elements found: Likely a failed load/500');
    }

    return { score, reasons };
}

async function runValidator() {
    const jsonDir = path.join(process.cwd(), 'output/screenshots/json/stage.ianai.co');
    if (!fs.existsSync(jsonDir)) {
        console.error(`Directory not found: ${jsonDir}`);
        return;
    }

    const files = fs.readdirSync(jsonDir).filter(f => f.endsWith('.json'));
    const results: any[] = [];

    console.log(`[Validator] Analyzing ${files.length} pages...`);

    for (const file of files) {
        const filePath = path.join(jsonDir, file);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const { score, reasons } = calculateScore(content);

        results.push({
            file,
            url: content.url,
            title: content.pageTitle,
            score,
            reasons
        });
    }

    // Sort by score ascending (problems first)
    results.sort((a, b) => a.score - b.score);

    const report: string[] = [];
    report.push('# UI & Path Consistency Report');
    report.push(`Generated: ${new Date().toLocaleString()}`);
    report.push(`Total Pages Analyzed: ${results.length}`);
    report.push('\n## Summary');

    const avgScore = results.reduce((acc, r) => acc + r.score, 0) / results.length;
    report.push(`- **Average Consistency Score:** ${avgScore.toFixed(1)}/100`);
    report.push(`- **Critical Issues (<40):** ${results.filter(r => r.score < 40).length}`);
    report.push(`- **Healthy Pages (>70):** ${results.filter(r => r.score > 70).length}`);

    report.push('\n## Faulty or Suspicious Pages (Ordered by Score)');
    report.push('| Page | Score | Issues |');
    report.push('| :--- | :--- | :--- |');

    results.forEach(r => {
        if (r.score < 90) { // Show everything with even slight issues
            const shortName = r.url.replace('https://stage.ianai.co', '');
            report.push(`| \`${shortName}\` | **${r.score}** | ${r.reasons.join(', ') || 'None'} |`);
        }
    });

    fs.writeFileSync('output/consistency_report.md', report.join('\n'));
    console.log('[Validator] Report generated: output/consistency_report.md');
}

runValidator().catch(console.error);
