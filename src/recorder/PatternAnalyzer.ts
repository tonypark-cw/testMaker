/**
 * PatternAnalyzer
 * Extracts patterns from recorded sessions for Imitation Learning.
 * 
 * Features:
 * - Compresses keystroke sequences into final values
 * - Extracts page-level action patterns
 * - Generates priority weights for Scraper
 */

import * as fs from 'fs';
import * as path from 'path';

interface RecordedEvent {
    type: string;
    selector: string;
    tagName?: string;
    innerText?: string;
    timestamp: number;
    location: string;
    value?: string;
    network?: string[];
}

interface RecordedSession {
    url: string;
    timestamp: string;
    events: RecordedEvent[];
}

interface CompressedAction {
    type: string;
    selector: string;
    label: string;
    page: string;
    value?: string;
}

interface PagePattern {
    page: string;
    actions: CompressedAction[];
    frequency: number;
}

interface LearningOutput {
    sessionFile: string;
    analyzedAt: string;
    totalRawEvents: number;
    totalCompressedActions: number;
    pagePatterns: PagePattern[];
    actionFrequency: Record<string, number>;
    priorityWeights: Record<string, number>;
}

export class PatternAnalyzer {
    private outputDir: string;

    constructor(outputDir: string = './output/learning') {
        this.outputDir = outputDir;
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    /**
     * Analyze a recorded session and extract patterns.
     */
    analyze(sessionPath: string): LearningOutput {
        console.log(`[PatternAnalyzer] Loading session: ${sessionPath}`);

        const raw = fs.readFileSync(sessionPath, 'utf-8');
        const session: RecordedSession = JSON.parse(raw);

        console.log(`[PatternAnalyzer] Raw events: ${session.events.length}`);

        // Step 1: Compress input sequences
        const compressed = this.compressEvents(session.events);
        console.log(`[PatternAnalyzer] Compressed actions: ${compressed.length}`);

        // Step 2: Extract page patterns
        const pagePatterns = this.extractPagePatterns(compressed);

        // Step 3: Calculate action frequency
        const actionFrequency = this.calculateFrequency(compressed);

        // Step 4: Generate priority weights
        const priorityWeights = this.generateWeights(pagePatterns, actionFrequency);

        const output: LearningOutput = {
            sessionFile: path.basename(sessionPath),
            analyzedAt: new Date().toISOString(),
            totalRawEvents: session.events.length,
            totalCompressedActions: compressed.length,
            pagePatterns,
            actionFrequency,
            priorityWeights
        };

        // Save results
        const outputPath = path.join(this.outputDir, `analysis-${Date.now()}.json`);
        fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
        console.log(`[PatternAnalyzer] ✅ Analysis saved to: ${outputPath}`);

        this.printSummary(output);

        return output;
    }

    /**
     * Compress keystroke sequences into final values.
     * e.g., [input "c", input "ch", change "chan"] → [input_complete "chan"]
     */
    private compressEvents(events: RecordedEvent[]): CompressedAction[] {
        const compressed: CompressedAction[] = [];
        let lastInputSelector: string | null = null;
        let lastInputValue: string | null = null;

        for (const event of events) {
            const page = this.extractPagePath(event.location);

            if (event.type === 'input') {
                // Track input but don't emit yet
                lastInputSelector = event.selector;
                lastInputValue = event.value || '';
                continue;
            }

            if (event.type === 'change' && lastInputSelector === event.selector) {
                // Emit compressed input
                compressed.push({
                    type: 'input_complete',
                    selector: event.selector,
                    label: event.tagName || 'input',
                    page,
                    value: event.value || lastInputValue || ''
                });
                lastInputSelector = null;
                lastInputValue = null;
                continue;
            }

            if (event.type === 'click') {
                // Emit click action
                const label = (event.innerText || '').trim().substring(0, 30) || event.tagName || 'element';
                compressed.push({
                    type: 'click',
                    selector: event.selector,
                    label,
                    page
                });
            }
        }

        return compressed;
    }

    /**
     * Extract patterns grouped by page.
     */
    private extractPagePatterns(actions: CompressedAction[]): PagePattern[] {
        const pageMap = new Map<string, CompressedAction[]>();

        for (const action of actions) {
            if (!pageMap.has(action.page)) {
                pageMap.set(action.page, []);
            }
            pageMap.get(action.page)!.push(action);
        }

        return Array.from(pageMap.entries()).map(([page, actions]) => ({
            page,
            actions,
            frequency: actions.length
        })).sort((a, b) => b.frequency - a.frequency);
    }

    /**
     * Calculate action frequency by label.
     */
    private calculateFrequency(actions: CompressedAction[]): Record<string, number> {
        const freq: Record<string, number> = {};

        for (const action of actions) {
            const key = `${action.type}:${action.label}`;
            freq[key] = (freq[key] || 0) + 1;
        }

        return Object.fromEntries(
            Object.entries(freq).sort((a, b) => b[1] - a[1])
        );
    }

    /**
     * Generate priority weights for Scraper.
     */
    private generateWeights(
        pagePatterns: PagePattern[],
        actionFrequency: Record<string, number>
    ): Record<string, number> {
        const weights: Record<string, number> = {};
        const maxFreq = Math.max(...Object.values(actionFrequency), 1);

        // Page weights
        const maxPageFreq = Math.max(...pagePatterns.map(p => p.frequency), 1);
        for (const pattern of pagePatterns) {
            weights[`page:${pattern.page}`] = pattern.frequency / maxPageFreq;
        }

        // Action weights
        for (const [action, freq] of Object.entries(actionFrequency)) {
            weights[`action:${action}`] = freq / maxFreq;
        }

        return weights;
    }

    /**
     * Extract page path from URL.
     */
    private extractPagePath(url: string): string {
        try {
            const parsed = new URL(url);
            return parsed.pathname;
        } catch {
            return url;
        }
    }

    /**
     * Print analysis summary.
     */
    private printSummary(output: LearningOutput): void {
        console.log('\n═══════════════════════════════════════');
        console.log('📊 SESSION ANALYSIS SUMMARY');
        console.log('───────────────────────────────────────');
        console.log(`Raw Events:       ${output.totalRawEvents}`);
        console.log(`Compressed:       ${output.totalCompressedActions}`);
        console.log(`Pages Visited:    ${output.pagePatterns.length}`);
        console.log('───────────────────────────────────────');
        console.log('🔝 Top Pages:');
        output.pagePatterns.slice(0, 5).forEach(p => {
            console.log(`   ${p.page}: ${p.frequency} actions`);
        });
        console.log('───────────────────────────────────────');
        console.log('🔝 Top Actions:');
        Object.entries(output.actionFrequency).slice(0, 5).forEach(([action, freq]) => {
            console.log(`   ${action}: ${freq}`);
        });
        console.log('═══════════════════════════════════════\n');
    }
}
