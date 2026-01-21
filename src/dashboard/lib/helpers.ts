/**
 * Dashboard Helper Functions
 * Utility functions for file operations, caching, and data loading
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Constants
export const OUTPUT_DIR = path.resolve('./output');
export const DATA_DIR = path.resolve('./data');
export const SCREENSHOTS_DIR = path.join(OUTPUT_DIR, 'screenshots');
export const TAGS_FILE = path.join(DATA_DIR, 'qa-tags.json');
export const REASONS_FILE = path.join(DATA_DIR, 'qa-reasons.json');

// Hash Cache
const hashCache = new Map<string, { mtime: number, hash: string }>();

/**
 * Get file hash with caching
 */
export function getFileHash(filePath: string, mtime: number): string {
    const cached = hashCache.get(filePath);
    if (cached && cached.mtime === mtime) return cached.hash;

    try {
        const content = fs.readFileSync(filePath);
        const hash = crypto.createHash('md5').update(content).digest('hex');
        hashCache.set(filePath, { mtime, hash });
        return hash;
    } catch {
        return '';
    }
}

// Web URL Cache
const webUrlCache: Record<string, any> = {};

/**
 * Get web URL metadata for a screenshot
 */
export function getWebUrlForScreenshot(screenshotFullPath: string): any {
    if (webUrlCache[screenshotFullPath]) return webUrlCache[screenshotFullPath];

    const filename = path.basename(screenshotFullPath, path.extname(screenshotFullPath));
    const domainDir = path.basename(path.dirname(screenshotFullPath));
    const domainWithDots = domainDir.replace(/-/g, '.');

    const possiblePaths = [
        path.join(SCREENSHOTS_DIR, 'json', domainWithDots, `${filename}.json`),
        path.join(SCREENSHOTS_DIR, 'json', domainWithDots, `${domainWithDots}-${filename}.json`)
    ];

    for (const jsonPath of possiblePaths) {
        if (fs.existsSync(jsonPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
                if (data.url) {
                    webUrlCache[screenshotFullPath] = data;
                    return data;
                }
            } catch {
                /* ignored */
            }
        }
    }
    return null;
}

/**
 * Load QA tags from file
 */
export function loadTags(): Record<string, string> {
    if (fs.existsSync(TAGS_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(TAGS_FILE, 'utf-8'));
        } catch {
            /* ignored */
        }
    }
    return {};
}

/**
 * Load failure reasons from file
 */
export function loadReasons(): Record<string, string> {
    if (fs.existsSync(REASONS_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(REASONS_FILE, 'utf-8'));
        } catch {
            /* ignored */
        }
    }
    return {};
}

/**
 * Update a tag and save to file
 */
export function updateTag(url: string, status: string, hash?: string): void {
    let tags: Record<string, string> = {};
    if (fs.existsSync(TAGS_FILE)) {
        try {
            tags = JSON.parse(fs.readFileSync(TAGS_FILE, 'utf-8'));
        } catch {
            /* ignored */
        }
    }
    const key = hash ? `${url}#${hash}` : url;
    tags[key] = status;
    fs.writeFileSync(TAGS_FILE, JSON.stringify(tags, null, 2));
}

/**
 * Update a reason and save to file
 */
export function updateReason(url: string, reason: string, hash?: string): void {
    let reasons: Record<string, string> = {};
    if (fs.existsSync(REASONS_FILE)) {
        try {
            reasons = JSON.parse(fs.readFileSync(REASONS_FILE, 'utf-8'));
        } catch {
            /* ignored */
        }
    }
    const key = hash ? `${url}#${hash}` : url;
    reasons[key] = reason;
    fs.writeFileSync(REASONS_FILE, JSON.stringify(reasons, null, 2));
}
