# Known Issues & Fixes

> 프로젝트 개발 중 겪은 문제들과 해결 방법 기록

## Issue Registry

| Issue | Cause | Fix | Date |
|-------|-------|-----|------|
| __name is not defined | esbuild helper in browser | Stack-based iteration | - |
| Login not working | SPA render timing | waitFor + transition handling | - |
| Ghost elements | Dropdown/popover stuck | settleAndCleanup() | - |
| Duplicate screenshots | Same modal, different trigger | MD5 hash check | - |
| Blank screenshots | Early capture / no permission | sharp.stats() skip | - |
| Header Crash | HTTP Headers sent twice | Remove duplicated server logic | - |
| Dropdown Clipping | overflow:hidden in modal title | overflow:visible + absolute positioning | - |
| Duplicate Badge Block | Badge overlaying cards | pointer-events: none on badge | - |
| Healer Crash | Accessibility snapshot error | Added page.accessibility check | - |
| Session Bleed | Shared temp-auth.json | Subdomain-specific auth naming | - |
| CORS Error on 3rd Party | Header injection to CDN/external | NetworkManager selective routing | 2026-01 |
| Crash on 50+ API Errors | Error accumulation overflow | RecoveryManager auto-reload | 2026-01 |
| Dashboard 느린 응답 (500ms) | 매 요청마다 파일 스캔 | ScreenshotCache (chokidar) | 2026-01-14 |
| any 타입 남용 | 초기 개발 시 타입 미정의 | ActionRecord, ModalElement 타입 추가 | 2026-01-14 |
| Static 경쟁조건 | 멀티탭에서 static 변수 공유 | ScraperContext 설계 (구현 예정) | 2026-01-14 |

---

## Temporary Workarounds

### BLOCK_REFRESH_TOKEN (runner.ts L47-56)

**문제**: 백엔드 토큰 갱신 API 오류
**우회**: 환경변수로 토큰 갱신 요청 차단
**상태**: 백엔드 수정 후 제거 예정

```typescript
// TODO: Remove when backend is fixed
if (process.env.BLOCK_REFRESH_TOKEN === 'true') {
  // Block failing token refresh requests
}
```

---

## Architecture Decisions

### Stack-based DOM Traversal (Phase 8)

**배경**: 재귀 함수 사용 시 `__name is not defined` 에러 발생 (esbuild + browser 환경)
**결정**: 재귀 대신 스택 기반 반복문으로 구현
**결과**: 브라우저 환경에서 안정적 동작

### Static Caches for Cross-Tab Deduplication

**배경**: 멀티탭 병렬 실행 시 동일 모달/버튼 중복 처리
**결정**: 클래스 레벨 static Set으로 공유 캐시 구현
**결과**: 탭 간 중복 작업 방지

### NetworkManager Selective Routing

**배경**: company-id 헤더 주입 시 3rd party CDN에서 CORS 에러
**결정**: 도메인별 선택적 헤더 주입 (ianai.co/localhost만)
**결과**: CDN 요청 정상화

### RecoveryManager Auto-Reload

**배경**: API 에러 50개 이상 누적 시 브라우저 크래시
**결정**: 에러 임계값 도달 시 페이지 자동 리로드
**결과**: 장시간 실행 안정화

### ScreenshotCache with File Watcher (2026-01-14)

**배경**: Dashboard `/api/stats` 호출마다 전체 디렉토리 스캔 (500ms+)
**결정**: chokidar 기반 파일 감시자로 실시간 캐시 업데이트
**결과**: 응답 시간 500ms → 1ms (500배 개선 예상)

### Type Safety - any 타입 제거 (2026-01-14)

**배경**: `actionChain?: any[]`, `modalDiscoveries?: any[]` 등 타입 불안전
**결정**: `ActionRecord`, `ModalElement` 인터페이스 정의
**결과**: 컴파일 타임 타입 체크, IDE 자동완성 지원

### ScraperContext 설계 (2026-01-14)

**배경**: Scraper의 static 변수가 멀티탭에서 경쟁조건 유발
**결정**: `ScraperState`, `ScraperContext` 인터페이스로 인스턴스 기반 상태 관리
**결과**: Phase 3 리팩토링 준비 완료

---

Last Updated: 2026-01-14
