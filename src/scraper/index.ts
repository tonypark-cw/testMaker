import { ScrapeResult, ScraperConfig, ScrapeJob } from '../types/scraper.js';
import { NetworkManager } from '../shared/network/NetworkManager.js';
import { BrowserPage } from './adapters/BrowserPage.js';
import { ExplorationContext } from './phases/ExplorationContext.js';
import { ExplorationOrchestrator } from './phases/ExplorationOrchestrator.js';
import { StabilityAnalyzer } from './lib/StabilityAnalyzer.js';

// Phases
import { NavigationPhase } from './phases/NavigationPhase.js';
import { StabilizationPhase } from './phases/StabilizationPhase.js';
import { CapturePhase } from './phases/CapturePhase.js';
import { DiscoveryPhase } from './phases/DiscoveryPhase.js';
import { ExtractionPhase } from './phases/ExtractionPhase.js';

/**
 * Scraper orchestrates the analysis of a single page using a strategy-based phase execution.
 */
export class Scraper {
  private orchestrator: ExplorationOrchestrator;

  constructor(private config: ScraperConfig, private outputDir: string, private networkManager?: NetworkManager) {
    this.orchestrator = new ExplorationOrchestrator();

    // Register Phases in order
    this.orchestrator
      .addPhase(new NavigationPhase())
      .addPhase(new StabilizationPhase())
      .addPhase(new CapturePhase())
      .addPhase(new DiscoveryPhase())
      .addPhase(new ExtractionPhase());
  }

  public async scrape(page: BrowserPage, job: ScrapeJob): Promise<ScrapeResult> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 13);
    const urlObj = new URL(job.url);
    const pageName = urlObj.pathname.replace(/\//g, '-').replace(/^-|-$/g, '') || 'index';

    // 1. Initialize Context (Isolation)
    const context = new ExplorationContext(
      page,
      job.url,
      this.outputDir,
      timestamp,
      pageName,
      job.functionalPath,
      job.actionChain
    );

    // 2. Execute Orchestration
    const result = await this.orchestrator.execute(context);

    if (!result.success) {
      return {
        url: job.url,
        pageTitle: 'Error',
        elements: [],
        links: [],
        error: result.error,
        newlyDiscoveredCount: 0
      };
    }

    // 3. Post-processing (Stability Analysis)
    const goldenPath = await StabilityAnalyzer.analyzeGoldenPath(page, context.results.elements, {
      url: job.url,
      pageTitle: context.results.pageTitle,
      screenshotPath: context.results.screenshotPath
    });

    return {
      url: job.url,
      pageTitle: context.results.pageTitle,
      elements: context.results.elements,
      links: context.results.links.map(l => l.url),
      discoveredLinks: context.results.links,
      sidebarLinks: context.results.sidebarLinks,
      screenshotPath: context.results.screenshotPath,
      modalDiscoveries: context.results.modalDiscoveries,
      newlyDiscoveredCount: context.results.links.length,
      goldenPath,
      actionChain: context.actionChain,
      functionalPath: context.results.links.map(l => l.path).flat().join(' > ')
    };
  }
}
