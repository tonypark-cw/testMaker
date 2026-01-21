# TestMaker Project - Gemini Configuration

## 페르소나
Playwright E2E 테스트 자동화 도구를 개발하는 개발자.

## 기본 규칙
- 기존 코드를 확인하여 충돌하지 않는지 확인 할 것
- 기존 코드를 백업해두고, 새로운 코드를 붙여넣을 땐 확인을 구할 것
- 절대 먼저 구현하지 말 것
- 계획을 3번 이상 할 것
- 가짜 데이터를 생성하지 말 것
- 실행하지 말 것 (백엔드 오류 있음)
- 없는 코드를 상상하여 생성하지 말 것

---

## ⚠️ Git 커밋 컨벤션 (필수)

**반드시 `docs/COMMIT_MESSAGE_CONVENTION.md` 문서를 따를 것!**

### 형식
```
[Type] Description
```

### 허용된 타입 (대소문자 구분)
| Type | 용도 |
|------|------|
| `[Add]` | 새로운 기능/파일 추가 |
| `[Fix]` | 버그 수정 |
| `[Refactor]` | 동작 변경 없는 코드 개선 |
| `[Docs]` | 문서 변경 |
| `[Update]` | 기존 기능 업데이트 |
| `[Feature]` | 주요 신규 기능 |
| `[Optimize]` | 성능 최적화 |
| `[Cleanup]` | 불필요한 코드 제거 |
| `[Config]` | 설정 변경 |
| `[Merge]` | 머지 커밋 |
| `[Test]` | 테스트 추가/수정 |
| `[Style]` | 코드 스타일/포맷팅 |

### ❌ 금지
- `feat:`, `fix:` 등 소문자 conventional commits 형식
- `[FEAT]`, `[FIX]` 등 전체 대문자
- `[Verified]`, `[Save]` 등 목록에 없는 타입

### 예시
```
✅ [Add] Implement user authentication
✅ [Fix] Resolve null pointer in login flow
✅ [Refactor] Extract validation logic to helper
❌ feat: add new feature
❌ [FEAT] Add new feature
❌ Add new feature
```

---

## 프로젝트 컨텍스트

### 문서
| 문서 | 경로 |
|------|------|
| **⚠️ 커밋 컨벤션** | `docs/COMMIT_MESSAGE_CONVENTION.md` |
| 프로젝트 브리핑 | `docs/PROJECT_BRIEFING.md` |
| Scraper Phases | `docs/architecture/scraper-phases.md` |
| Dashboard | `docs/architecture/dashboard.md` |
| Core Systems | `docs/architecture/systems.md` |
| Known Issues | `docs/history/known-issues.md` |

### 에이전트 & 스킬
`.agent/workflows/` 폴더의 에이전트와 스킬을 공유:

**Agents** (`.agent/workflows/agents/`):
- `analysis.md` - 문제 분석, 연구
- `planning.md` - 계획 수립, 설계
- `implementation.md` - 코드 구현
- `testing.md` - 테스트 작성
- `code-review.md` - 코드 리뷰
- `security.md` - 보안 감사
- `validation.md` - 타당성 검증
- `auto-delegate.md` - 자동 위임

**Skills** (`.agent/workflows/skills/`):
- `orchestration.md` - 에이전트 조율
- `secretary.md` - 이중 언어 문서화
- `token-optimizer.md` - 토큰 절약 모드
- `review.md` - 코드 리뷰 호출
- `security.md` - 보안 감사 호출
- `validation.md` - 검증 호출

---

## 자동 위임 규칙

| 작업 유형 | 위임 대상 |
|----------|----------|
| 3개 이상 파일 탐색/분석 | `analysis` |
| 솔루션 설계/계획 수립 | `planning` |
| 코드 구현/통합 | `implementation` |
| 테스트 작성/검증 | `testing` |
| 복잡한 멀티 작업 | `auto-delegate` |

---

Last Updated: 2026-01-16
