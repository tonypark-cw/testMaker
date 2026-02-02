
import * as fs from 'fs';
import * as path from 'path';

const jsonBaseDir = './output/stage/screenshots/json';
let total = 0;
let lowScoreCount = 0;

if (!fs.existsSync(jsonBaseDir)) {
    console.log("No JSON directory found.");
    process.exit(0);
}

const domains = fs.readdirSync(jsonBaseDir);
for (const domain of domains) {
    const domainDir = path.join(jsonBaseDir, domain);
    if (!fs.statSync(domainDir).isDirectory()) continue;

    const files = fs.readdirSync(domainDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
        total++;
        try {
            const content = fs.readFileSync(path.join(domainDir, file), 'utf-8');
            const data = JSON.parse(content);
            if (typeof data.reliabilityScore === 'number' && data.reliabilityScore < 70) {
                lowScoreCount++;
                console.log(`[${data.reliabilityScore}] ${data.url}`);
            }
        } catch { }
    }
}

console.log(`\nTotal JSONs: ${total}`);
console.log(`Low Score (< 70): ${lowScoreCount}`);
