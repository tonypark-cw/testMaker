import { BrowserPage } from '../adapters/BrowserPage.js';
import { ActionRecord, ModalDiscovery, TestableElement } from '../../types/index.js';
import { CommandExecutor } from '../commands/CommandExecutor.js';

export interface ExplorationState {
    lastScreenshotHash: string | null;
    capturedModalHashes: Set<string>;
    visitedSidebarButtons: Set<string>;
    visitedExpansionButtons: Set<string>;
    clickedRowTexts: Set<string>;
    visitedUIHashes: Set<string>; // [ENHANCE] Track global UI fingerprints
}

export interface ExplorationResults {
    elements: TestableElement[];
    links: { url: string; path: string[] }[];
    sidebarLinks: string[];
    modalDiscoveries: ModalDiscovery[];
    pageTitle: string;
    screenshotPath: string;
    targetUrl: string;
    uiHash?: string;
}

/**
 * ExplorationContext isolates state for each scraping session.
 * Replaces static variables to ensure thread-safety and multi-tab stability.
 */
export class ExplorationContext {
    public state: ExplorationState;
    public results: ExplorationResults;
    public actionChain: ActionRecord[];
    public executor: CommandExecutor;

    constructor(
        public page: BrowserPage,
        public url: string,
        public outputDir: string,
        public timestamp: string,
        public pageName: string,
        previousPath: string[] = [],
        previousActions: ActionRecord[] = []
    ) {
        this.state = {
            lastScreenshotHash: null,
            capturedModalHashes: new Set(),
            visitedSidebarButtons: new Set(),
            visitedExpansionButtons: new Set(),
            clickedRowTexts: new Set(),
            visitedUIHashes: new Set() // [ENHANCE] Initial state
        };

        this.results = {
            elements: [],
            links: [],
            sidebarLinks: [],
            modalDiscoveries: [],
            pageTitle: '',
            screenshotPath: '',
            targetUrl: url
        };

        this.actionChain = [...previousActions];
        this.executor = new CommandExecutor(this);
    }
}
