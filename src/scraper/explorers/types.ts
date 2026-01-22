/**
 * Shared Exploration Context Types
 *
 * Consolidates duplicated context interfaces from all Explorer classes.
 * Provides type-safe exploration context management.
 */

import { ActionRecord, ModalDiscovery } from '../../types/index.js';
import { NetworkManager } from '../../shared/network/NetworkManager.js';
import { BrowserPage } from '../adapters/BrowserPage.js';

/**
 * Base context required by all explorers
 */
export interface BaseExplorationContext {
    /** Browser page instance */
    page: BrowserPage;
    /** Target URL being explored */
    targetUrl: string;
    /** Chain of recorded actions */
    actionChain: ActionRecord[];
    /** Optional network manager for request interception */
    networkManager?: NetworkManager;
}

/**
 * Context for output operations (screenshots, JSON)
 */
export interface OutputContext {
    /** Directory for output files */
    outputDir: string;
    /** Timestamp for file naming */
    timestamp: string;
    /** Base name for screenshots */
    screenshotBaseName?: string;
}

/**
 * Context for navigation and link discovery
 */
export interface NavigationContext {
    /** Discovered navigation links */
    discoveredLinks: Array<{ url: string; path: string[] }>;
    /** Current navigation path breadcrumb */
    previousPath: string[];
}

/**
 * Context for modal/dialog discovery
 */
export interface ModalContext {
    /** Discovered modals */
    modalDiscoveries: ModalDiscovery[];
    /** Set of captured modal hashes (deduplication) */
    capturedModalHashes: Set<string>;
}

/**
 * Context for tracking visited elements (prevents re-clicking)
 */
export interface VisitedContext {
    /** Visited expansion buttons */
    visitedExpansionButtons?: Set<string>;
    /** Visited sidebar buttons */
    visitedSidebarButtons?: Set<string>;
    /** Clicked row texts */
    clickedRowTexts?: Set<string>;
}

/**
 * Full exploration context combining all partial contexts
 */
export interface FullExplorationContext extends
    BaseExplorationContext,
    OutputContext,
    NavigationContext,
    ModalContext,
    VisitedContext {}

/**
 * Action exploration context (for ActionExplorer)
 */
export type ActionExplorationContext = BaseExplorationContext &
    OutputContext &
    NavigationContext &
    ModalContext;

/**
 * Navigation exploration context (for NavExplorer)
 */
export type NavExplorationContext = BaseExplorationContext & {
    visitedExpansionButtons: Set<string>;
    visitedSidebarButtons: Set<string>;
};

/**
 * Content exploration context (for ContentExplorer)
 */
export type ContentExplorationContext = BaseExplorationContext &
    OutputContext &
    NavigationContext &
    ModalContext & {
    clickedRowTexts: Set<string>;
};

/**
 * Tab exploration context (for TabExplorer)
 */
export type TabExplorationContext = BaseExplorationContext & OutputContext;

/**
 * Filter exploration context (for FilterExplorer)
 */
export type FilterExplorationContext = BaseExplorationContext & OutputContext;

/**
 * Create a minimal exploration context
 */
export function createBaseContext(
    page: BrowserPage,
    targetUrl: string,
    networkManager?: NetworkManager
): BaseExplorationContext {
    return {
        page,
        targetUrl,
        actionChain: [],
        networkManager
    };
}

/**
 * Create a full exploration context with all fields initialized
 */
export function createFullContext(
    page: BrowserPage,
    targetUrl: string,
    outputDir: string,
    timestamp: string,
    networkManager?: NetworkManager
): FullExplorationContext {
    return {
        page,
        targetUrl,
        actionChain: [],
        networkManager,
        outputDir,
        timestamp,
        discoveredLinks: [],
        previousPath: [],
        modalDiscoveries: [],
        capturedModalHashes: new Set(),
        visitedExpansionButtons: new Set(),
        visitedSidebarButtons: new Set(),
        clickedRowTexts: new Set()
    };
}
