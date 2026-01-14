# TestMaker 리팩토링 계획

> 작성일: 2026-01-14
> 상태: 계획 수립 완료, 구현 대기

---

## 분석 요약

### 전체 현황
- **총 식별 문제**: 25개
- **Critical**: 7개 (즉시 해결 필요)
- **High**: 10개 (2주 내 해결)
- **Medium**: 8개 (1개월 내 개선)

### 파일별 상태

| 파일 | 줄 수 | 상태 | 핵심 문제 |
|------|-------|------|-----------|
| `scraper.ts` | 1,119 | 🔴 Critical | 977줄 단일 함수, Static 경쟁조건 |
| `runner.ts` | 426 | 🟠 High | 가짜 병렬처리 (단일 Page 공유) |
| `server.ts` | 565 | 🟡 Medium | 매 요청마다 파일 스캔 |
| `types.ts` | 33 | 🟡 Medium | 타입 강화 필요 |
| `RecoveryManager.ts` | 36 | 🟢 Good | 모범 사례 |
| `NetworkManager.ts` | 37 | 🟢 Good | 양호 |

---

## Phase 1: Quick Wins (1주)

### 1.1 Runner Page Pool 구현

**현재 문제 (runner.ts)**:
```typescript
// 현재: 모든 탭이 동일한 page 공유 → 가짜 병렬처리
const page = await context.newPage();
for (const job of jobs) {
  await scraper.run(page, job); // 순차 실행
}
```

**개선안**:
```typescript
// 개선: Page Pool로 진짜 병렬처리
class PagePool {
  private pages: Page[] = [];
  private available: Page[] = [];

  async acquire(): Promise<Page> { ... }
  release(page: Page): void { ... }
}

// 사용
const pool = new PagePool(context, concurrency);
await Promise.all(jobs.map(async job => {
  const page = await pool.acquire();
  try {
    await scraper.run(page, job);
  } finally {
    pool.release(page);
  }
}));
```

**예상 효과**: 처리 속도 3배 향상

---

### 1.2 Dashboard 파일 감시자

**현재 문제 (server.ts)**:
```typescript
// 현재: 매 API 호출마다 파일 시스템 스캔
app.get('/api/screenshots', async (req, res) => {
  const files = await glob('output/**/*.webp'); // 500ms+
  // ...
});
```

**개선안**:
```typescript
// 개선: chokidar 파일 감시자 + 메모리 캐시
import chokidar from 'chokidar';

class ScreenshotCache {
  private cache: Map<string, ScreenshotMeta> = new Map();
  private watcher: FSWatcher;

  constructor() {
    this.watcher = chokidar.watch('output/**/*.webp');
    this.watcher.on('add', path => this.onAdd(path));
    this.watcher.on('unlink', path => this.cache.delete(path));
  }

  getAll(): ScreenshotMeta[] {
    return Array.from(this.cache.values());
  }
}
```

**예상 효과**: 응답 시간 500ms → 1ms (500배)

---

## Phase 2: Scraper 분할 (2주)

### 2.1 현재 구조 문제

```
scraper.ts (1,119줄)
└── run() 메서드 (977줄) ← 단일 거대 함수
    ├── Phase 1: Navigation
    ├── Phase 2: SPA Interception
    ├── Phase 3: Stability Wait
    ├── Phase 3.5: Early Screenshot
    ├── Phase 4: Menu Expansion
    ├── Phase 4.5: Auto-Scroll
    ├── Phase 5: Sidebar Discovery
    ├── Phase 6: Row-Click Discovery
    ├── Phase 7: Global Action
    └── Phase 8: Full Extraction
```

### 2.2 목표 구조

```
src/core/scraper/
├── index.ts              # Scraper 클래스 (오케스트레이션만)
├── phases/
│   ├── BasePhase.ts      # 추상 베이스 클래스
│   ├── NavigationPhase.ts
│   ├── SPAInterceptionPhase.ts
│   ├── StabilityPhase.ts
│   ├── ScreenshotPhase.ts
│   ├── MenuExpansionPhase.ts
│   ├── AutoScrollPhase.ts
│   ├── SidebarDiscoveryPhase.ts
│   ├── RowClickDiscoveryPhase.ts
│   ├── GlobalActionPhase.ts
│   └── ExtractionPhase.ts
├── utils/
│   ├── domHelpers.ts     # closeModals, isModalOpen 등
│   └── screenshotHelpers.ts
└── types.ts              # Phase 관련 타입
```

### 2.3 Phase 패턴 구현

```typescript
// phases/BasePhase.ts
abstract class BasePhase {
  constructor(
    protected page: Page,
    protected context: ScraperContext
  ) {}

  abstract name: string;
  abstract execute(): Promise<PhaseResult>;

  protected log(message: string): void {
    console.log(`[${this.name}] ${message}`);
  }
}

// phases/NavigationPhase.ts
class NavigationPhase extends BasePhase {
  name = 'Navigation';

  async execute(): Promise<PhaseResult> {
    await this.page.goto(this.context.url);
    // 리다이렉트 처리...
    return { success: true };
  }
}

// index.ts
class Scraper {
  private phases: BasePhase[];

  async run(page: Page, job: ScrapeJob): Promise<ScrapeResult> {
    const context = this.createContext(job);
    this.phases = [
      new NavigationPhase(page, context),
      new SPAInterceptionPhase(page, context),
      // ...
    ];

    for (const phase of this.phases) {
      const result = await phase.execute();
      if (!result.success) break;
    }
  }
}
```

**예상 효과**:
- 단일 함수 977줄 → 평균 80줄/Phase
- Cyclomatic Complexity 50 → 10
- 테스트 용이성 대폭 향상

---

## Phase 3: Static 상태 제거 (1주)

### 3.1 현재 문제

```typescript
// scraper.ts - Static 변수가 모든 인스턴스에서 공유됨
class Scraper {
  private static lastScreenshotHash: string | null = null;
  private static capturedModalHashes = new Set<string>();
  private static visitedSidebarButtons = new Set<string>();
  private static visitedExpansionButtons = new Set<string>();
}
```

**문제점**:
- 멀티탭 실행 시 경쟁 조건 (Race Condition)
- 테스트 간 상태 오염
- 메모리 누수 (세션 간 캐시 유지)

### 3.2 개선안

```typescript
// ScraperContext로 상태 격리
interface ScraperContext {
  job: ScrapeJob;
  state: ScraperState;
}

interface ScraperState {
  lastScreenshotHash: string | null;
  capturedModalHashes: Set<string>;
  visitedSidebarButtons: Set<string>;
  visitedExpansionButtons: Set<string>;
}

// 탭 간 공유가 필요한 경우 SharedState 주입
class SharedState {
  private locks = new Map<string, Promise<void>>();

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // 뮤텍스 구현
  }
}
```

---

## Phase 4: 성능 최적화 (2주)

### 4.1 동기 I/O 제거

```typescript
// 현재 (동기)
import { writeFileSync, existsSync } from 'fs';

// 개선 (비동기)
import { writeFile, access } from 'fs/promises';
```

### 4.2 DOM 순회 최적화

```typescript
// 현재: 개별 요소마다 evaluate 호출
for (const el of elements) {
  const text = await el.evaluate(e => e.textContent);
}

// 개선: 단일 evaluate로 모든 데이터 수집
const data = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('*'))
    .map(el => ({
      tag: el.tagName,
      text: el.textContent,
      // ...
    }));
});
```

### 4.3 Busy-Wait 제거

```typescript
// 현재
while (!isStable) {
  await page.waitForTimeout(100); // Busy-wait
  isStable = await checkStability();
}

// 개선: MutationObserver 기반
await page.evaluate(() => {
  return new Promise(resolve => {
    const observer = new MutationObserver((_, obs) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        obs.disconnect();
        resolve();
      }, 500);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
});
```

---

## 실행 일정

| Phase | 작업 | 예상 기간 | 우선순위 |
|-------|------|-----------|----------|
| 1.1 | Page Pool 구현 | 2일 | 🔴 Critical |
| 1.2 | Dashboard 캐시 | 1일 | 🟠 High |
| 2 | Scraper Phase 분할 | 5일 | 🔴 Critical |
| 3 | Static 상태 제거 | 2일 | 🟠 High |
| 4 | 성능 최적화 | 5일 | 🟡 Medium |

**총 예상 기간**: 3주

---

## 예상 결과

| 지표 | 현재 | 목표 | 개선율 |
|------|------|------|--------|
| 페이지당 처리 시간 | 30초 | 8초 | 3.75배 |
| Dashboard 응답 | 500ms | 1ms | 500배 |
| 메모리 사용량 | 500MB | 300MB | 40%↓ |
| Cyclomatic Complexity | 50 | 10 | 5배 |
| 테스트 커버리지 | ~5% | 60%+ | 12배 |

---

## 다음 단계

1. **Phase 1.1 시작**: runner.ts Page Pool 구현
2. **테스트 작성**: 리팩토링 전 현재 동작 검증 테스트
3. **점진적 마이그레이션**: 기존 코드 유지하면서 새 구조로 전환

---

Last Updated: 2026-01-14
