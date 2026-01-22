import { describe, it, expect, beforeEach } from 'vitest';
import { AnomalyDetector, AnomalyReport } from '../../regression/AnomalyDetector.js';
import { ContentDiff } from '../../regression/ContentComparator.js';

describe('AnomalyDetector', () => {
    let detector: AnomalyDetector;

    beforeEach(() => {
        detector = new AnomalyDetector();
    });

    const createEmptyDiff = (): ContentDiff => ({
        pageTitle: { baseline: 'Test Page', current: 'Test Page', match: true },
        tables: { added: [], removed: [], modified: [] },
        buttons: { added: [], removed: [] },
        inputs: { added: [], removed: [] },
        score: 100
    });

    describe('detect()', () => {
        it('should return INFO severity when no issues found', () => {
            const diff = createEmptyDiff();
            const result = detector.detect(diff);

            expect(result.severity).toBe('INFO');
            expect(result.score).toBe(0);
            expect(result.issues).toHaveLength(0);
            expect(result.recommendation).toContain('No significant anomalies');
        });

        it('should detect critical button removal', () => {
            const diff = createEmptyDiff();
            diff.buttons.removed = ['Submit', 'Save'];

            const result = detector.detect(diff);

            expect(result.severity).toBe('WARNING');
            expect(result.score).toBe(60); // 30 * 2
            expect(result.issues).toHaveLength(2);
            expect(result.issues[0].type).toBe('CRITICAL_BUTTON_REMOVED');
            expect(result.issues[0].severity).toBe('CRITICAL');
        });

        it('should detect required field removal', () => {
            const diff = createEmptyDiff();
            diff.inputs.removed = [
                { label: 'Email', type: 'email', required: true },
                { label: 'Password', type: 'password', required: true }
            ];

            const result = detector.detect(diff);

            expect(result.issues).toHaveLength(2);
            expect(result.issues[0].type).toBe('REQUIRED_FIELD_MISSING');
            expect(result.score).toBe(50); // 25 * 2
        });

        it('should detect table deletion', () => {
            const diff = createEmptyDiff();
            diff.tables.removed = [
                { name: 'Users Table', headers: ['ID', 'Name'], rowCount: 10, location: 'body' }
            ];

            const result = detector.detect(diff);

            expect(result.issues).toHaveLength(1);
            expect(result.issues[0].type).toBe('TABLE_DELETED');
            expect(result.issues[0].severity).toBe('WARNING');
            expect(result.score).toBe(15);
        });

        it('should detect column removal from tables', () => {
            const diff = createEmptyDiff();
            diff.tables.modified = [{
                name: 'Users',
                headerDiff: {
                    added: [],
                    removed: ['Status', 'Role'],
                    reordered: false
                },
                rowCountChange: 0
            }];

            const result = detector.detect(diff);

            expect(result.issues).toHaveLength(1);
            expect(result.issues[0].type).toBe('COLUMN_REMOVED');
            expect(result.score).toBe(10);
        });

        it('should return CRITICAL severity when score >= 70', () => {
            const diff = createEmptyDiff();
            diff.buttons.removed = ['Submit', 'Delete', 'Confirm'];

            const result = detector.detect(diff);

            expect(result.severity).toBe('CRITICAL');
            expect(result.score).toBe(90); // 30 * 3
            expect(result.recommendation).toContain('CRITICAL');
            expect(result.recommendation).toContain('Do not deploy');
        });

        it('should return WARNING severity when score >= 40', () => {
            const diff = createEmptyDiff();
            diff.buttons.removed = ['Save'];
            diff.tables.removed = [
                { name: 'Data Table', headers: ['A', 'B'], rowCount: 5, location: 'body' }
            ];

            const result = detector.detect(diff);

            expect(result.severity).toBe('WARNING');
            expect(result.score).toBe(45); // 30 + 15
            expect(result.recommendation).toContain('WARNING');
        });

        it('should cap score at 100', () => {
            const diff = createEmptyDiff();
            diff.buttons.removed = ['Submit', 'Save', 'Delete', 'Update'];
            diff.inputs.removed = [
                { label: 'Email', type: 'email', required: true },
                { label: 'Password', type: 'password', required: true }
            ];

            const result = detector.detect(diff);

            expect(result.score).toBe(100);
        });

        it('should report added critical buttons as INFO', () => {
            const diff = createEmptyDiff();
            diff.buttons.added = ['New Submit', 'Create'];

            const result = detector.detect(diff);

            expect(result.issues).toHaveLength(1);
            expect(result.issues[0].severity).toBe('INFO');
            expect(result.issues[0].description).toContain('New critical buttons added');
        });

        it('should ignore non-critical button removals', () => {
            const diff = createEmptyDiff();
            diff.buttons.removed = ['Help', 'Info', 'Details'];

            const result = detector.detect(diff);

            expect(result.issues).toHaveLength(0);
            expect(result.score).toBe(0);
        });

        it('should ignore non-critical input removals', () => {
            const diff = createEmptyDiff();
            diff.inputs.removed = [
                { label: 'Notes', type: 'text', required: false },
                { label: 'Description', type: 'textarea', required: false }
            ];

            const result = detector.detect(diff);

            expect(result.issues).toHaveLength(0);
            expect(result.score).toBe(0);
        });
    });
});
