# Dashboard Architecture

> Extracted from PROJECT_BRIEFING.md for detailed reference

## File Structure (Refactored)

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

---

## Refactoring Phases

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | CSS 분리 (main, header, gallery, modal) | ✅ Done |
| Phase 2 | JS 모듈 분리 (state, api, gallery, modal) | ✅ Done |
| Phase 3 | HTML 정리 (인라인 코드 제거) | ✅ Done |
| Phase 4 | API 중앙화 | ✅ Done |
| Phase 5 | Dashboard 기능 강화 (Depth, QA, Golden) | ✅ Done |
| Phase 6 | Component Functions (Optional) | ❌ Not Started |

---

## Phase 5: Dashboard Enhancements

### 목표
1. **Depth Filtering**: URL 계층 구조(Depth)에 따른 필터링 (Level 1: 메인, Level 2: 서브, Level 3+: 상세)
2. **QA Filters**: 검토 상태에 따른 필터링 (PASS, FAIL, BLOCK, UNTAGGED)
3. **Golden Path Strategy**: 골든 패스 테스트(`main_flow.spec.ts`)에서 생성된 파일(`golden_` prefix)만 검증된 것으로 식별 및 별도 탭 분리

### 필터 목록
- **Type**: ALL, MODAL, DETAIL, PAGE
- **Depth**: LEVEL 1, LEVEL 2, LEVEL 3+
- **QA**: UNTAGGED, PASS, FAIL
- **Special**: GOLDEN (Source-verified via `golden_` prefix)

---

## Implementation Details (2026-01-12)

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

Last Updated: 2026-01-14
