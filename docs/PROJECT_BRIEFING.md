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
| Session Management | ✅ | Singleton, Token Refresh (+Backoff) |
| Auto Login / SPA Route | ✅ | |
| 8-Phase Scraping | ✅ | |
| Golden Path Analysis | ✅ | |
| Dashboard Performance | ✅ | O(1) Adaptive Watcher (Win/Mac) |
| NetworkManager | ✅ | Safe Header Injection |
| Fault Tolerance | ✅ | 500 Warn, 429 Global Pause |
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

**Last Verified**: 2026-01-16

| Component | Status |
|-----------|--------|
| TypeScript Compilation | ✅ Pass |
| Multi-Environment Support | ✅ Dev/Stage/Mac/Win |
| Dashboard Responsiveness | ✅ Instant (No Flicker) |
| Rate Limiting | ✅ 429/500 Handled |

---

Last Updated: 2026-01-16
