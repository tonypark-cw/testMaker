import { TestableElement, GoldenPathInfo } from '../../types/index.js';

export interface ScrapeJob {
    url: string;
    depth: number;
    sourceUrl?: string;
}

export interface ScrapeResult {
    url: string;
    pageTitle: string;
    elements: TestableElement[];
    links: string[];
    sidebarLinks?: string[]; // Optional distinction
    screenshotPath?: string;
    modalDiscoveries?: any[]; // To match original structure if needed
    error?: string;
    newlyDiscoveredCount: number;
    actionChain?: any[]; // [NEW] Action Chain for Golden Path
    goldenPath?: GoldenPathInfo; // Optional for backward compatibility
}

export interface ScraperConfig {
    url: string;
    depth: number;
    limit: number;
    headless: boolean;
    force: boolean;
    username?: string;
    password?: string;
}
