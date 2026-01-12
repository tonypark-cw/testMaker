const fs = require('fs');
const path = require('path');

const VERIFIED_ROUTES = [
    '/app/home',
    '/app/reports/sales/overview',
    '/app/item',
    '/app/settings',
    '/app/workorder',
    '/app/purchaseorder',
    '/app/adjustment'
];

const SCREENSHOTS_DIR = path.join(__dirname, '../../output/screenshots');

function isGolden(fileName) {
    // 1. Heuristic: Don't delete modal screenshots if they were recently added for Golden Paths
    // But the user said "purge everything except Golden Path", which is route-based.

    const namePart = fileName
        .replace(/^screenshot-/, '')
        .replace(/\.(webp|png|jpg)$/, '')
        .replace(/_\d{4}-\d{2}-\d{2}_.*$/, '');

    // Handle path separation
    const separator = namePart.includes('_') ? '_' : '-';
    const reconstructedPath = '/' + namePart.split(separator).join('/');

    return VERIFIED_ROUTES.some(route => reconstructedPath.startsWith(route));
}

function cleanup(dir) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir);
    items.forEach(item => {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            cleanup(fullPath);
        } else if (item.endsWith('.webp') || item.endsWith('.png')) {
            if (!isGolden(item)) {
                console.log(`[CLEANUP] Deleting non-Golden: ${item}`);
                fs.unlinkSync(fullPath);
            } else {
                console.log(`[CLEANUP] Keeping Golden: ${item}`);
            }
        }
    });
}

console.log('Starting cleanup of screenshots...');
cleanup(SCREENSHOTS_DIR);
console.log('Cleanup complete.');
