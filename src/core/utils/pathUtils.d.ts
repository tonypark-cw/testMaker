/**
 * Utility functions for handling URL and file path transformations
 * Shared between backend (Scraper, CLI, Server) and frontend (Dashboard)
 */

/**
 * Normalizes a URL path to a safe filename segment
 */
export function urlToPathName(url: string): string;

/**
 * Patterns for identifying UUIDs and other long IDs
 */
export const UUID_PATTERN: RegExp;

/**
 * Replaces UUIDs in a path with :id placeholders
 */
export function normalizeUUIDs(path: string): string;

/**
 * Converts a filename back to a logical route path for UI display
 */
export function filenameToRoute(filename: string): string;

/**
 * Extracts the core slug (urlPathName part) from a filename
 */
export function filenameToSlug(filename: string): string;

/**
 * Calculates the execution depth based on a normalized route path
 */
export function calculateDepth(routePath: string): number;

/**
 * Extracts the domain segment used for output directories
 */
export function getDomainSegment(url: string): string;
