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
| Scraper | src/core/scraper.ts | 8 Phase 탐색 엔진 |
| Dashboard | src/dashboard/server.ts | 실시간 모니터링 UI |
| ScreenshotCache | src/dashboard/ScreenshotCache.ts | 파일 감시 기반 캐시 (신규) |
| NetworkManager | src/core/NetworkManager.ts | CORS-safe 헤더 주입 |
| RecoveryManager | src/core/RecoveryManager.ts | 에러 임계값 복구 |

> 상세: [architecture/scraper-phases.md](./architecture/scraper-phases.md)

---

## Implementation Status

| Feature | Status |
|---------|--------|
| Multi-Tab Parallelism | ✅ |
| Auto Login / SPA Route | ✅ |
| 8-Phase Scraping | ✅ |
| Golden Path Analysis | ✅ |
| Action Chain Tracking | ✅ (Per-page) |
| RL State Management | ✅ |
| Dashboard (Filters, QA) | ✅ |
| NetworkManager / RecoveryManager | ✅ |
| Inspector / Validator Tools | ✅ |
| Multi-Epoch Recovery (Stage) | [/] Epoch 1 in progress |
| Row Click Deduplication | ✅ |
| Unified Timestamp (Hour Group) | ✅ |
| 3-Way Data Mapping (Path Context) | ✅ |
| URL Normalization (/app/home) | ✅ |

---

## Quick Reference

### Run Commands

```bash
npm run dashboard:server  # Dashboard UI
npm run worker            # Analysis worker
npm run analyze -- --url "https://example.com" --depth 3
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `TARGET_URL` | 분석 대상 URL |
| `COMPANY_ID` | 멀티테넌트 헤더 |
| `AUTH_EMAIL` / `AUTH_PASSWORD` | 로그인 정보 |
| `BLOCK_REFRESH_TOKEN` | 토큰 갱신 차단 (임시) |

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
| [architecture/golden-path.md](./architecture/golden-path.md) | Golden Path 설계 및 구현 상세 |
| [history/known-issues.md](./history/known-issues.md) | 겪은 문제들, 해결법, 아키텍처 결정 이력 |
| [history/progress-log.md](./history/progress-log.md) | 전체 프로젝트 진행 로그 |
| [reports/coverage.md](./reports/coverage.md) | 페이지 발견 및 캡처 현황 리포트 |
| [plans/archived/initial-plan.md](./plans/archived/initial-plan.md) | 초기 설계 및 단계별 구현 계획 |

---

## Code Health

**Last Verified**: 2026-01-14

| Component | Status |
|-----------|--------|
| TypeScript Compilation | ✅ Pass |
| IDE Diagnostics (ESLint) | ✅ Configured |
| 3-Way Mapping (URL/Path/WebP) | ✅ Implemented |
| Dashboard | ✅ Complete |
| Documentation Hierarchy | ✅ Reorganized |

---

Last Updated: 2026-01-14
