# TestMaker Architecture & Refactoring Proposal

> 최초 작성: 2026-01-14
> 최종 수정: 2026-01-21
> 상태: 진행 중

---

## 1. 현재 상태 분석

### 1.1 전체 현황
- **총 식별 문제**: 25개
- **Critical**: 7개 (즉시 해결 필요)
- **High**: 10개 (2주 내 해결)
- **Medium**: 8개 (1개월 내 개선)

### 1.2 파일별 상태 (2026-01-14 기준)

| 파일 | 줄 수 | 상태 | 핵심 문제 |
|------|-------|------|-----------|
| `scraper.ts` | 1,119 | 🔴 Critical | 977줄 단일 함수, Static 경쟁조건 |
| `runner.ts` | 426 | 🟠 High | 가짜 병렬처리 (단일 Page 공유) |
| `server.ts` | 565 | 🟡 Medium | 매 요청마다 파일 스캔 |
| `types.ts` | 33 | 🟡 Medium | 타입 강화 필요 |
| `RecoveryManager.ts` | 36 | 🟢 Good | 모범 사례 |
| `NetworkManager.ts` | 37 | 🟢 Good | 양호 |

### 1.3 현재 아키텍처 (2026-01-21 기준)

**강점**:
- Explorer 패턴의 독립성 (NavExplorer, ContentExplorer, ActionExplorer)
- 서비스 계층 분리 (TransformerService, GeneratorService, AnalyzerService)
- Singleton 패턴 (SessionManager, RLStateManager)
- 모듈별 폴더 분리 완료 (`src/cli/`, `src/scraper/`, `src/shared/`)

**약점**:
- Playwright API 직접 의존 → 테스트 어려움
- 절차적 실행 흐름 → 확장성 제한
- actionChain 수동 관리 → 오류 발생 가능

---

## 2. 아키텍처 패턴 비교 분석

| 패턴 | 실현가능성 | 확장성 | 유지보수 | 오류검출 | 난이도 | 우선순위 |
|------|-----------|--------|---------|---------|--------|----------|
| **Command Pattern** | ⭐⭐⭐⭐⭐ 95% | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Medium | 🔴 **High** |
| **Strategy Pattern** | ⭐⭐⭐⭐⭐ 95% | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Medium | 🔴 **High** |
| **Hexagonal Architecture** | ⭐⭐⭐ 70% | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | High | 🟡 Medium |
| **Event-Driven** | ⭐⭐⭐ 65% | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | High | 🟢 Low |

---

## 3. 실행 계획

### Phase 1: Quick Wins + Command Pattern (1-2주)

#### 3.1.1 Command Pattern 도입

**적용 우선순위**:

| 순위 | 대상 | 파일 | 이유 |
|------|------|------|------|
| 1순위 | `smartClick()` | `UISettler.ts` L220-248 | 모든 Explorer에서 호출, 가장 영향력 큼 |
| 2순위 | `exploreTableRows()` | `ContentExplorer.ts` | Row 클릭 로직 반복 |
| 3순위 | Filter 조작 | `FilterExplorer.ts` | Select/Checkbox 조작 패턴화 |

**현재 문제 (UISettler.smartClick L220-248)**:
```typescript
// ❌ 액션 수동 기록, 재시도 로직 산재
await createBtn.click();
actionChain.push({ type: 'click', target: 'Create', timestamp: Date.now() });
```

**개선안**:
```typescript
// ✅ 자동 로깅 + 재시도 중앙화
interface ICommand {
    execute(): Promise<void>;
    undo?(): Promise<void>;
    describe(): ActionRecord;
}

class ClickCommand implements ICommand {
    constructor(private locator: Locator, private metadata: { target: string }) {}

    async execute() { await this.locator.click(); }

    describe(): ActionRecord {
        return { type: 'click', target: this.metadata.target, timestamp: Date.now() };
    }
}

class CommandExecutor {
    private history: ICommand[] = [];
    private maxRetries = 3;

    async execute(command: ICommand): Promise<void> {
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                await command.execute();
                this.history.push(command);
                console.log(`[Executor] ✓ ${command.describe().type}`);
                return;
            } catch (e) {
                if (attempt < this.maxRetries) {
                    await new Promise(r => setTimeout(r, 1000 * attempt));
                }
            }
        }
        throw new Error('Command failed after retries');
    }

    getHistory(): ActionRecord[] {
        return this.history.map(c => c.describe());
    }
}
```

**효과**:
- ✅ 디버깅 시간 30% 감소
- ✅ 재시도 로직 일관성
- ✅ Recorder 기능과 자연스러운 통합

#### 3.1.2 Dashboard 파일 감시자 (✅ 완료)

```typescript
// 개선: chokidar 파일 감시자 + 메모리 캐시
class ScreenshotCache {
    private cache: Map<string, ScreenshotMeta> = new Map();
    private watcher: FSWatcher;

    constructor() {
        this.watcher = chokidar.watch('output/**/*.webp');
        this.watcher.on('add', path => this.onAdd(path));
    }

    getAll(): ScreenshotMeta[] {
        return Array.from(this.cache.values());
    }
}
```

**결과**: 응답 시간 500ms → 1ms (500배 개선)

---

### Phase 2: Scraper 분할 + Strategy Pattern (2-3주)

#### 3.2.1 현재 구조 문제

```
scraper.ts (1,119줄)
└── run() 메서드 (977줄) ← 단일 거대 함수
    ├── Phase 1: Navigation
    ├── Phase 2: SPA Interception
    ├── Phase 3: Stability Wait
    ├── Phase 4: Menu Expansion
    ├── Phase 5: Sidebar Discovery
    ├── Phase 6: Row-Click Discovery
    ├── Phase 7: Global Action
    └── Phase 8: Full Extraction
```

#### 3.2.2 목표 구조 (Strategy Pattern)

```
src/scraper/
├── index.ts                    # Scraper 클래스 (오케스트레이션)
├── commands/                   # Command Pattern
│   ├── ICommand.ts
│   ├── ClickCommand.ts
│   ├── InputCommand.ts
│   ├── NavigateCommand.ts
│   └── CommandExecutor.ts
├── phases/                     # Strategy Pattern
│   ├── IExplorationPhase.ts
│   ├── StabilityPhase.ts
│   ├── MenuExpansionPhase.ts
│   ├── TabExplorationPhase.ts
│   ├── SidebarDiscoveryPhase.ts
│   ├── RowClickDiscoveryPhase.ts
│   ├── GlobalActionPhase.ts
│   ├── ExtractionPhase.ts
│   └── ExplorationOrchestrator.ts
├── explorers/
├── services/
├── queue/
└── lib/
```

#### 3.2.3 Strategy Pattern 구현

```typescript
interface IExplorationPhase {
    name: string;
    execute(context: ExplorationContext): Promise<PhaseResult>;
}

class ExplorationOrchestrator {
    private phases: IExplorationPhase[] = [];

    addPhase(phase: IExplorationPhase) {
        this.phases.push(phase);
    }

    async execute(context: ExplorationContext) {
        for (const phase of this.phases) {
            console.log(`[Orchestrator] Executing: ${phase.name}`);
            const result = await phase.execute(context);
            if (!result.success) break;
        }
    }
}

// 사용
const orchestrator = new ExplorationOrchestrator();
orchestrator.addPhase(new StabilityPhase());
orchestrator.addPhase(new MenuExpansionPhase());
orchestrator.addPhase(new TabExplorationPhase());
// Phase 순서를 외부에서 제어 가능
```

**효과**:
- 단일 함수 977줄 → 평균 80줄/Phase
- Cyclomatic Complexity 50 → 10
- Phase 추가/제거/재배치가 설정으로 가능

---

### Phase 3: Static 상태 제거 + Context 패턴 (1주)

#### 3.3.1 현재 문제

```typescript
// ❌ Static 변수가 모든 인스턴스에서 공유 → 경쟁 조건
class Scraper {
    private static lastScreenshotHash: string | null = null;
    private static capturedModalHashes = new Set<string>();
    private static visitedSidebarButtons = new Set<string>();
}
```

#### 3.3.2 개선안: Context 패턴

```typescript
// ✅ Context로 상태 격리
interface ExplorationContext {
    page: Page;
    url: string;
    state: ExplorationState;
    results: ExplorationResults;
    executor: CommandExecutor;  // Command Pattern 통합
}

interface ExplorationState {
    lastScreenshotHash: string | null;
    capturedModalHashes: Set<string>;
    visitedSidebarButtons: Set<string>;
    visitedExpansionButtons: Set<string>;
}

// 각 탐색마다 새 Context 생성
function createContext(job: ScrapeJob): ExplorationContext {
    return {
        page: null,
        url: job.url,
        state: {
            lastScreenshotHash: null,
            capturedModalHashes: new Set(),
            visitedSidebarButtons: new Set(),
            visitedExpansionButtons: new Set(),
        },
        results: { elements: [], links: [], modals: [] },
        executor: new CommandExecutor(),
    };
}
```

---

### Phase 4: Hexagonal Architecture (4-6주)

#### 3.4.1 점진적 분리 대상

1. **QueueManager** → QueuePolicy (Pure Logic) + QueueAdapter
2. **ScoringProcessor** → ScoringEngine (Pure Logic) + PageDataAdapter
3. **NetworkManager** → NetworkPolicy + PlaywrightNetworkAdapter

#### 3.4.2 구현 예시

```typescript
// Core Domain (Pure Logic)
class ExplorationEngine {
    constructor(private browserAdapter: IBrowserAdapter) {}

    async explore(job: ExplorationJob): Promise<ExplorationResult> {
        await this.browserAdapter.navigate(job.url);
        await this.browserAdapter.waitForStability();
        const viewport = await this.browserAdapter.captureViewport();
        // 비즈니스 로직만 포함
    }
}

// Infrastructure Layer
interface IBrowserAdapter {
    navigate(url: string): Promise<void>;
    waitForStability(): Promise<void>;
    captureViewport(): Promise<ViewportData>;
}

class PlaywrightAdapter implements IBrowserAdapter {
    constructor(private page: Page) {}

    async navigate(url: string) {
        await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    }

    async waitForStability() {
        await this.page.waitForLoadState('networkidle');
    }
}
```

**효과**:
- 단위 테스트 커버리지 60% → 85%
- Playwright 교체 시 Adapter만 변경
- 비즈니스 로직 격리

---

### Phase 5: Event-Driven Architecture (RL 시점)

#### 3.5.1 적용 시점
Phase 3 RL 시스템 도입 시

#### 3.5.2 구현 개요

```typescript
// Publisher
class Scraper {
    constructor(private eventBus: IEventBus) {}

    async scrape(page: Page, job: ScrapeJob) {
        await page.goto(job.url);
        this.eventBus.publish('page.loaded', { url: job.url });

        const elements = await this.extractElements(page);
        this.eventBus.publish('elements.discovered', { elements });
    }
}

// Subscribers (독립적)
class RLLearnerSubscriber {
    constructor(eventBus: IEventBus) {
        eventBus.subscribe('action.completed', this.learn.bind(this));
    }
}
```

---

## 4. 성능 최적화

### 4.1 동기 I/O 제거

```typescript
// ❌ 현재 (동기)
import { writeFileSync, existsSync } from 'fs';

// ✅ 개선 (비동기)
import { writeFile, access } from 'fs/promises';
```

### 4.2 DOM 순회 최적화

```typescript
// ❌ 현재: 개별 요소마다 evaluate 호출
for (const el of elements) {
    const text = await el.evaluate(e => e.textContent);
}

// ✅ 개선: 단일 evaluate로 모든 데이터 수집
const data = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('*'))
        .map(el => ({ tag: el.tagName, text: el.textContent }));
});
```

### 4.3 Busy-Wait 제거

```typescript
// ❌ 현재
while (!isStable) {
    await page.waitForTimeout(100);
    isStable = await checkStability();
}

// ✅ 개선: MutationObserver 기반
await page.evaluate(() => {
    return new Promise(resolve => {
        const observer = new MutationObserver((_, obs) => {
            clearTimeout(timer);
            timer = setTimeout(() => { obs.disconnect(); resolve(); }, 500);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    });
});
```

---

## 5. 실행 로드맵

| Phase | 작업 | 기간 | 우선순위 | 상태 |
|-------|------|------|----------|------|
| 1.1 | Command Pattern 도입 | 1주 | 🔴 Critical | ⏳ 대기 |
| 1.2 | Dashboard 캐시 | 1일 | 🟠 High | ✅ 완료 |
| 2 | Strategy Pattern (Phase 분할) | 2주 | 🔴 Critical | ⏳ 대기 |
| 3 | Context 패턴 (Static 제거) | 1주 | 🟠 High | ⏳ 대기 |
| 4 | Hexagonal Architecture | 4-6주 | 🟡 Medium | ⏳ 대기 |
| 5 | Event-Driven | RL 시점 | 🟢 Low | ⏳ 대기 |

**총 예상 기간**: 8-10주

---

## 6. 예상 결과

| 지표 | 현재 | 목표 | 개선율 |
|------|------|------|--------|
| 페이지당 처리 시간 | 30초 | 8초 | 3.75배 |
| Dashboard 응답 | ~~500ms~~ 1ms | 1ms | ✅ 완료 |
| 메모리 사용량 | 500MB | 300MB | 40%↓ |
| Cyclomatic Complexity | 50 | 10 | 5배 |
| 테스트 커버리지 | ~5% | 85%+ | 17배 |

---

## 7. 현재 테스트 커버리지

| 모듈 | 상태 | 비고 |
|------|------|------|
| QueueManager | ✅ 23 tests | 완료 |
| ScoringProcessor | ✅ | 완료 |
| SessionManager | ✅ | 완료 |
| NetworkManager | ✅ | 완료 |
| **UISettler** | ❌ 없음 | **우선 작성 필요** |
| **Scraper** | ❌ 없음 | Phase 분리 후 작성 |

---

## 8. 즉시 실행 액션 플랜

| 순서 | 작업 | 상태 |
|------|------|------|
| 1 | `UISettler.smartClick()` 테스트 작성 | ⏳ |
| 2 | `ClickCommand` + `CommandExecutor` 프로토타입 | ⏳ |
| 3 | `NavExplorer`에 적용하여 검증 | ⏳ |
| 4 | 나머지 Explorer에 점진 적용 | ⏳ |

---

## 9. 위험 요소

### 기술적 위험
| 위험 | 확률 | 영향 | 완화 방안 |
|------|------|------|-----------|
| Playwright API 변경 | Medium | High | Adapter 레이어로 격리 |
| 과도한 추상화 | High | Medium | YAGNI 원칙 준수 |
| 리팩토링 중 기능 훼손 | Medium | High | 테스트 커버리지 먼저 확보 |

### 하지 말아야 할 것
- ❌ 전체 시스템 한 번에 재작성 (Big Bang Refactoring)
- ❌ 아직 필요 없는 기능을 위한 추상화
- ❌ 테스트 없이 리팩토링 진행

### 먼저 할 것
- ✅ 현재 기능에 대한 테스트 커버리지 확보
- ✅ 점진적 적용 (한 모듈씩)
- ✅ 리팩토링 전후 동작 비교 검증

---

## 10. 다음 단계

1. **Phase 1.1 시작**: Command Pattern 구현
   - `src/scraper/commands/` 폴더 생성
   - ICommand, ClickCommand, CommandExecutor 구현
   - ActionExplorer에 우선 적용

2. **테스트 작성**: 리팩토링 전 현재 동작 검증 테스트

3. **점진적 마이그레이션**: 기존 코드 유지하면서 새 구조로 전환

---

Last Updated: 2026-01-21
