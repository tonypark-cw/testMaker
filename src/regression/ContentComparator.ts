import { PageContent, TableStructure, InputField } from './ContentExtractor.js';

export interface ContentDiff {
    pageTitle: { baseline: string; current: string; match: boolean };
    tables: {
        added: TableStructure[];
        removed: TableStructure[];
        modified: TableDiff[];
    };
    buttons: {
        added: string[];
        removed: string[];
    };
    inputs: {
        added: InputField[];
        removed: InputField[];
    };
    score: number; // 0-100, similarity score
}

export interface TableDiff {
    name: string;
    headerDiff: {
        added: string[];
        removed: string[];
        reordered: boolean;
    };
    rowCountChange: number;
}

export class ContentComparator {
    compare(baseline: PageContent, current: PageContent): ContentDiff {
        // Compare tables
        const tableDiff = this.compareTables(baseline.tables, current.tables);

        // Compare buttons
        const buttonDiff = {
            added: current.buttons.filter(b => !baseline.buttons.includes(b)),
            removed: baseline.buttons.filter(b => !current.buttons.includes(b))
        };

        // Compare inputs
        const inputDiff = this.compareInputs(baseline.inputs, current.inputs);

        // Calculate similarity score
        const score = this.calculateSimilarity(baseline, current, tableDiff, buttonDiff);

        return {
            pageTitle: {
                baseline: baseline.pageTitle,
                current: current.pageTitle,
                match: baseline.pageTitle === current.pageTitle
            },
            tables: tableDiff,
            buttons: buttonDiff,
            inputs: inputDiff,
            score
        };
    }

    private compareTables(baseline: TableStructure[], current: TableStructure[]): ContentDiff['tables'] {
        const added = current.filter(c => !this.findMatchingTable(c, baseline));
        const removed = baseline.filter(b => !this.findMatchingTable(b, current));

        const modified: TableDiff[] = [];

        for (const baseTable of baseline) {
            const currentTable = this.findMatchingTable(baseTable, current);
            if (currentTable) {
                const headerDiff = {
                    added: currentTable.headers.filter(h => !baseTable.headers.includes(h)),
                    removed: baseTable.headers.filter(h => !currentTable.headers.includes(h)),
                    reordered: !this.arraysEqual(baseTable.headers, currentTable.headers)
                };

                if (headerDiff.added.length > 0 || headerDiff.removed.length > 0 || headerDiff.reordered) {
                    modified.push({
                        name: baseTable.name || 'unknown',
                        headerDiff,
                        rowCountChange: currentTable.rowCount - baseTable.rowCount
                    });
                }
            }
        }

        return { added, removed, modified };
    }

    private findMatchingTable(target: TableStructure, list: TableStructure[]): TableStructure | undefined {
        // Match by name first
        if (target.name && !target.name.startsWith('table-')) {
            const nameMatch = list.find(t => t.name === target.name);
            if (nameMatch) return nameMatch;
        }

        // Match by header similarity
        return list.find(t => this.headerSimilarity(target.headers, t.headers) > 0.7);
    }

    private headerSimilarity(a: string[], b: string[]): number {
        if (a.length === 0 && b.length === 0) return 1;
        if (a.length === 0 || b.length === 0) return 0;

        const common = a.filter(h => b.includes(h)).length;
        return common / Math.max(a.length, b.length);
    }

    private arraysEqual(a: string[], b: string[]): boolean {
        return a.length === b.length && a.every((val, i) => val === b[i]);
    }

    private compareInputs(baseline: InputField[], current: InputField[]): ContentDiff['inputs'] {
        const baseLabels = baseline.map(i => i.label);
        const currLabels = current.map(i => i.label);

        return {
            added: current.filter(i => !baseLabels.includes(i.label)),
            removed: baseline.filter(i => !currLabels.includes(i.label))
        };
    }

    private calculateSimilarity(
        baseline: PageContent,
        current: PageContent,
        tableDiff: ContentDiff['tables'],
        buttonDiff: ContentDiff['buttons']
    ): number {
        let score = 100;

        // Page title mismatch: -10
        if (baseline.pageTitle !== current.pageTitle) score -= 10;

        // Tables
        score -= tableDiff.added.length * 5;
        score -= tableDiff.removed.length * 5;
        score -= tableDiff.modified.length * 3;

        // Buttons
        score -= buttonDiff.added.length * 2;
        score -= buttonDiff.removed.length * 2;

        return Math.max(0, score);
    }
}
