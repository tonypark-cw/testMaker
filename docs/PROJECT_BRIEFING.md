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
| Supervisor | src/core/supervisor.ts | 프로세스 감시, 하트비트, 자동 재시작 |
| Scraper | src/core/scraper.ts | 페이지 탐색, 요소 추출, 스크린샷 |
| Analyzer | scripts/analyzer.ts | 요소 분석, 시나리오 생성 |
| Generator | scripts/generator.ts | Markdown/Playwright/JSON 출력 |
| Dashboard | src/dashboard/server.ts | 실시간 모니터링 UI |
| Healer | src/core/healer.ts | 테스트 실패 시 자가 치유 컨텍스트 캡처 |

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
| Healer Crash | Accessibility snapshot error | Added page.accessibility check |
| Session Bleed | Shared temp-auth.json | Subdomain-specific auth naming |

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
| Dashboard (Web UI) | ✅ |
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

## Dashboard Architecture

### File Structure (Refactored)

```
src/dashboard/
├── index.html          # Clean HTML (no inline styles/scripts)
├── styles/
│   ├── main.css        # Base styles, CSS variables
│   ├── header.css      # Header, stats cards, runner box
│   ├── gallery.css     # Grid, shot cards, badges
│   └── modal.css       # Lightbox, QA toolbar
└── scripts/
    ├── main.js         # Entry point, initialization
    ├── state.js        # Centralized state management
    ├── api.js          # API calls (fetch, start, stop)
    ├── gallery.js      # Gallery rendering, filters
    └── modal.js        # Modal logic, navigation
```

### Refactoring Phases

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | CSS 분리 (main, header, gallery, modal) | ✅ Done |
| Phase 2 | JS 모듈 분리 (state, api, gallery, modal) | ✅ Done |
| Phase 3 | HTML 정리 (인라인 코드 제거) | ✅ Done |
| Phase 4 | API 중앙화 | ✅ Done |
| Phase 5 | Dashboard 기능 강화 (Depth, QA, Golden) | ✅ Done |
| Phase 6 | Component Functions (Optional) | ❌ Not Started |

### Phase 5: Dashboard Enhancements (Completed & Verified)

#### 목표
1. **Depth Filtering**: URL 계층 구조(Depth)에 따른 필터링 (Level 1: 메인, Level 2: 서브, Level 3+: 상세)
2. **QA Filters**: 검토 상태에 따른 필터링 (PASS, FAIL, BLOCK, UNTAGGED)
3. **Golden Path Strategy**: 골든 패스 테스트(`main_flow.spec.ts`)에서 생성된 파일(`golden_` prefix)만 검증된 것으로 식별 및 별도 탭 분리

#### 필터 목록
- **Type**: ALL, MODAL, DETAIL, PAGE
- **Depth**: LEVEL 1, LEVEL 2, LEVEL 3+
- **QA**: UNTAGGED, PASS, FAIL
- **Special**: GOLDEN (Source-verified via `golden_` prefix)

#### 구현 상태 (2026-01-12)

| 기능 | 구현 상태 | 파일 |
|------|----------|------|
| **Dashboard UI Refactoring** | ✅ 완료 | index.html, header.css |
| - 3-Row Header Layout | ✅ 완료 | Title/Stats, Controls, Filters+Date |
| - Sort Filter 제거 | ✅ 완료 | User request |
| **Confidence Score Integration** | ✅ 완료 | server.ts, gallery.js |
| - JSON Metadata Injection | ✅ 완료 | server.ts (goldenPath.confidence) |
| - Tooltip Display | ✅ 완료 | gallery.js (Golden Path items) |
| **Filter Functionality** | ✅ 완료 | gallery.js, main.js |
| - Type 필터 (ALL/MODAL/DETAIL/PAGE) | ✅ 완료 | gallery.js |
| - Depth 필터 (LEVEL 1/2/3+) | ✅ 완료 | gallery.js |
| - QA 필터 (UNTAGGED/PASS/FAIL) | ✅ 완료 | gallery.js |
| - window.setFilter 노출 | ✅ 완료 | main.js |
| **Golden Path Strategy** | ✅ 완료 | gallery.js, main_flow.spec.ts |
| - Source Verification (golden_ prefix) | ✅ 완료 | isGolden() function |
| - Default Tab: EXPLORATION | ✅ 완료 | state.js, main.js |
| **Modal Navigation** | ✅ 완료 | modal.js |
| - Object-based Screenshot Array | ✅ 완료 | findIndex with URL extraction |
| - Prev/Next Buttons | ✅ 완료 | Keyboard arrows (←/→) |
| **Stats Display** | ✅ 완료 | main.js |
| - Golden Path Count | ✅ 완료 | Object array filtering |
| - Exploration Count | ✅ 완료 | exp-count element |
| **Supervisor Control** | ✅ 완료 | about.html, server.ts |
| - Stop Button | ✅ 완료 | /api/stop-supervisor |
| - Status Display | ✅ 완료 | supervisorStatus field fix |
| - Timestamp Display | ✅ 완료 | Real-time updates |
| Screenshot Deduplication (Latest) | ✅ 완료 | server.ts |
| Client IP Monitoring | ✅ 완료 | server.ts |

---

## Agent & Skill Architecture (Omitted for brevity)

---

## Team Protocols (Omitted for brevity)

---

## Capture History Fixes & Optimization (Completed)

---

## Code Health Status

**Last Verified**: 2026-01-12 (Current Session)

| Component | Status | Notes |
|:----------|:-------|:------|
| TypeScript Compilation | ✅ Pass | No errors |
| IDE Diagnostics | ✅ Clean | All files |
| testMaker Core | ✅ Healthy | Phase 9 (Protocol filtering) implemented |
| Golden Path Tests | ✅ Running | via Supervisor |
| Dashboard Refactoring | ✅ Complete | Status Sync Fixed |

---

Last Updated: 2026-01-12
