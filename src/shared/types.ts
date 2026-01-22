import {
    TestableElement,
    GoldenPathInfo,
    ActionRecord,
    ModalDiscovery
} from '../types/index.js';

export interface ScrapeJob {
    /** Target URL to scrape */
    url: string;
    /** Current depth level */
    depth: number;
    /** URL that led to this job */
    sourceUrl?: string;
    /** Action chain inherited from parent job */
    actionChain?: ActionRecord[];
    /** Functional path breadcrumbs inherited from parent */
    functionalPath?: string[];
}

/**
 * Runner Checkpoint State for persistence
 */
export interface RunnerCheckpoint {
    domain: string;
    timestamp: string;
    queue: ScrapeJob[];
    visitedUrls: string[];
}

export interface ScrapeResult {
    /** Scraped URL */
    url: string;
    /** Page title */
    pageTitle: string;
    /** Discovered testable elements */
    elements: TestableElement[];
    /** Discovered links (URLs only) */
    links: string[];
    /** Discovered links with full path info */
    discoveredLinks?: Array<{ url: string; path: string[] }>;
    /** Sidebar-specific links */
    sidebarLinks?: string[];
    /** Screenshot file path */
    screenshotPath?: string;
    /** Modals discovered during scraping */
    modalDiscoveries?: ModalDiscovery[];
    /** Error message if failed */
    error?: string;
    /** Count of newly discovered URLs */
    newlyDiscoveredCount: number;
    /** Complete action chain for this page */
    actionChain?: ActionRecord[];
    /** Functional path breadcrumb (e.g., "Inventory > Transfer") */
    functionalPath?: string;
    /** Golden Path analysis result */
    goldenPath?: GoldenPathInfo;
}

export interface ScraperConfig {
    url: string;
    depth: number;
    limit: number;
    headless: boolean;
    force: boolean;
    username?: string;
    password?: string;
    quiet?: boolean;
    resume?: boolean;
}

// ============================================
// Phase 3 준비: ScraperContext & ScraperState
// Static 변수 제거를 위한 인터페이스 설계
// ============================================

/**
 * Scraper State - 인스턴스별 상태 (경쟁조건 방지)
 * 기존 static 변수들을 대체
 */
export interface ScraperState {
    /** Last screenshot MD5 hash for deduplication */
    lastScreenshotHash: string | null;
    /** Set of captured modal hashes */
    capturedModalHashes: Set<string>;
    /** Set of visited sidebar button texts */
    visitedSidebarButtons: Set<string>;
    /** Set of expanded menu button texts */
    visitedExpansionButtons: Set<string>;
    /** Current action chain being built */
    currentActionChain: ActionRecord[];
}

/**
 * Scraper Context - 각 scrape 작업의 컨텍스트
 * Phase 패턴에서 각 Phase에 전달됨
 */
export interface ScraperContext {
    /** Current job being processed */
    job: ScrapeJob;
    /** Instance-level state (not shared) */
    state: ScraperState;
    /** Configuration */
    config: ScraperConfig;
    /** Output directory for screenshots */
    outputDir: string;
    /** Domain being scraped */
    domain: string;
}

/**
 * Shared State - 탭 간 공유가 필요한 경우 (선택적)
 * 뮤텍스로 보호됨
 */
export interface SharedScraperState {
    /** Global set of all visited URLs (cross-tab) */
    visitedUrls: Set<string>;
    /** Global count of processed pages */
    processedCount: number;
    /** Lock for thread-safe operations */
    acquireLock: (key: string) => Promise<() => void>;
}

/**
 * Factory function type for creating fresh state
 */
export type CreateScraperState = () => ScraperState;

/**
 * Default state factory
 */
export const createDefaultScraperState: CreateScraperState = () => ({
    lastScreenshotHash: null,
    capturedModalHashes: new Set<string>(),
    visitedSidebarButtons: new Set<string>(),
    visitedExpansionButtons: new Set<string>(),
    currentActionChain: []
});
