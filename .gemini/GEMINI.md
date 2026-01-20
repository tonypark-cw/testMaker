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

## 프로젝트 컨텍스트

### 문서
| 문서 | 경로 |
|------|------|
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

Last Updated: 2026-01-14

## 개발 원칙 (Dev Principles)

프로젝트 코딩 원칙 문서: [`docs/CODING_PRINCIPLES.md`](../docs/CODING_PRINCIPLES.md)

**핵심 원칙**:
1. TypeScript strict mode 준수
2. Explorer 패턴으로 책임 분리
3. Defensive logging (이모지 + 컨텍스트)
4. Try-catch로 에러 처리
5. 중요 로직은 유닛 테스트 필수
6. Immutability 유지 (Set/Map 활용)

**변경 시 문서 업데이트 필수**:
- `docs/PROJECT_BRIEFING.md`
- 관련 architecture 문서

