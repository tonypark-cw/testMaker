# Refactoring Phase 3: Hexagonal Architecture (Planning 1/3)

## Goal
Decouple Scraper logic from Playwright to improve testability and modularity.

## Proposed Interfaces

### 1. BrowserPage (`src/scraper/adapters/BrowserPage.ts`)
Standardizes page-level operations.

```typescript
export interface BrowserPage {
    url(): string;
    title(): Promise<string>;
    goto(url: string, options?: NavigationOptions): Promise<void>;
    evaluate<T>(fn: string | ((...args: any[]) => T), ...args: any[]): Promise<T>;
    screenshot(options?: ScreenshotOptions): Promise<Buffer>;
    waitForSelector(selector: string, options?: WaitOptions): Promise<BrowserElement | null>;
    waitForFunction(fn: string | ((...args: any[]) => boolean), options?: WaitOptions): Promise<void>;
    addInitScript(fn: string | ((...args: any[]) => void), arg?: any): Promise<void>;
}
```

### 2. BrowserContext (`src/scraper/adapters/BrowserContext.ts`)
Standardizes network and event-level operations (needed for NetworkManager).

```typescript
export interface BrowserContext {
    route(pattern: string | RegExp, handler: (route: any) => Promise<void>): Promise<void>;
    on(event: 'request' | 'response', handler: (data: any) => Promise<void>): void;
    newPage(): Promise<BrowserPage>;
}
```

### 3. BrowserElement (`src/scraper/adapters/BrowserElement.ts`)
Standardizes element-level interactions.

```typescript
export interface BrowserElement {
    getAttribute(name: string): Promise<string | null>;
    innerText(): Promise<string>;
    boundingBox(): Promise<Rect | null>;
    click(options?: ClickOptions): Promise<void>;
    fill(value: string): Promise<void>;
    evaluate<T>(fn: (el: any, ...args: any[]) => T, ...args: any[]): Promise<T>;
}
```

## Transition Map

| Component | Files | Impact |
|-----------|-------|--------|
| **Core Adapters** | `adapters/*.ts` | [NEW] Interface definitions |
| **Concrete Adapters**| `adapters/playwright/*.ts` | [NEW] Playwright implementation |
| **Commands** | `commands/` | Switch `Page` to `BrowserPage`, `Locator` to `BrowserElement` |
| **Phases** | `phases/` | Unified execution with abstract interfaces |
| **Orchestration** | `runner.ts`, `index.ts` | Inject appropriate adapters during startup |
| **Sub-Agents** | `.agent/workflows/agents/*.md` | [NEW] Explicit Static Analysis (TSC/Lint) roles |

## Verification Plan

### 1. Static Verification
- Run `npx tsc --noEmit` to ensure type safety with the new abstract interfaces.
- Verify that `playwright` is only imported in `adapters/playwright/` and `runner.ts`.

### 2. Unit Testing
- Execute `npm run test:unit`.
- Primary target: `tests/unit/CommandExecutor.test.ts`.
- [NEW] Create `tests/unit/MockBrowserAdapter.test.ts` to verify that the Scraper logic works with a mock browser implementation.

### 3. Integration Testing
- Run a short search scan with `--limit 5` to verify end-to-end functionality.
- Compare screenshot and JSON output with the baseline to ensure no regressions in data extraction.

## Timeline
1. Create `src/scraper/adapters/` interfaces and Playwright implementation.
2. Migrating `CommandContext` and Base Commands.
3. Migrating Phase classes and Explorers.
4. Final verification and cleanup.
