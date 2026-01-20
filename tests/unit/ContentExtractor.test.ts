import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContentExtractor, PageContent } from '../../src/regression/ContentExtractor';
import { Page } from 'playwright';

describe('ContentExtractor', () => {
    let extractor: ContentExtractor;
    let mockPage: Page;

    beforeEach(() => {
        extractor = new ContentExtractor();
        mockPage = {
            evaluate: vi.fn()
        } as unknown as Page;
    });

    const createMockPageContent = (overrides: Partial<PageContent> = {}): PageContent => ({
        url: 'https://example.com/test',
        pageTitle: 'Test Page',
        headings: { h1: [], h2: [], h3: [] },
        tables: [],
        buttons: [],
        inputs: [],
        links: [],
        ...overrides
    });

    describe('extract()', () => {
        it('should call page.evaluate to extract content', async () => {
            const mockContent = createMockPageContent();
            vi.mocked(mockPage.evaluate).mockResolvedValue(mockContent);

            await extractor.extract(mockPage);

            expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
            expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function));
        });

        it('should return extracted page content', async () => {
            const mockContent = createMockPageContent({
                pageTitle: 'My Test Page',
                url: 'https://example.com/page'
            });
            vi.mocked(mockPage.evaluate).mockResolvedValue(mockContent);

            const result = await extractor.extract(mockPage);

            expect(result.pageTitle).toBe('My Test Page');
            expect(result.url).toBe('https://example.com/page');
        });

        it('should extract headings correctly', async () => {
            const mockContent = createMockPageContent({
                headings: {
                    h1: ['Main Title'],
                    h2: ['Section 1', 'Section 2'],
                    h3: ['Subsection A', 'Subsection B', 'Subsection C']
                }
            });
            vi.mocked(mockPage.evaluate).mockResolvedValue(mockContent);

            const result = await extractor.extract(mockPage);

            expect(result.headings.h1).toHaveLength(1);
            expect(result.headings.h1[0]).toBe('Main Title');
            expect(result.headings.h2).toHaveLength(2);
            expect(result.headings.h3).toHaveLength(3);
        });

        it('should extract tables with structure', async () => {
            const mockContent = createMockPageContent({
                tables: [
                    {
                        name: 'users-table',
                        headers: ['ID', 'Name', 'Email'],
                        rowCount: 10,
                        location: 'main-content'
                    },
                    {
                        name: 'table-1',
                        headers: ['Product', 'Price'],
                        rowCount: 5,
                        location: 'sidebar'
                    }
                ]
            });
            vi.mocked(mockPage.evaluate).mockResolvedValue(mockContent);

            const result = await extractor.extract(mockPage);

            expect(result.tables).toHaveLength(2);
            expect(result.tables[0].name).toBe('users-table');
            expect(result.tables[0].headers).toContain('ID');
            expect(result.tables[0].headers).toContain('Name');
            expect(result.tables[0].headers).toContain('Email');
            expect(result.tables[0].rowCount).toBe(10);
            expect(result.tables[1].rowCount).toBe(5);
        });

        it('should extract buttons', async () => {
            const mockContent = createMockPageContent({
                buttons: ['Submit', 'Cancel', 'Delete']
            });
            vi.mocked(mockPage.evaluate).mockResolvedValue(mockContent);

            const result = await extractor.extract(mockPage);

            expect(result.buttons).toHaveLength(3);
            expect(result.buttons).toContain('Submit');
            expect(result.buttons).toContain('Cancel');
            expect(result.buttons).toContain('Delete');
        });

        it('should extract input fields', async () => {
            const mockContent = createMockPageContent({
                inputs: [
                    { label: 'Email', type: 'email', placeholder: 'Enter email' },
                    { label: 'Password', type: 'password' },
                    { label: 'Remember me', type: 'checkbox' }
                ]
            });
            vi.mocked(mockPage.evaluate).mockResolvedValue(mockContent);

            const result = await extractor.extract(mockPage);

            expect(result.inputs).toHaveLength(3);
            expect(result.inputs[0].label).toBe('Email');
            expect(result.inputs[0].type).toBe('email');
            expect(result.inputs[0].placeholder).toBe('Enter email');
            expect(result.inputs[1].type).toBe('password');
        });

        it('should extract links', async () => {
            const mockContent = createMockPageContent({
                links: ['Home', 'About', 'Contact', 'Privacy Policy']
            });
            vi.mocked(mockPage.evaluate).mockResolvedValue(mockContent);

            const result = await extractor.extract(mockPage);

            expect(result.links).toHaveLength(4);
            expect(result.links).toContain('Home');
            expect(result.links).toContain('Privacy Policy');
        });

        it('should handle empty page content', async () => {
            const mockContent = createMockPageContent({
                headings: { h1: [], h2: [], h3: [] },
                tables: [],
                buttons: [],
                inputs: [],
                links: []
            });
            vi.mocked(mockPage.evaluate).mockResolvedValue(mockContent);

            const result = await extractor.extract(mockPage);

            expect(result.headings.h1).toHaveLength(0);
            expect(result.tables).toHaveLength(0);
            expect(result.buttons).toHaveLength(0);
            expect(result.inputs).toHaveLength(0);
            expect(result.links).toHaveLength(0);
        });

        it('should handle complex page with multiple elements', async () => {
            const mockContent = createMockPageContent({
                pageTitle: 'Dashboard - Admin Panel',
                headings: {
                    h1: ['Dashboard'],
                    h2: ['Users', 'Products', 'Orders'],
                    h3: ['Active Users', 'Pending Orders']
                },
                tables: [
                    { name: 'users', headers: ['ID', 'Name', 'Role'], rowCount: 50, location: 'users-section' },
                    { name: 'orders', headers: ['Order ID', 'Amount', 'Status'], rowCount: 25, location: 'orders-section' }
                ],
                buttons: ['Add User', 'Export', 'Refresh', 'Settings'],
                inputs: [
                    { label: 'Search', type: 'text', placeholder: 'Search...' },
                    { label: 'Filter by date', type: 'date' }
                ],
                links: ['Dashboard', 'Users', 'Products', 'Orders', 'Settings', 'Logout']
            });
            vi.mocked(mockPage.evaluate).mockResolvedValue(mockContent);

            const result = await extractor.extract(mockPage);

            expect(result.pageTitle).toBe('Dashboard - Admin Panel');
            expect(result.headings.h1).toContain('Dashboard');
            expect(result.headings.h2).toHaveLength(3);
            expect(result.tables).toHaveLength(2);
            expect(result.buttons).toHaveLength(4);
            expect(result.inputs).toHaveLength(2);
            expect(result.links).toHaveLength(6);
        });

        it('should handle table with no headers', async () => {
            const mockContent = createMockPageContent({
                tables: [
                    { name: 'data-table', headers: [], rowCount: 20, location: 'main' }
                ]
            });
            vi.mocked(mockPage.evaluate).mockResolvedValue(mockContent);

            const result = await extractor.extract(mockPage);

            expect(result.tables[0].headers).toHaveLength(0);
            expect(result.tables[0].rowCount).toBe(20);
        });

        it('should handle input without placeholder', async () => {
            const mockContent = createMockPageContent({
                inputs: [
                    { label: 'Username', type: 'text' },
                    { label: 'Age', type: 'number' }
                ]
            });
            vi.mocked(mockPage.evaluate).mockResolvedValue(mockContent);

            const result = await extractor.extract(mockPage);

            expect(result.inputs[0].placeholder).toBeUndefined();
            expect(result.inputs[1].placeholder).toBeUndefined();
        });
    });
});
