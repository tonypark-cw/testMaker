
import * as fs from 'fs';
import * as path from 'path';

/**
 * Calculates Route Coverage: Verified Routes / Total Discovered Routes
 */

const SCREENSHOTS_JSON_DIR = path.join(process.cwd(), 'output/screenshots/json/stage.ianai.co');
const REPORT_PATH = path.join(process.cwd(), 'docs/COVERAGE_REPORT.md');

// Routes verified in main_flow.spec.ts (hardcoded match)
const VERIFIED_ROUTES = [
    '/app/home',
    '/app/reports/sales/overview',
    '/app/item',
    '/app/settings',
    '/app/workorder',
    '/app/purchaseorder',
    '/app/adjustment'
];

function normalizeUrl(url: string): string {
    try {
        const u = new URL(url);
        // Normalize: remove trailing slash, lowercase
        let pathname = u.pathname.toLowerCase();
        if (pathname.endsWith('/')) pathname = pathname.slice(0, -1);
        return pathname;
    } catch {
        return url;
    }
}

async function main() {
    if (!fs.existsSync(SCREENSHOTS_JSON_DIR)) {
        console.error(`[Coverage] Data directory not found: ${SCREENSHOTS_JSON_DIR}`);
        return;
    }

    const files = fs.readdirSync(SCREENSHOTS_JSON_DIR).filter(f => f.endsWith('.json'));
    const discoveredUrls = new Set<string>();
    const normalizedRoutes = new Set<string>();

    const uuidRegex = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

    files.forEach(file => {
        try {
            const content = JSON.parse(fs.readFileSync(path.join(SCREENSHOTS_JSON_DIR, file), 'utf8'));
            if (content.url) {
                const rawUrl = normalizeUrl(content.url);

                // Exclude assets or blobs
                if (!rawUrl.startsWith('blob:') && !rawUrl.includes('.')) {
                    discoveredUrls.add(rawUrl);

                    // Structural Normalization: Mask UUIDs
                    const structuralUrl = rawUrl.replace(uuidRegex, '{id}');
                    normalizedRoutes.add(structuralUrl);
                }
            }
        } catch (e) {
            // ignore malformed
        }
    });

    const totalDiscovered = discoveredUrls.size;
    const totalStructural = normalizedRoutes.size;

    const verifiedCount = VERIFIED_ROUTES.length;

    const coveragePercent = totalDiscovered > 0
        ? ((verifiedCount / totalDiscovered) * 100).toFixed(2)
        : '0.00';

    const structuralCoveragePercent = totalStructural > 0
        ? ((verifiedCount / totalStructural) * 100).toFixed(2)
        : '0.00';

    const reportContent = `# Test Coverage Report
**Date**: ${new Date().toLocaleDateString()}
**Metric**: Route Coverage (Verified / Discovered)

## Summary
- **Verification Ratio (Raw)**: **${coveragePercent}%** (${verifiedCount} / ${totalDiscovered})
- **Verification Ratio (Structural)**: **${structuralCoveragePercent}%** (${verifiedCount} / ${totalStructural})
  *(Excluding unique UUID record paths)*

## Verified Routes
${VERIFIED_ROUTES.map(r => `- \`${r}\``).join('\n')}

## Discovered Structural Routes (${totalStructural})
${[...normalizedRoutes].sort().map(r => `- \`${r}\``).join('\n')}

## Raw Discovered Routes (${totalDiscovered})
<details>
<summary>Click to see all ${totalDiscovered} raw routes</summary>

${[...discoveredUrls].sort().map(r => `- \`${r}\``).join('\n')}
</details>
`;

    // Ensure docs dir exists
    const docsDir = path.dirname(REPORT_PATH);
    if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

    fs.writeFileSync(REPORT_PATH, reportContent);
    console.log(`[Coverage] Report generated at ${REPORT_PATH}`);
    console.log(`[Coverage] ${coveragePercent}% Coverage (${verifiedCount}/${totalDiscovered})`);
}

main().catch(console.error);
