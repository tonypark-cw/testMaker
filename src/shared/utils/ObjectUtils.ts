/**
 * Recursively extracts all keys from an object, including nested ones.
 * Keys are returned in dot-notation (e.g., "prop.subprop").
 * 
 * @param obj The object to extract keys from
 * @param prefix The current prefix for dot-notation (used internally)
 * @returns Array of strings representing all keys
 */
export function extractAllKeys(obj: unknown, prefix = ''): string[] {
    let keys: string[] = [];

    // Base case: if not an object or is null
    if (!obj || typeof obj !== 'object') {
        return keys;
    }

    if (Array.isArray(obj)) {
        // For arrays, we only look at the first element if it's an object
        // This is a specific behavior from the original implementation 
        // presumably to handle list responses where schema is consistent
        if (obj.length > 0 && typeof obj[0] === 'object') {
            keys = keys.concat(extractAllKeys(obj[0], prefix));
        }
        return keys;
    }

    // It's a non-null object and not an array
    const record = obj as Record<string, unknown>;

    for (const key of Object.keys(record)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        keys.push(fullKey);

        const value = record[key];
        if (value && typeof value === 'object') {
            keys = keys.concat(extractAllKeys(value, fullKey));
        }
    }
    return keys;
}
