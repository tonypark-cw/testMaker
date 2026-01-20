# TestMaker v2.0 - Project Briefing

## Overview

TestMaker는 웹 애플리케이션을 자동으로 탐색하고 테스트 케이스를 생성하는 도구입니다.

---

## Architecture

```
Runner (or Worker)
├── BrowserContext (Single Session)
│   ├── Tab 1-3 (Scraper) - 병렬 탐색
├── Analyzer / Generator
└── Output (webp/json/trace)

Distributed Logging
├── Terminal 1: npm run dashboard:server (UI + Job Queue)
└── Terminal 2: npm run worker (Execution + Analysis)
```

### Core Components

| Component | File | Responsibility |
|-----------|------|----------------|
| CLI | src/core/cli.ts | 명령어 파싱 |
| Supervisor | src/core/supervisor.ts | 프로세스 감시, 자동 재시작 |
| Runner | src/core/runner.ts | 브라우저 관리, 전역 429 제어, 탭 분배 |
| SessionManager | src/core/SessionManager.ts | 토큰 관리 (Singleton), 자동 갱신, 백오프 |
| Scraper | src/core/scraper.ts | 8 Phase 탐색 엔진 |
| Dashboard | src/dashboard/server.ts | 실시간 모니터링 UI (Adaptive Watcher) |
| NetworkManager | src/core/NetworkManager.ts | CORS-safe 헤더 주입 |
| RecoveryManager | src/core/RecoveryManager.ts | 에러 임계값 복구 |

> 상세: [architecture/scraper-phases.md](./architecture/scraper-phases.md)

---

## Implementation Status

| Feature | Status | Note |
|---------|--------|------|
| Multi-Tab Parallelism | ✅ | Dev/Stage Verified |
| Session Management | ✅ | Singleton, Token Refresh (+Backoff), Optimized Caching |
| Token Refresh Optimization | ✅ | 95% reduction in API calls, 5-second cache |
| Auto Login / SPA Route | ✅ | |
| 8-Phase Scraping | ✅ | |
| Golden Path Analysis | ✅ | |
| Dashboard Performance | ✅ | O(1) Adaptive Watcher (Win/Mac) |
| NetworkManager | ✅ | Safe Header Injection, CORS Headers |
| Fault Tolerance | ✅ | 500 Warn, 429 Global Pause |
| Queue Management | ✅ | Fixed visited URL lifecycle |
| Multi-Page Navigation | ✅ | Proper worker execution flow |
| Multi-Epoch Recovery (Stage) | [/] | Epoch 1 in progress |
| Row Click Deduplication | ✅ | |
| Unified Timestamp (Hour Group) | ✅ | |

---

## Quick Reference

### Run Commands

```bash
npm run dashboard:server  # Dashboard UI
npm run worker            # Analysis worker
npm run search -- --url "https://stage.ianai.co" --concurrency 3 --headless
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `TARGET_URL` | 분석 대상 URL |
| `BLOCK_REFRESH_TOKEN` | 토큰 갱신 차단 (임시) - *Deprecated* |
| `EXTERNAL_WORKER` | 외부 워커 모드 (대시보드) |

### CLI Options

| Option | Default | Description |
|--------|---------|-------------|
| --depth | 1 | 탐색 깊이 |
| --limit | 50 | 최대 페이지 수 |
| --concurrency | 3 | 병렬 탭 수 |
| --headless | true | Headless 모드 |

---

## Detailed Documentation

| Document | Contents |
|----------|----------|
| [architecture/scraper-phases.md](./architecture/scraper-phases.md) | 8 Phase 상세, Helper Functions, Static Caches |
| [architecture/dashboard.md](./architecture/dashboard.md) | Dashboard 구조, 필터, 리팩토링 이력 |
| [architecture/systems.md](./architecture/systems.md) | Golden Path, Action Chain, RL System, Tools |
| [history/known-issues.md](./history/known-issues.md) | 겪은 문제들, 해결법, 아키텍처 결정 이력 |
| [plans/archived/multi-tab-token-strategy.md](./plans/archived/multi-tab-token-strategy.md) | [Completed] SessionManager & Parallel Strategy |

---

## Code Health

**Last Verified**: 2026-01-19

| Component | Status |
|-----------|--------|
| TypeScript Compilation | ✅ Pass |
| Multi-Environment Support | ✅ Dev/Stage/Mac/Win |
| Dashboard Responsiveness | ✅ Instant (No Flicker) |
| Rate Limiting | ✅ 429/500 Handled |
| Token Refresh Logic | ✅ Optimized (95% reduction) |
| Queue Management | ✅ Fixed visited URL tracking |

---

## Recent Updates Summary (2026-01-19)

### Key Changes

**Token Management Overhaul**:
- Fixed 403 "Invalid origin" error by adding proper CORS headers (Origin, Referer)
- Reduced token refresh frequency from 30+ to 1-2 per session (~95% reduction)
- Implemented 5-second token caching in NetworkManager
- Added `extractTokenExpiry()` to use actual API expiry times instead of hardcoded values
- Enhanced compatibility with both `accessToken` and `token` API response fields

**Navigation System Fixes**:
- Fixed critical bug where only index page was being captured
- Corrected visited URL marking lifecycle (mark at worker start, not queue addition)
- Fixed token injection timing (retrieve before page creation)
- Added proper await for concurrency=1 sequential execution

**Files Modified**:
- [src/core/runner.ts](src/core/runner.ts): Token refresh handler, extractTokenExpiry(), runWorker() timing
- [src/core/NetworkManager.ts](src/core/NetworkManager.ts): Token caching, reduced SessionManager queries
- [src/core/SessionManager.ts](src/core/SessionManager.ts): Enhanced logging, expiry tracking
- [src/core/lib/QueueManager.ts](src/core/lib/QueueManager.ts): Fixed addJobs() visited marking

**Performance Improvements**:
- API call reduction: ~95% fewer token refresh requests
- Navigation reliability: All discovered links now properly explored
- Memory efficiency: Token cache prevents repeated SessionManager state queries

### Verification Status

✅ Token refresh works across dev/stage environments
✅ Multi-page navigation functioning correctly
✅ Queue management properly tracking visited URLs
✅ Network errors (401, EventSource) confirmed as non-critical
✅ Sequential (concurrency=1) and parallel modes working

### Testing Command

```bash
npm run search -- --url https://dev.ianai.co --limit 100 --depth 5 --headless --force
```

**Expected Results**:
- Token refresh occurs 1-2 times per session (not 30+)
- All discovered menu pages are explored and captured
- No 403 "Invalid origin" errors
- Pages beyond index are successfully scraped

---

### Regression Testing System (Complete)

**목표**: 사이트 하위 페이지 전체를 자동 탐색하여 베이스라인 생성 후, 이후 변경 사항 자동 감지

```
[Phase 1: 베이스라인 생성]
npm run analyze -- --url https://dev.ianai.co     # 크롤러로 사이트 탐색
npm run regression:init                            # 크롤러 결과를 베이스라인으로 등록

[Phase 2: 회귀 테스트]
npm run regression -- --url https://dev.ianai.co/app/auditlog   # 해당 경로 하위 전체 테스트
npm run regression -- --url https://dev.ianai.co/app/auditlog --batch  # 명시적 배치 모드
```

**아키텍처**:
```
크롤러 (core/)
├── output/stage/screenshots/{domain}/     # 스크린샷 (.webp)
└── output/stage/screenshots/json/{domain}/ # 메타데이터 (.json)
         │
         ▼  [regression:init]
베이스라인 등록
├── output/baselines/{domain}/index.json   # 페이지 인덱스
├── output/baselines/{domain}/pages/       # Golden 스크린샷 + 콘텐츠
         │
         ▼  [regression --url]
회귀 테스트
├── Visual Comparison (pixelmatch)         # 픽셀 단위 비교
├── Content Comparison                     # 버튼/테이블/입력필드 비교
├── Anomaly Detection                      # 치명적 변경 감지
└── output/regressions/diffs/              # Diff 이미지 저장
```

**핵심 모듈** (`src/regression/`):

| 모듈 | 역할 |
|------|------|
| `BaselineManager` | 베이스라인 저장/조회/관리 |
| `BaselineIntegrator` | 크롤러 출력 → 베이스라인 변환 |
| `VisualComparator` | 스크린샷 픽셀 비교 (pixelmatch) |
| `ContentExtractor` | 페이지 구조 추출 (버튼, 테이블, 입력필드) |
| `ContentComparator` | 콘텐츠 변경 비교 |
| `AnomalyDetector` | 치명적 변경 감지 (Submit 버튼 삭제 등) |
| `BatchRunner` | 다중 페이지 순회 테스트 |
| `cli.ts` | CLI 명령어 (`init`, `run`, `list`, `baseline`, `test`) |

**Anomaly Detection 점수 체계**:

| 이슈 유형 | 심각도 점수 |
|----------|------------|
| Critical Button 삭제 (Submit, Save 등) | +30 |
| Required Field 삭제 | +25 |
| Table 삭제 | +15 |
| Column 삭제 | +10 |
| 일반 요소 변경 | +5 |

| 총점 | 심각도 | 결과 |
|------|--------|------|
| 0-39 | INFO | ✅ PASS |
| 40-79 | WARNING | ⚠️ WARNING |
| 80+ | CRITICAL | ❌ FAIL |

**CLI 명령어**:

```bash
# 베이스라인 관리
npm run regression:init                    # 크롤러 출력을 베이스라인으로 등록
npm run regression:init -- --url "https://dev.ianai.co/app/inventory"  # 특정 경로만
npm run regression:list -- --domain dev.ianai.co  # 등록된 베이스라인 목록

# 회귀 테스트
npm run regression -- --url "https://dev.ianai.co/app"           # 자동 모드 (단일/배치 감지)
npm run regression -- --url "https://dev.ianai.co/app" --batch   # 강제 배치 모드
npm run regression -- --url "https://dev.ianai.co/app/home"      # 단일 페이지 테스트

# 개별 명령어
npm run regression:baseline -- --url <url>  # 수동 베이스라인 생성
npm run regression:test -- --url <url>      # 단일 페이지 테스트
```

**현재 상태** (2026-01-20):

| 항목 | 상태 |
|------|------|
| 크롤러 → 베이스라인 연동 | ✅ 완료 (189 페이지 등록) |
| 단일 페이지 테스트 | ✅ 완료 |
| 배치 테스트 | ✅ 완료 |
| Dashboard 연동 | ❌ 미구현 |
| JSON 결과 저장 | ❌ 미구현 |

**테스트 결과 예시**:
```
📦 Batch Mode: 21 pages to test
   [1/21] .../app/auditlog
   [2/21] .../history/account/...
   ...
═══════════════════════════════════════
📊 BATCH REGRESSION TEST REPORT
───────────────────────────────────────
Total Pages: 21
✅ Passed:   18
❌ Failed:   3
⚠️  Errors:   0
───────────────────────────────────────
FAILED PAGES
❌ https://dev.ianai.co/app/auditlog/history/item/...
   Visual: 12.5% diff
   Anomaly: WARNING (score: 45)
═══════════════════════════════════════
```

**Next Steps**:
1. Dashboard 연동 (리그레션 결과 시각화)
2. JSON 결과 저장 및 이력 관리
3. CI/CD 파이프라인 통합

---

Last Updated: 2026-01-20

---

## Troubleshooting History (2026-01-20)

### 1. Regression Testing Integration (Resolved)

**Issue**: Need to combine visual pixel diffs with semantic content verification.

**Solution**: implemented multi-phase regression system.
- **Phase 1 (Visual)**: `VisualComparator` using pixelmatch
- **Phase 2 (Content)**: `ContentExtractor` & `ContentComparator` for structure/text
- **Phase 3 (Anomaly)**: `AnomalyDetector` for critical element changes
- **CLI**: Integrated all phases into `regression:test` command

**Result**: 
- Visual only: `npm run regression:test -- --url ... --visual-only`
- Content only: `npm run regression:test -- --url ... --content-only`
- Full suite: `npm run regression:test -- --url ...` (Auto-runs anomaly detection)

---

## Troubleshooting History (2026-01-19)

### 1. Token Refresh 403 Error (Resolved)

**Issue**: `[SessionManager] Refresh failed: 403 - {"error":"Invalid origin"}`

**Root Cause**: Playwright's `context.request.post()` doesn't automatically include browser headers like Origin and Referer, which the API requires for CORS validation.

**Solution**: Added explicit headers to token refresh API calls
- **File**: [src/core/runner.ts](src/core/runner.ts) (L243-279)
- **Fix**: Added `Origin`, `Referer`, and `Content-Type` headers to `/v2/user/token` POST request
```typescript
headers: {
    'Origin': originBase,
    'Referer': `${originBase}/app`,
    'Content-Type': 'application/json'
}
```

**Impact**: Token refresh now works reliably across all environments (dev/stage)

---

### 2. Excessive Token Refresh (Resolved)

**Issue**: Token refresh occurring 30+ times per session, causing massive API overhead

**Root Causes**:
1. NetworkManager calling `getAccessToken()` on every HTTP request (100+ per page load)
2. Hardcoded `expiresIn=3600` instead of using actual API response
3. No caching mechanism for token validity checks
4. Race conditions when multiple requests checked expiry simultaneously

**Solution**: Multi-phase optimization
- **Phase 1: Accurate Token Expiry** ([src/core/runner.ts](src/core/runner.ts) L157-192)
  - Created `extractTokenExpiry()` method to read actual expiry from localStorage/sessionStorage/cookies
  - Modified token refresh handler to accept both `data.expiresIn` and `data.expires_in` fields

- **Phase 2: Token Caching** ([src/core/NetworkManager.ts](src/core/NetworkManager.ts) L9-61)
  - Added 5-second token cache to prevent repeated SessionManager queries
  - Only refresh token check when cache expires or no cached token exists
  - Added guard to only call `getAccessToken()` if tokens are already initialized

- **Phase 3: Enhanced Logging** ([src/core/SessionManager.ts](src/core/SessionManager.ts) L52-62, L140-149)
  - Added detailed expiry time logging for debugging
  - Shows time remaining when token is expiring soon

**Results**:
- Token refreshes reduced from 30+ to 1-2 per session (~95% reduction)
- API load significantly decreased
- More accurate token lifecycle management

---

### 3. API Response Field Compatibility (Resolved)

**Issue**: `[SessionManager] Refresh response missing accessToken`

**Root Cause**: API returns `token` field instead of `accessToken` in refresh response

**Solution**: Handle both field names
- **File**: [src/core/runner.ts](src/core/runner.ts) (L258-265)
```typescript
const newAccessToken = data.accessToken || data.token;
if (!newAccessToken) {
    console.error('[SessionManager] Refresh response missing accessToken:', data);
    throw new Error('Refresh response missing accessToken');
}
```

**Impact**: Robust handling of different API response formats

---

### 4. Navigation Failure - Only Index Page Captured (Resolved)

**Issue**: Crawler discovered 21 links but only captured index page. Queue showed `21 → 20 → 19` but no new workers started.

**Root Causes**:
1. `QueueManager.addJobs()` was marking URLs as visited immediately upon adding to queue
2. `runWorker()` was checking `isVisited()` at start and skipping already-visited URLs
3. This created a catch-22: jobs were added to queue AND marked visited simultaneously, causing immediate skips

**Solution**: Fixed visited URL marking lifecycle
- **File**: [src/core/lib/QueueManager.ts](src/core/lib/QueueManager.ts) (L45-58)
  - Removed `this.visitedUrls.add(normalized)` from `addJobs()` method
  - URLs are only checked for visited status, not marked

- **File**: [src/core/runner.ts](src/core/runner.ts) (L335-347)
  - Added `markVisited()` call at START of `runWorker()` (after visited check)
  - Ensures URL is marked visited only when actually being processed

**Code Changes**:
```typescript
// QueueManager.addJobs() - Check but don't mark
if (!this.visitedUrls.has(normalized) && !inQueue) {
    this.queue.push({ ...job, url: normalized });
    addedCount++;
}

// runner.runWorker() - Mark when processing starts
if (this.queueManager.isVisited(job.url)) {
    return;
}
this.queueManager.markVisited(job.url);  // Mark here instead
```

**Impact**: Multi-page navigation now works correctly, all discovered links are explored

---

### 5. Token Injection Timing (Resolved)

**Issue**: `[Runner-Debug] Received accessToken: EMPTY` despite successful token refresh

**Root Cause**: Token was being retrieved AFTER page creation, or stale tokens from `getTokens()` were being used instead of fresh tokens from `getAccessToken()`

**Solution**: Proper token retrieval sequence
- **File**: [src/core/runner.ts](src/core/runner.ts) (L344-365)
  - Get fresh token from `getAccessToken()` BEFORE creating page
  - Use the returned value directly instead of calling `getTokens()` again
  - Inject tokens via `addInitScript()` immediately after page creation

**Code Flow**:
```typescript
// 1. Get token BEFORE page creation
const accessToken = await sessionMgr.getAccessToken();

// 2. Validate token exists
if (!accessToken) {
    console.error('No access token available');
    return;
}

// 3. Create page AFTER validation
page = await this.context!.newPage();

// 4. Inject tokens IMMEDIATELY
await page.addInitScript((tokens) => {
    localStorage.setItem('accessToken', tokens.access);
    localStorage.setItem('refreshToken', tokens.refresh);
}, { access: accessToken, refresh: refreshToken });
```

**Impact**: Tokens are reliably available for all page navigations

---

### 6. Concurrency=1 Worker Await (Resolved)

**Issue**: Sequential mode (concurrency=1) was not properly awaiting worker completion

**Solution**: Added proper await for sequential execution
- **File**: [src/core/runner.ts](src/core/runner.ts) (L313-319)
```typescript
if (this.concurrency === 1) {
    await this.runWorker(job);  // Properly await
    this.activeWorkers--;
    if (this.isRunning) {
        this.queueManager.saveCheckpoint();
    }
}
```

**Impact**: Sequential crawling now processes pages in proper order

---

### 7. Network Errors Analysis (Non-Critical)

**Observed Errors**:
- `401 Error on: https://api-dev.ianai.co/v2/user/token` (during initial login)
- `EventSource failed: me` (SSE connection attempts)
- `Failed to load resource: 401` (browser retry attempts)

**Analysis**: These are expected and non-critical
- 401 errors occur before authentication completes
- EventSource failures are the application attempting real-time connections
- Browser automatically retries failed requests
- All errors resolve once authentication succeeds

**Action**: No fix required, errors are part of normal authentication flow

---

### Navigation & Auth Crash (Previously Resolved)

**Issue**: Crawler stuck on Index page or exiting early without navigation.
**Root Cause**: Authentication system failure causing worker crashes.
1. **Refresh Token Error**: `refresh_token` stored in HttpOnly cookie, inaccessible to `localStorage`.
2. **Unhandled Promise Rejection**: 401 response during token refresh caused unhandled exception in `runWorker`.
3. **Missing Fallback**: No mechanism to recover session if refresh failed.

**Solution**:
- **Crash Guard**: Wrapped token refresh in `try/catch`.
- **Hybrid Storage**: Extract tokens from `localStorage`, `sessionStorage`, AND `Cookies`.
- **Auto Re-login**: Trigger full re-login flow if token refresh fails (Self-Healing).
- **Stable Locators**: Updated `AuthManager` to handle detached elements during verification.
