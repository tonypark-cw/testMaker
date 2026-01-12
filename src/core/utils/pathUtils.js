/**
 * Utility functions for handling URL and file path transformations
 * Shared between backend (Scraper, CLI, Server) and frontend (Dashboard)
 */

/**
 * Normalizes a URL path to a safe filename segment
 * @param {string} url - The URL to normalize
 * @returns {string} - Safe filename segment
 */
export function urlToPathName(url) {
    try {
        const parsed = new URL(url);
        return parsed.pathname
            .replace(/^\/|\/$/g, '')
            .replace(/\//g, '-') || 'index';
    } catch {
        return 'root';
    }
}

/**
 * Patterns for identifying UUIDs and other long IDs
 */
export const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{20,}/gi;

/**
 * Replaces UUIDs in a path with :id placeholders
 * @param {string} path - The path string
 * @returns {string} - Normalized path with :id
 */
export function normalizeUUIDs(path) {
    return path.replace(UUID_PATTERN, ':id');
}

/**
 * Converts a filename back to a logical route path for UI display
 * @param {string} filename - The filename (e.g. screenshot-app_home.webp)
 * @returns {string} - Logical route (e.g. /app/home)
 */
export function filenameToRoute(filename) {
    let name = filename
        .replace(/^screenshot-/, '')
        .replace(/^golden_/, '')
        .replace(/\.(webp|png|jpg|json)$/, '')
        .replace(/[_-]\d{4}-\d{2}-\d{2}_.*$/, '') // Strip timestamp (handle both _ and -)
        .replace(/[_-]\d{8}-\d{4}.*$/, '');       // Compact timestamp (handle both _ and -)

    const isModalOrDetail = /^(modal|detail)-/.test(name);
    name = name.replace(/^(modal|detail)-/, '');

    // Standardize to hyphenated slug first, then normalize UUIDs, then join
    name = name.replace(/_/g, '-');
    name = normalizeUUIDs(name);
    let pathStr = '/' + name.split('-').join('/');

    if (isModalOrDetail && !pathStr.toLowerCase().startsWith('/app/')) {
        pathStr = '/app' + pathStr;
    }

    return pathStr;
}

/**
 * Extracts the core slug (urlPathName part) from a filename
 * @param {string} filename 
 * @returns {string}
 */
export function filenameToSlug(filename) {
    return filename
        .replace(/^screenshot-/, '')
        .replace(/^golden_/, '')
        .replace(/\.(webp|png|jpg|json)$/, '')
        .replace(/[_-]\d{4}-\d{2}-\d{2}_.*$/, '')
        .replace(/[_-]\d{8}-\d{4}.*$/, '')
        .replace(/_/g, '-'); // Standardize all to hyphen for JSON/Metadata lookup
}

/**
 * Calculates the execution depth based on a normalized route path
 * @param {string} routePath - The normalized route path
 * @returns {number} - Calculated depth
 */
export function calculateDepth(routePath) {
    if (!routePath || routePath === '/') return 0;
    return routePath.split('/').filter(s => s.length > 0).length;
}

/**
 * Extracts the domain segment used for output directories
 * @param {string} url - The URL to extract domain from
 * @returns {string} - Domain segment (e.g. stage-ianai-co)
 */
export function getDomainSegment(url) {
    try {
        const parsed = new URL(url);
        return parsed.hostname.replace(/\./g, '-');
    } catch {
        return 'unknown';
    }
}
