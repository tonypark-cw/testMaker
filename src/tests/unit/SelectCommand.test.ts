import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionRecord } from '../../types/index.js';
import { CommandContext } from '../../scraper/commands/Command.js';
import { SelectCommand } from '../../scraper/commands/SelectCommand.js';

// Mock BrowserPage
const createMockPage = () => ({
    url: vi.fn(() => 'https://example.com'),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    keyboardPress: vi.fn().mockResolvedValue(undefined)
});

// Mock CommandTarget (BrowserElement)
const createMockTarget = (overrides = {}) => ({
    getAttribute: vi.fn().mockResolvedValue(null),
    selectOption: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    ...overrides
});

describe('SelectCommand', () => {
    let actionChain: ActionRecord[];
    let ctx: CommandContext;
    let mockPage: ReturnType<typeof createMockPage>;

    beforeEach(() => {
        actionChain = [];
        mockPage = createMockPage();
        ctx = {
            page: mockPage as any,
            actionChain,
            networkManager: undefined
        };
        vi.clearAllMocks();
    });

    describe('execute', () => {
        it('should select by value when value is provided', async () => {
            const mockTarget = createMockTarget();
            const command = new SelectCommand(mockTarget as any, {
                value: 'option-1',
                label: 'Select Value'
            });

            await command.execute(ctx);

            expect(mockTarget.selectOption).toHaveBeenCalledWith({ value: 'option-1' });
            expect(actionChain).toHaveLength(1);
            expect(actionChain[0].type).toBe('select');
        });

        it('should select by index when index is provided', async () => {
            const mockTarget = createMockTarget();
            const command = new SelectCommand(mockTarget as any, {
                index: 2,
                label: 'Select Index'
            });

            await command.execute(ctx);

            expect(mockTarget.selectOption).toHaveBeenCalledWith({ index: 2 });
        });

        it('should select by label when labelText is provided', async () => {
            const mockTarget = createMockTarget();
            const command = new SelectCommand(mockTarget as any, {
                labelText: 'Option Label',
                label: 'Select Label'
            });

            await command.execute(ctx);

            expect(mockTarget.selectOption).toHaveBeenCalledWith({ label: 'Option Label' });
        });

        it('should use fallback when selectOption throws', async () => {
            const mockTarget = createMockTarget({
                selectOption: vi.fn().mockRejectedValue(new Error('Select failed'))
            });
            const command = new SelectCommand(mockTarget as any, {
                index: 1,
                label: 'Fallback Test'
            });

            await command.execute(ctx);

            // Should have called click and keyboard navigation
            expect(mockTarget.click).toHaveBeenCalled();
            expect(mockPage.keyboardPress).toHaveBeenCalledWith('ArrowDown');
            expect(mockPage.keyboardPress).toHaveBeenCalledWith('Enter');
        });
    });

    describe('fallbackSelect boundary conditions', () => {
        it('should press ArrowDown once when selectIndex is 0', async () => {
            const mockTarget = createMockTarget({
                selectOption: vi.fn().mockRejectedValue(new Error('Force fallback'))
            });
            const command = new SelectCommand(mockTarget as any, {
                index: 0,
                label: 'Index 0'
            });

            await command.execute(ctx);

            // index=0 should press ArrowDown exactly 1 time (0 + 1)
            const arrowDownCalls = mockPage.keyboardPress.mock.calls.filter(
                (call: string[]) => call[0] === 'ArrowDown'
            );
            expect(arrowDownCalls).toHaveLength(1);
        });

        it('should press ArrowDown twice when selectIndex is 1', async () => {
            const mockTarget = createMockTarget({
                selectOption: vi.fn().mockRejectedValue(new Error('Force fallback'))
            });
            const command = new SelectCommand(mockTarget as any, {
                index: 1,
                label: 'Index 1'
            });

            await command.execute(ctx);

            // index=1 should press ArrowDown exactly 2 times (1 + 1)
            const arrowDownCalls = mockPage.keyboardPress.mock.calls.filter(
                (call: string[]) => call[0] === 'ArrowDown'
            );
            expect(arrowDownCalls).toHaveLength(2);
        });

        it('should press ArrowDown 5 times when selectIndex is 4', async () => {
            const mockTarget = createMockTarget({
                selectOption: vi.fn().mockRejectedValue(new Error('Force fallback'))
            });
            const command = new SelectCommand(mockTarget as any, {
                index: 4,
                label: 'Index 4'
            });

            await command.execute(ctx);

            // index=4 should press ArrowDown exactly 5 times (4 + 1)
            const arrowDownCalls = mockPage.keyboardPress.mock.calls.filter(
                (call: string[]) => call[0] === 'ArrowDown'
            );
            expect(arrowDownCalls).toHaveLength(5);
        });

        it('should press ArrowDown once when selectIndex is undefined', async () => {
            const mockTarget = createMockTarget({
                selectOption: vi.fn().mockRejectedValue(new Error('Force fallback'))
            });
            const command = new SelectCommand(mockTarget as any, {
                label: 'No Index'
            });

            await command.execute(ctx);

            // undefined index should default to 1 ArrowDown press
            const arrowDownCalls = mockPage.keyboardPress.mock.calls.filter(
                (call: string[]) => call[0] === 'ArrowDown'
            );
            expect(arrowDownCalls).toHaveLength(1);
        });

        it('should press ArrowDown once when selectIndex is negative', async () => {
            const mockTarget = createMockTarget({
                selectOption: vi.fn().mockRejectedValue(new Error('Force fallback'))
            });
            const command = new SelectCommand(mockTarget as any, {
                index: -1,
                label: 'Negative Index'
            });

            await command.execute(ctx);

            // negative index should be treated like undefined (1 ArrowDown)
            const arrowDownCalls = mockPage.keyboardPress.mock.calls.filter(
                (call: string[]) => call[0] === 'ArrowDown'
            );
            expect(arrowDownCalls).toHaveLength(1);
        });

        it('should always press Enter after ArrowDown presses', async () => {
            const mockTarget = createMockTarget({
                selectOption: vi.fn().mockRejectedValue(new Error('Force fallback'))
            });
            const command = new SelectCommand(mockTarget as any, {
                index: 2,
                label: 'Enter Test'
            });

            await command.execute(ctx);

            const enterCalls = mockPage.keyboardPress.mock.calls.filter(
                (call: string[]) => call[0] === 'Enter'
            );
            expect(enterCalls).toHaveLength(1);
        });
    });

    describe('toRecord', () => {
        it('should generate correct ActionRecord with value', () => {
            const mockTarget = createMockTarget();
            const command = new SelectCommand(mockTarget as any, {
                value: 'test-value',
                label: 'Test Select',
                selector: '#select-box'
            });

            const record = command.toRecord('https://test.com');

            expect(record.type).toBe('select');
            expect(record.label).toBe('Test Select');
            expect(record.value).toBe('test-value');
            expect(record.url).toBe('https://test.com');
        });

        it('should generate correct ActionRecord with index', () => {
            const mockTarget = createMockTarget();
            const command = new SelectCommand(mockTarget as any, {
                index: 3,
                label: 'Index Select'
            });

            const record = command.toRecord('https://test.com');

            expect(record.value).toBe('index:3');
        });

        it('should use default value when none provided', () => {
            const mockTarget = createMockTarget();
            const command = new SelectCommand(mockTarget as any, {
                label: 'Default Select'
            });

            const record = command.toRecord('https://test.com');

            expect(record.value).toBe('default');
        });
    });
});
