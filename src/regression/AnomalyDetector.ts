import { ContentDiff } from './ContentComparator.js';

export interface AnomalyReport {
    severity: 'CRITICAL' | 'WARNING' | 'INFO';
    score: number; // 0-100
    issues: AnomalyIssue[];
    recommendation: string;
}

export interface AnomalyIssue {
    type: 'CRITICAL_BUTTON_REMOVED' | 'REQUIRED_FIELD_MISSING' |
    'TABLE_DELETED' | 'BROKEN_LINK' | 'COLUMN_REMOVED';
    severity: 'CRITICAL' | 'WARNING' | 'INFO';
    element: string;
    description: string;
    impact: string;
}

export class AnomalyDetector {
    private criticalButtonPatterns = [
        /submit/i, /save/i, /create/i, /delete/i, /confirm/i,
        /apply/i, /update/i, /send/i, /post/i, /add/i,
        /remove/i, /edit/i, /new/i
    ];

    private criticalInputPatterns = [
        /email/i, /password/i, /username/i, /name/i, /user/i
    ];

    detect(contentDiff: ContentDiff): AnomalyReport {
        const issues: AnomalyIssue[] = [];
        let score = 0;

        // 1. Critical buttons removed
        const criticalButtonsRemoved = contentDiff.buttons.removed.filter(btn =>
            this.criticalButtonPatterns.some(pattern => pattern.test(btn))
        );

        criticalButtonsRemoved.forEach(btn => {
            issues.push({
                type: 'CRITICAL_BUTTON_REMOVED',
                severity: 'CRITICAL',
                element: btn,
                description: `Critical button "${btn}" was removed`,
                impact: 'Users cannot perform critical action'
            });
            score += 30;
        });

        // 2. Critical buttons added (less severe but still notable)
        const criticalButtonsAdded = contentDiff.buttons.added.filter(btn =>
            this.criticalButtonPatterns.some(pattern => pattern.test(btn))
        );

        if (criticalButtonsAdded.length > 0) {
            issues.push({
                type: 'CRITICAL_BUTTON_REMOVED', // reuse type
                severity: 'INFO',
                element: criticalButtonsAdded.join(', '),
                description: `New critical buttons added: ${criticalButtonsAdded.join(', ')}`,
                impact: 'New functionality available to users'
            });
        }

        // 3. Required fields removed
        const criticalInputsRemoved = contentDiff.inputs.removed.filter(input =>
            this.criticalInputPatterns.some(pattern => pattern.test(input.label))
        );

        criticalInputsRemoved.forEach(input => {
            issues.push({
                type: 'REQUIRED_FIELD_MISSING',
                severity: 'CRITICAL',
                element: input.label,
                description: `Required field "${input.label}" is missing`,
                impact: 'Form submission may fail'
            });
            score += 25;
        });

        // 4. Tables deleted
        if (contentDiff.tables.removed.length > 0) {
            contentDiff.tables.removed.forEach(table => {
                issues.push({
                    type: 'TABLE_DELETED',
                    severity: 'WARNING',
                    element: table.name || 'unnamed',
                    description: `Table "${table.name}" was deleted`,
                    impact: 'Data display functionality lost'
                });
                score += 15;
            });
        }

        // 5. Important columns removed
        contentDiff.tables.modified.forEach(tableDiff => {
            if (tableDiff.headerDiff.removed.length > 0) {
                issues.push({
                    type: 'COLUMN_REMOVED',
                    severity: 'WARNING',
                    element: tableDiff.name,
                    description: `Columns removed from "${tableDiff.name}": ${tableDiff.headerDiff.removed.join(', ')}`,
                    impact: 'Data may be hidden from users'
                });
                score += 10;
            }
        });

        return {
            severity: this.calculateSeverity(score),
            score: Math.min(100, score),
            issues,
            recommendation: this.getRecommendation(score, issues)
        };
    }

    private calculateSeverity(score: number): 'CRITICAL' | 'WARNING' | 'INFO' {
        if (score >= 70) return 'CRITICAL';
        if (score >= 40) return 'WARNING';
        return 'INFO';
    }

    private getRecommendation(score: number, issues: AnomalyIssue[]): string {
        if (score >= 70) {
            const criticalCount = issues.filter(i => i.severity === 'CRITICAL').length;
            return `CRITICAL: ${criticalCount} critical issue(s) found. Do not deploy. Immediate review required.`;
        }
        if (score >= 40) {
            return 'WARNING: Review changes before deployment.';
        }
        if (issues.length > 0) {
            return `INFO: ${issues.length} minor change(s) detected. Consider reviewing.`;
        }
        return 'INFO: No significant anomalies detected.';
    }
}
