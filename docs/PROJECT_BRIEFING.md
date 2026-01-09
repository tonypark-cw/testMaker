# TestMaker v2.0 - Project Briefing

## Overview
TestMaker는 웹 애플리케이션을 자동으로 탐색하고 테스트 케이스를 생성하는 도구입니다.

## Architecture (v2.0)

### Multi-Tab Parallelism
```
Runner (or Worker)
├── BrowserContext (Single Session)
│   ├── Tab 1 (Scraper)
│   ├── Tab 2 (Scraper)
│   └── Tab 3 (Scraper)
├── Analyzer
├── Generator
└── Output (webp/json/trace)

Distributed Logging (New)
Terminal 1: npm run dashboard:server (UI + Job Queue)
Terminal 2: npm run worker (Execution + Analysis Logs)
```

### Core Components

| Component | File | Responsibility |
|-----------|------|----------------|
| CLI | src/core/cli.ts | 명령어 파싱, 옵션 처리 |
| Runner | src/core/runner.ts | 브라우저 관리, 작업 큐, 병렬 처리 |
| Scraper | src/core/scraper.ts | 페이지 탐색, 요소 추출, 스크린샷 |
| Analyzer | scripts/analyzer.ts | 요소 분석, 시나리오 생성 |
| Generator | scripts/generator.ts | Markdown/Playwright/JSON 출력 |
| Dashboard | src/dashboard/server.ts | 실시간 모니터링 UI |

---

## Scraper Phases (8 Phases)

| Phase | Name | Lines | Description |
|-------|------|-------|-------------|
| 1 | Navigation | L29-44 | 페이지 로드, /app/logged-in → /app/home 자동 리다이렉트 |
| 2 | SPA Route Interception | L205-218 | pushState/replaceState 후킹으로 SPA 라우트 감지 |
| 3 | Stability Wait | L220-247 | 로더 완료 대기 + MutationObserver 기반 DOM 안정화 |
| 4 | Menu Expansion | L249-298 | 접힌 메뉴 자동 확장 (캐시 기반 중복 방지) |
| 4.5 | Auto-Scroll | L300-322 | 페이지 스크롤로 lazy-load 콘텐츠 발견 |
| 5 | Sidebar Discovery | L324-409 | 사이드바 버튼 클릭 → 새 페이지/모달 발견 |
| 6 | Row-Click Discovery | L411-577 | 테이블 행 클릭 → 상세 페이지/모달 캡처 (네트워크 모니터링) |
| 7 | Global Action | L579-624 | Create/New/Add 버튼 자동 탐색 + JSON 메타데이터 저장 |

### Helper Functions (scraper.ts)

| Function | Lines | Description |
|----------|-------|-------------|
| `closeModals()` | L49-57 | ESC 키 + 닫기 버튼 클릭으로 모달/드로어 닫기 |
| `isModalOpen()` | L59-66 | 모달/드로어 열림 상태 확인 |
| `settleAndCleanup()` | L69-115 | Ghost 요소 CSS 숨김 + "Leave without saving" 자동 Stay 클릭 |
| `extractModalContent()` | L117-189 | 모달 내부 요소 추출 + 스크린샷 (MD5 중복 체크) |
| `smartClick()` | L192-203 | 좌표 기반 클릭 (SPA 이벤트 필터링 우회) |

### Static Caches (Cross-Tab Deduplication)

```typescript
// scraper.ts L10-15 - 모든 탭에서 공유되는 정적 캐시
private static lastScreenshotHash: string | null = null;      // L10: 마지막 페이지 스크린샷 해시
private static capturedModalHashes = new Set<string>();       // L11: 캡처된 모달 해시 (중복 방지)
private static visitedSidebarButtons = new Set<string>();     // L14: 방문한 사이드바 버튼 텍스트
private static visitedExpansionButtons = new Set<string>();   // L15: 확장한 메뉴 버튼 텍스트
```

---

## Screenshot Quality Controls

- **Blank Detection**: sharp.stats() - mean > 250 && stdev < 10 → skip
- **Duplicate Detection**: MD5 hash check
- **Ghost Cleanup**: settleAndCleanup() - CSS 숨김 처리

---

## Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| --url | env | 분석할 URL |
| --depth | 1 | 탐색 깊이 |
| --limit | 50 | 최대 페이지 수 |
| --concurrency | 3 | 병렬 탭 수 |
| --headless | true | Headless 모드 |
| --username | env | 로그인 이메일 |
| --password | env | 로그인 비밀번호 |

---

## Known Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| __name is not defined | esbuild helper in browser | Stack-based iteration |
| Login not working | SPA render timing | waitFor + transition handling |
| Ghost elements | Dropdown/popover stuck | settleAndCleanup() |
| Duplicate screenshots | Same modal, different trigger | MD5 hash check |
| Blank screenshots | Early capture / no permission | sharp.stats() skip |
| Header Crash | HTTP Headers sent twice | Remove duplicated server logic |
| Dropdown Clipping | overflow:hidden in modal title | overflow:visible + absolute positioning |
| Duplicate Badge Block | Badge overlaying cards | pointer-events: none on badge |

---

## Implementation Status

| Feature | Status |
|---------|--------|
| Multi-Tab Parallelism | ✅ |
| Auto Login | ✅ |
| SPA Route Interception | ✅ |
| Stability Wait | ✅ |
| Menu Expansion | ✅ |
| Sidebar Discovery | ✅ |
| Row-Click Discovery | ✅ |
| Global Action Discovery | ✅ |
| Ghost Element Cleanup | ✅ |
| Blank Screenshot Skip | ✅ |
| Duplicate Modal Skip | ✅ |
| Dashbaord (Web UI) | ✅ |
| Worker Mode (Isolated Logs) | ✅ |
| Metadata for all shots | ✅ |

---

## Run Commands

```bash
# Basic
npm run analyze -- --url "https://example.com"

# Deep analysis
npm run analyze -- --url "https://example.com" --depth 5 --limit 200

# Debug mode (visible browser)
npm run analyze -- --url "https://example.com" --no-headless

# Dashboard (Mixed Logs)
npm run dashboard

# Dashboard (Server Only - Clean Logs)
npm run dashboard:server

# Worker (Analysis Logs Only)
npm run worker
```

---

## Dashboard Refactoring Plan (index.html)

### Current Structure Analysis

| Section | Lines | Size | Content |
|---------|-------|------|---------|
| CSS (inline) | 7-386 | ~380 lines | All styles embedded in `<style>` |
| HTML | 389-474 | ~85 lines | Structure + inline event handlers |
| JavaScript | 476-1141 | ~665 lines | All logic in single `<script>` |
| **Total** | - | **1144 lines** | Single monolithic file |

### Identified Problems

| Category | Issue | Location |
|----------|-------|----------|
| Architecture | Single-file monolith | Entire file |
| State | 15+ global variables | Lines 480-491 |
| Events | Inline `onclick` handlers | Lines 400-460 |
| Styling | Dynamic CSS injection | Lines 1106-1139 |
| Constants | Magic numbers (BATCH_SIZE=24) | Line 494 |
| Separation | Mixed concerns (API, DOM, state) | JS section |

### Global State Variables (Current)

```javascript
// Lines 480-491 - All global, no encapsulation
let serverScreenshots = [];
let filteredScreenshots = [];
let visualScreenshots = [];
let tags = {};
let reasons = {};
let currentModalUrl = null;
let isModalOpen = false;
let currentFilter = 'ALL';
let currentStatusFilter = 'ALL';
let isRunning = false;
let queueLength = 0;
let lastScanTime = 0;
```

### Proposed File Structure

```
src/dashboard/
├── index.html          # Clean HTML (no inline styles/scripts)
├── styles/
│   ├── main.css        # Base styles, variables, reset
│   ├── header.css      # Header, stats cards, runner box
│   ├── filters.css     # Filter bar, badges
│   ├── gallery.css     # Grid, shot cards
│   └── modal.css       # Lightbox, QA toolbar, dropdown
└── scripts/
    ├── main.js         # Entry point, initialization
    ├── state.js        # Centralized state management
    ├── api.js          # API calls (update, startAnalysis, etc.)
    ├── filters.js      # Filter logic (setFilter, setStatusFilter)
    ├── gallery.js      # Gallery rendering (loadMore, createCard)
    ├── modal.js        # Modal logic (open, close, navigate)
    └── utils.js        # Helpers (getScreenshotType, debounce)
```

### Component Breakdown

| Component | Responsibilities | Current Lines |
|-----------|-----------------|---------------|
| Header | Title, stats cards, trace link | 391-421 |
| RunnerBox | URL input, start/stop/reanalyze buttons | 398-405 |
| FilterBar | Type filters (ALL/PAGE/MODAL/DETAIL/DUP), status filters | 423-438 |
| Gallery | Grid container, infinite scroll | 440-442 |
| ShotCard | Individual screenshot card, badges, lazy loading | createCard() |
| Modal | Lightbox, image display, navigation | 445-474 |
| QAToolbar | PASS/FAIL/BLOCK buttons, fail reason input | 457-469 |
| DropdownMenu | Duplicate URL selector in modal | Dynamic |

### Refactoring Phases

#### Phase 1: File Separation (Low Risk)
- Extract CSS to `styles/*.css` files
- Extract JS to `scripts/*.js` files
- Keep HTML structure unchanged
- Use `<link>` and `<script type="module">`

#### Phase 2: State Consolidation (Medium Risk)
- Create `state.js` with single state object
- Implement `getState()`, `setState()`, `subscribe()`
- Replace global variables with state access

#### Phase 3: Event Handler Migration (Medium Risk)
- Remove inline `onclick` attributes
- Use `addEventListener` in JS modules
- Implement event delegation for gallery cards

#### Phase 4: API Module (Low Risk)
- Extract all `fetch()` calls to `api.js`
- Add error handling and retry logic
- Centralize API_URL constant

#### Phase 5: Component Functions (Optional)
- Create render functions per component
- Implement virtual DOM diffing (if needed)
- Consider Preact/Alpine.js for reactivity

### Priority Order

1. **Phase 1** - Immediate (separation improves maintainability)
2. **Phase 4** - High (API centralization reduces bugs)
3. **Phase 2** - Medium (state management for complex updates)
4. **Phase 3** - Medium (cleaner HTML, better debugging)
5. **Phase 5** - Low (only if UI becomes more complex)

### Dependencies

- No build step required (vanilla JS modules work in modern browsers)
- Server must serve static files from `styles/` and `scripts/` directories

---

## Capture History Fixes & Optimization (Completed)

### Summary of Changes (2026-01-09)
1.  **Filtering**: Fixed QA Tag filter to include groups where *any* history item matches the status (PASS/FAIL), enabling history auditing.
2.  **Performance**: Implemented server-side memory caching (`snapshotCache`) in `server.ts` to reduce disk I/O latency during polling.
3.  **Infinite Scroll**: Added `IntersectionObserver` to `index.html` to automatically trigger `loadMore()` when scrolling to the bottom.
4.  **Duplicates**: Corrected DUP filter logic and ensured correct badge counts (PAGE/MODAL/DETAIL) in the dashboard stats.
5.  **Status Counters**: Fixed discrepancy where PASS/FAIL filter counts were 0; counting logic now correctly falls back to `shot.url` if `webUrl` is missing, matching the card rendering logic.
6.  **Data Persistence**: Relocated QA tags (`qa-tags.json`) and reasons (`qa-reasons.json`) to a dedicated `data/` directory to prevent accidental deletion when clearing the `output/` folder.

---

## AI Agent Workflow (New)

Added support for specialized sub-agents to enhance development workflow. These agents are defined in `.agent/styles/`.

| Agent | Role | Responsibility |
|-------|------|----------------|
| **Planning Agent** | Architect | Requirements analysis, task decomposition, architectural design, creating implementation plans. |
| **Analysis Agent** | Researcher | Debugging, log analysis, performance optimization research, best practice recommendations. |
| **Implementation Agent** | Developer | Writing code, refactoring, implementing features based on plans. |
| **Testing Agent** | QA Engineer | Writing unit/integration tests, verifying fixes, regression testing, ensuring quality standards. |
| **Curation Agent** | Editor | **Golden Path Generation**. Converts recorded action chains into robust Playwright test scripts ("Record -> Review -> Generate"). |
| **Orchestration Agent** | Director | **Team Coordination**. Facilitates debate, monitors progress, assigns tasks, and ensures process quality. |
| **Secretary Agent** | Scribe | **Admin & Reporting**. Handles Git, updates documentation, and summarizes progress in Korean. |

---

## Team Protocols (Authoritative)

The following rules defined in the Agent Skills (`.agent/styles/*.skill`) take precedence over all other documentation.

### 1. Source of Truth
- **Rule**: If `PROJECT_BRIEFING.md` or other docs conflict with `.agent/styles/*.skill`, the **Skill file prevails**.
- **Scope**: Applies to all agents and workflows.

### 2. Communication Protocol (Secretary Agent)
- **Bilingual Reporting**: All `notify_user` messages, status updates, and major reports MUST be provided in both **English** and **Korean**.
- **Tone**: Professional, concise, and helpful.

### 3. Execution Protocol (Orchestration Agent)
- **Divide & Conquer**: Complex tasks must be broken down into smaller, manageable sub-tasks.
- **5-Minute Time-Box**:
    -   **Limit**: Agents should not spend more than **5 minutes** in a "Thinking/Planning" loop without action.
    -   **Action**: If the limit is reached, stop thinking, log the current state, implement a partial solution, and iterate.
    -   **Goal**: Prevent analysis paralysis and ensure continuous momentum.

---

Last Updated: 2026-01-09
