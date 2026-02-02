
import * as fs from 'fs';
import * as path from 'path';

// CLI argument for environment
const env = process.argv[2] || 'stage';
const jsonBaseDir = path.join('./output', env, 'screenshots/json');
const outputDir = path.join('./output', env, 'blocked_flagged');

if (!fs.existsSync(jsonBaseDir)) {
    console.error(`JSON directory not found: ${jsonBaseDir}`);
    process.exit(1);
}

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

console.log(`Scanning JSON files in: ${jsonBaseDir} ...`);

const urls = new Set<string>();
const domains = fs.readdirSync(jsonBaseDir);

for (const domain of domains) {
    const domainDir = path.join(jsonBaseDir, domain);
    if (!fs.statSync(domainDir).isDirectory()) continue;

    const files = fs.readdirSync(domainDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
        try {
            const content = fs.readFileSync(path.join(domainDir, file), 'utf-8');
            const data = JSON.parse(content);
            if (data.url) {
                // Convert full URL to relative path if possible, or keep full
                // run_rescan logic simply attaches baseUrl if path starts with /
                // But run_rescan also handles full URLs if we modify it slightly?
                // Actually run_rescan expects relative paths: `const fullUrl = baseUrl + path;`
                // So I must extract pathname.
                try {
                    const urlObj = new URL(data.url);
                    urls.add(urlObj.pathname);
                } catch {
                    // if relative already
                    urls.add(data.url);
                }
            }
        } catch (e) {
            console.error(`Failed to parse ${file}:`, e);
        }
    }
}

const sortedUrls = Array.from(urls).sort();
const outputPath = path.join(outputDir, 'rescan_list.json');

fs.writeFileSync(outputPath, JSON.stringify(sortedUrls, null, 2));

console.log(`\n✅ Generated full scan list with ${sortedUrls.length} unique URLs.`);
console.log(`Saved to: ${outputPath}`);
console.log(`\nNow run: npx tsx src/scripts/run_rescan.ts ${env} --headless`);
