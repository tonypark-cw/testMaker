
import * as fs from 'fs';
import * as path from 'path';

const flagDir = './output/stage/blocked_flagged';

// Read all image files in the blocked folder
const files = fs.readdirSync(flagDir)
    .filter(f => /\.(webp|png|jpg|jpeg)$/i.test(f));

console.log(`Processing ${files.length} blocked image files...`);

const urlSet = new Set<string>();

for (const filename of files) {
    // Remove date and extension: "app-customer_2026-01-22T12.webp" -> "app-customer"
    let baseName = filename.split('_')[0].replace(/\.(webp|png|jpg|jpeg)$/i, '');

    // Skip if UUID pattern detected
    if (/019[a-f0-9]{5}-[a-f0-9]{4}-[a-f0-9]{4}/.test(baseName)) {
        continue; // Skip UUID paths
    }

    // Skip modals
    if (baseName.startsWith('modal-')) {
        continue;
    }

    // Remove state variants (checkbox, tab, radio)
    baseName = baseName
        .replace(/-checkbox\d+-\w+$/, '')
        .replace(/-tab-.+$/, '')
        .replace(/-radio\d+$/, '');

    // Convert: "app-customer" -> "/app/customer"
    const urlPath = '/' + baseName.replace(/-/g, '/');

    urlSet.add(urlPath);
}

const uniqueUrls = Array.from(urlSet).sort();

const rescanListPath = path.join(flagDir, 'rescan_list.json');
fs.writeFileSync(rescanListPath, JSON.stringify(uniqueUrls, null, 2));

console.log(`\nGenerated rescan list with ${uniqueUrls.length} unique URLs`);
console.log(`Saved to: ${rescanListPath}`);
console.log('\nNote: Excluded UUID-based paths and modals.');
