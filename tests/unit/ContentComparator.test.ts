import { describe, it, expect, beforeEach } from 'vitest';
import { ContentComparator, ContentDiff } from '../../src/regression/ContentComparator';
import { PageContent, TableStructure } from '../../src/regression/ContentExtractor';

describe('ContentComparator', () => {
    let comparator: ContentComparator;

    beforeEach(() => {
        comparator = new ContentComparator();
    });

    const createBaseContent = (): PageContent => ({
        url: 'https://example.com/test',
        pageTitle: 'Test Page',
        headings: { h1: ['Main Title'], h2: ['Subtitle'], h3: [] },
        tables: [],
        buttons: ['Submit', 'Cancel'],
        inputs: [
            { label: 'Email', type: 'email', placeholder: 'Enter email' },
            { label: 'Password', type: 'password' }
        ],
        links: ['Home', 'About']
    });

    describe('compare()', () => {
        it('should return 100% score for identical content', () => {
            const baseline = createBaseContent();
            const current = createBaseContent();

            const result = comparator.compare(baseline, current);

            expect(result.score).toBe(100);
            expect(result.pageTitle.match).toBe(true);
            expect(result.buttons.added).toHaveLength(0);
            expect(result.buttons.removed).toHaveLength(0);
        });

        it('should detect page title change', () => {
            const baseline = createBaseContent();
            const current = createBaseContent();
            current.pageTitle = 'New Title';

            const result = comparator.compare(baseline, current);

            expect(result.pageTitle.match).toBe(false);
            expect(result.pageTitle.baseline).toBe('Test Page');
            expect(result.pageTitle.current).toBe('New Title');
            expect(result.score).toBe(90); // -10 for title mismatch
        });

        it('should detect added buttons', () => {
            const baseline = createBaseContent();
            const current = createBaseContent();
            current.buttons = ['Submit', 'Cancel', 'New Button'];

            const result = comparator.compare(baseline, current);

            expect(result.buttons.added).toContain('New Button');
            expect(result.buttons.removed).toHaveLength(0);
            expect(result.score).toBe(98); // -2 for added button
        });

        it('should detect removed buttons', () => {
            const baseline = createBaseContent();
            const current = createBaseContent();
            current.buttons = ['Submit'];

            const result = comparator.compare(baseline, current);

            expect(result.buttons.removed).toContain('Cancel');
            expect(result.buttons.added).toHaveLength(0);
            expect(result.score).toBe(98); // -2 for removed button
        });

        it('should detect added inputs', () => {
            const baseline = createBaseContent();
            const current = createBaseContent();
            current.inputs = [
                ...baseline.inputs,
                { label: 'Phone', type: 'tel' }
            ];

            const result = comparator.compare(baseline, current);

            expect(result.inputs.added).toHaveLength(1);
            expect(result.inputs.added[0].label).toBe('Phone');
        });

        it('should detect removed inputs', () => {
            const baseline = createBaseContent();
            const current = createBaseContent();
            current.inputs = [{ label: 'Email', type: 'email' }];

            const result = comparator.compare(baseline, current);

            expect(result.inputs.removed).toHaveLength(1);
            expect(result.inputs.removed[0].label).toBe('Password');
        });
    });

    describe('table comparison', () => {
        it('should detect added tables', () => {
            const baseline = createBaseContent();
            const current = createBaseContent();
            current.tables = [{
                name: 'New Table',
                headers: ['ID', 'Name'],
                rowCount: 5,
                location: 'main'
            }];

            const result = comparator.compare(baseline, current);

            expect(result.tables.added).toHaveLength(1);
            expect(result.tables.added[0].name).toBe('New Table');
            expect(result.score).toBe(95); // -5 for added table
        });

        it('should detect removed tables', () => {
            const baseline = createBaseContent();
            baseline.tables = [{
                name: 'Users',
                headers: ['ID', 'Name', 'Email'],
                rowCount: 10,
                location: 'main'
            }];
            const current = createBaseContent();

            const result = comparator.compare(baseline, current);

            expect(result.tables.removed).toHaveLength(1);
            expect(result.tables.removed[0].name).toBe('Users');
            expect(result.score).toBe(95); // -5 for removed table
        });

        it('should detect modified tables (header changes)', () => {
            const baseline = createBaseContent();
            baseline.tables = [{
                name: 'Users',
                headers: ['ID', 'Name', 'Email'],
                rowCount: 10,
                location: 'main'
            }];

            const current = createBaseContent();
            current.tables = [{
                name: 'Users',
                headers: ['ID', 'Name', 'Role'], // Email removed, Role added
                rowCount: 10,
                location: 'main'
            }];

            const result = comparator.compare(baseline, current);

            expect(result.tables.modified).toHaveLength(1);
            expect(result.tables.modified[0].headerDiff.added).toContain('Role');
            expect(result.tables.modified[0].headerDiff.removed).toContain('Email');
        });

        it('should match tables by name', () => {
            const baseline = createBaseContent();
            baseline.tables = [
                { name: 'TableA', headers: ['A', 'B'], rowCount: 5, location: 'main' },
                { name: 'TableB', headers: ['X', 'Y'], rowCount: 3, location: 'side' }
            ];

            const current = createBaseContent();
            current.tables = [
                { name: 'TableB', headers: ['X', 'Y', 'Z'], rowCount: 3, location: 'side' },
                { name: 'TableA', headers: ['A', 'B'], rowCount: 5, location: 'main' }
            ];

            const result = comparator.compare(baseline, current);

            expect(result.tables.added).toHaveLength(0);
            expect(result.tables.removed).toHaveLength(0);
            expect(result.tables.modified).toHaveLength(1);
            expect(result.tables.modified[0].name).toBe('TableB');
        });

        it('should match tables by header similarity when name is generic', () => {
            const baseline = createBaseContent();
            baseline.tables = [{
                name: 'table-0',
                headers: ['ID', 'Name', 'Email', 'Status'],
                rowCount: 10,
                location: 'main'
            }];

            const current = createBaseContent();
            current.tables = [{
                name: 'table-1',
                headers: ['ID', 'Name', 'Email', 'Status', 'Role'],
                rowCount: 12,
                location: 'main'
            }];

            const result = comparator.compare(baseline, current);

            // Should match by header similarity (4/5 = 80% > 70% threshold)
            expect(result.tables.removed).toHaveLength(0);
            expect(result.tables.modified).toHaveLength(1);
        });
    });

    describe('score calculation', () => {
        it('should reduce score for multiple changes', () => {
            const baseline = createBaseContent();
            baseline.tables = [
                { name: 'Table1', headers: ['A'], rowCount: 1, location: '' },
                { name: 'Table2', headers: ['B'], rowCount: 1, location: '' }
            ];

            const current = createBaseContent();
            current.pageTitle = 'Changed Title';
            current.buttons = ['New'];
            current.tables = [];

            const result = comparator.compare(baseline, current);

            // -10 (title) -2 (removed Submit) -2 (removed Cancel) -2 (added New) -5 (removed Table1) -5 (removed Table2) = 74
            expect(result.score).toBe(74);
        });

        it('should not go below 0', () => {
            const baseline = createBaseContent();
            baseline.tables = Array(30).fill(null).map((_, i) => ({
                name: `Table${i}`,
                headers: ['Col'],
                rowCount: 1,
                location: ''
            }));

            const current = createBaseContent();
            current.pageTitle = 'Changed';
            current.tables = [];

            const result = comparator.compare(baseline, current);

            expect(result.score).toBeGreaterThanOrEqual(0);
        });
    });
});
