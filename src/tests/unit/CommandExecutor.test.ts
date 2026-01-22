import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Playwright types
const mockPage = {
    url: vi.fn(() => 'https://example.com'),
    waitForTimeout: vi.fn(),
    mouse: {
        click: vi.fn()
    }
};

const mockHandle = {
    innerText: vi.fn(() => Promise.resolve('Button Text')),
    getAttribute: vi.fn(() => Promise.resolve('btn-class')),
    boundingBox: vi.fn(() => Promise.resolve({ x: 100, y: 100, width: 50, height: 30 })),
    click: vi.fn(),
    evaluate: vi.fn()
};

// Import after mocks
import { ActionRecord } from '../../types/index.js';
import { QueueManager } from '../../scraper/queue/QueueManager.js';
import { ScraperConfig } from '../../types/scraper.js';
import { CommandExecutor } from '../../scraper/commands/CommandExecutor.js';
import { ClickCommand } from '../../scraper/commands/ClickCommand.js';
import { CommandContext, Command } from '../../scraper/commands/Command.js';

describe('CommandExecutor', () => {
    let actionChain: ActionRecord[];
    let ctx: CommandContext;

    beforeEach(() => {
        actionChain = [];
        ctx = {
            page: mockPage as any,
            actionChain,
            networkManager: undefined
        };
        vi.clearAllMocks();
    });

    describe('execute', () => {
        it('should execute command successfully on first attempt', async () => {
            const executor = new CommandExecutor(ctx);
            const mockCommand: Command = {
                type: 'test',
                label: 'Test Command',
                execute: vi.fn().mockResolvedValue(undefined),
                toRecord: vi.fn()
            };

            await executor.execute(mockCommand);

            expect(mockCommand.execute).toHaveBeenCalledWith(ctx);
            expect(mockCommand.execute).toHaveBeenCalledTimes(1);
        });

        it('should retry on failure and succeed', async () => {
            const executor = new CommandExecutor(ctx, { maxRetries: 3, retryDelayMs: 10 });
            const mockCommand: Command = {
                type: 'test',
                label: 'Retry Command',
                execute: vi.fn()
                    .mockRejectedValueOnce(new Error('First fail'))
                    .mockRejectedValueOnce(new Error('Second fail'))
                    .mockResolvedValue(undefined),
                toRecord: vi.fn()
            };

            await executor.execute(mockCommand);

            expect(mockCommand.execute).toHaveBeenCalledTimes(3);
        });

        it('should throw after max retries exceeded', async () => {
            const executor = new CommandExecutor(ctx, { maxRetries: 2, retryDelayMs: 10 });
            const mockCommand: Command = {
                type: 'test',
                label: 'Always Fail',
                execute: vi.fn().mockRejectedValue(new Error('Always fails')),
                toRecord: vi.fn()
            };

            await expect(executor.execute(mockCommand)).rejects.toThrow('Always fails');
            expect(mockCommand.execute).toHaveBeenCalledTimes(3); // 1 base + 2 retries
        });

        it('should execute at least once even if maxRetries is 0', async () => {
            const executor = new CommandExecutor(ctx, { maxRetries: 0 });
            const mockCommand: Command = {
                type: 'test',
                label: 'Single Attempt',
                execute: vi.fn().mockResolvedValue(undefined),
                toRecord: vi.fn()
            };

            await executor.execute(mockCommand);

            expect(mockCommand.execute).toHaveBeenCalledTimes(1);
        });
    });

    describe('executeAll', () => {
        it('should execute multiple commands sequentially', async () => {
            const executor = new CommandExecutor(ctx);
            const order: number[] = [];

            const commands: Command[] = [
                {
                    type: 'test',
                    label: 'First',
                    execute: vi.fn().mockImplementation(async () => { order.push(1); }),
                    toRecord: vi.fn()
                },
                {
                    type: 'test',
                    label: 'Second',
                    execute: vi.fn().mockImplementation(async () => { order.push(2); }),
                    toRecord: vi.fn()
                }
            ];

            await executor.executeAll(commands);

            expect(order).toEqual([1, 2]);
        });
    });
});

describe('ClickCommand', () => {
    let actionChain: ActionRecord[];
    let ctx: CommandContext;

    beforeEach(() => {
        actionChain = [];
        ctx = {
            page: mockPage as any,
            actionChain,
            networkManager: undefined
        };
        vi.clearAllMocks();
    });

    it('should add action record to chain on execute', async () => {
        const command = new ClickCommand(mockHandle as any, { label: 'Test Button' });

        await command.execute(ctx);

        expect(actionChain).toHaveLength(1);
        expect(actionChain[0].type).toBe('click');
        expect(actionChain[0].label).toBe('Test Button');
    });

    it('should use coordinate-based clicking when boundingBox is available', async () => {
        const command = new ClickCommand(mockHandle as any);

        await command.execute(ctx);

        expect(mockPage.mouse.click).toHaveBeenCalledWith(125, 115); // center of box
    });

    it('should extract label from element if not provided', async () => {
        const command = new ClickCommand(mockHandle as any);

        await command.execute(ctx);

        expect(actionChain[0].label).toBe('Button Text');
    });

    it('should generate correct ActionRecord', () => {
        const command = new ClickCommand(mockHandle as any, {
            label: 'Submit',
            selector: '.submit-btn'
        });

        const record = command.toRecord('https://test.com');

        expect(record.type).toBe('click');
        expect(record.label).toBe('Submit');
        expect(record.selector).toBe('.submit-btn');
        expect(record.url).toBe('https://test.com');
    });
});
