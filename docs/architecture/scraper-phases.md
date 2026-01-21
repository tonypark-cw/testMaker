# Scraper Phases

> Extracted from PROJECT_BRIEFING.md for detailed reference

## Phase Overview (8 Phases + Post-Processing)

| Phase | Name | Lines | Description |
|-------|------|-------|-------------|
| 1 | Navigation | L159-173 | 페이지 로드, /app/logged-in → /app/home 자동 리다이렉트 |
| 2 | SPA Route Interception | L346-359 | pushState/replaceState 후킹으로 SPA 라우트 감지 |
| 3 | Stability Wait | L361-388 | 로더 완료 대기 + MutationObserver 기반 DOM 안정화 |
| 3.5 | **Early Screenshot** | L390-467 | **깨끗한 원본 상태 캡처** (Discovery 전) |
| 4 | Menu Expansion | L469-534 | 접힌 메뉴 자동 확장 (캐시 기반 중복 방지) |
| 4.5 | Auto-Scroll | L536-558 | 페이지 스크롤로 lazy-load 콘텐츠 발견 |
| 5 | Sidebar Discovery | L560-654 | 사이드바 버튼 클릭 → 새 페이지/모달 발견 |
| 6 | Row-Click Discovery | L656-821 | 테이블 행 클릭 → 상세 페이지/모달 캡처 (네트워크 모니터링) |
| 7 | Global Action | L823-869 | Create/New/Add 버튼 자동 탐색 + JSON 메타데이터 저장 |
| 8 | Full Extraction | L873-968 | 모든 요소/링크 수집 (stack-based DOM traversal) |
| - | **Post-Processing: Golden Path** | L1101 | Phase 8 완료 후 analyzeGoldenPath() 호출 |

---

## Helper Functions (scraper.ts)

| Function | Lines | Description |
|----------|-------|-------------|
| `closeModals()` | L49-57 | ESC 키 + 닫기 버튼 클릭으로 모달/드로어 닫기 |
| `isModalOpen()` | L59-66 | 모달/드로어 열림 상태 확인 |
| `settleAndCleanup()` | L69-115 | Ghost 요소 CSS 숨김 + "Leave without saving" 자동 Stay 클릭 |
| `extractModalContent()` | L117-189 | 모달 내부 요소 추출 + 스크린샷 (MD5 중복 체크) |
| `smartClick()` | L192-203 | 좌표 기반 클릭 (SPA 이벤트 필터링 우회) |

---

## Static Caches (Cross-Tab Deduplication)

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

Last Updated: 2026-01-14
