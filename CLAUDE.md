# Claude Code 프로젝트 가이드

## 자동 위임 규칙 (중요)

### 서브 에이전트 자동 위임 기준

다음 작업은 **반드시 서브 에이전트에 위임**하라:

| 작업 유형 | 위임 대상 |
|----------|----------|
| 3개 이상 파일 탐색/분석 | `analysis` 또는 `worker` |
| 코드베이스 구조 파악 | `analysis` |
| 버그 원인 추적 | `analysis` |
| 솔루션 설계/계획 수립 | `planning` |
| 아키텍처 결정 | `planning` |
| 코드 구현/통합 | `implementation` |
| 테스트 작성/검증 | `testing` |
| 재고 관련 테스트 시나리오 | `inventory-qa-specialist` |
| 회계 관련 테스트 시나리오 | `accounting-qa-tester` |
| 복잡한 멀티 에이전트 작업 | `auto-delegate` |
| 기타 범용 작업 | `worker` |

### 직접 처리하는 경우

다음은 서브 에이전트 **없이 직접 처리**:
- 단순 질문/답변
- 1-2개 파일 수정
- 명확한 단일 작업
- 대화형 확인이 필요한 작업

### 위임 프로세스

```
1. 요청 분석 → 복잡도 판단
2. 복잡한 작업 → 적절한 에이전트 호출
   - 분석 필요 → analysis
   - 계획 필요 → planning
   - 구현 필요 → implementation
   - 테스트 필요 → testing
   - 복합 작업 → auto-delegate
3. 에이전트가 독립적으로 작업 수행
4. 결과만 메인 대화에 반환
```

---

## 모델 자동 선택 원칙 (중요)

### 작업별 모델 매핑

| 작업 복잡도 | 모델 | 서브에이전트 | 예시 |
|------------|------|-------------|------|
| **High** | opus/sonnet (메인) | planning, analysis | 아키텍처 설계, 멀티파일 통합, 복잡한 디버깅 |
| **Medium** | sonnet (메인) | implementation, testing | 기능 구현, 테스트 작성, 리팩토링 |
| **Low** | haiku (서브) | worker, Explore | 파일 검색, 단순 복사, 포맷팅, grep/glob |

### 자동 적용 규칙

**메인 에이전트 (사용자 대화)**:
- 분석 + 설계 작업 → Sonnet/Opus 유지
- 사용자와 대화형 확인 → Sonnet 유지

**서브 에이전트 자동 Haiku 적용**:
```
다음 서브에이전트는 model: "haiku" 파라미터 사용:
- Explore (코드베이스 탐색)
- worker (단순 파일 작업)
- 단순 grep/glob 검색 작업
```

**서브 에이전트 Sonnet 유지**:
```
다음 서브에이전트는 기본 모델(sonnet) 유지:
- analysis (복잡한 분석)
- planning (설계/계획)
- implementation (코드 통합)
- testing (테스트 설계)
```

### 병렬 실행 최적화

복합 작업 시 모델을 혼합하여 비용 최적화:
```
예: "코드베이스 분석 후 기능 통합"
├── Explore (haiku) → 파일 구조 파악
├── analysis (sonnet) → 심층 분석
└── implementation (sonnet) → 코드 작성
```

---

## 토큰 절약 가이드

### 1. 모델 선택
- **opus**: 복잡한 추론, 아키텍처 설계
- **sonnet**: 일반 코딩 작업 (기본값)
- **haiku**: 간단한 작업, 파일 검색, 포맷팅 **(서브에이전트 기본)**

### 2. 컨텍스트 관리
| 명령어 | 용도 |
|--------|------|
| `/clear` | 대화 초기화 |
| `/compact` | 대화 압축 |
| `/token-optimizer` | 토큰 절약 모드 활성화 |

### 3. 효율적인 파일 읽기
- 전체 파일 대신 특정 라인만 읽기
- 이미 읽은 파일 재요청 피하기
- 큰 파일은 필요한 부분만

### 4. 서브 에이전트 활용
복잡한 탐색/분석은 서브 에이전트에 위임하여 메인 컨텍스트 절약

### 5. 출력 제한
- "간단히", "요약해서", "코드만" 등으로 출력 최소화

---

## 프로젝트 구조

```
.agent/workflows/
├── skills/       # 스킬 (재사용 가능한 명령어) - 역할/모드 적용
│   ├── orchestration.md    # 에이전트 팀 Director 모드
│   ├── secretary.md        # 이중 언어 커뮤니케이션 모드
│   ├── curation.md         # Golden Path 생성 모드
│   └── token_optimization.md  # 토큰 절약 모드
│
└── agents/       # 서브 에이전트 - 독립 또는 협업 작업 수행
    ├── auto-delegate.md           # 요청 분석 및 자동 위임
    ├── worker.md                  # 범용 작업 처리
    ├── analysis.md                # 문제 분석, 연구, 데이터 분석
    ├── planning.md                # 솔루션 계획, 타당성 분석
    ├── implementation.md          # 코드 구현, 서비스 통합
    ├── testing.md                 # 테스트 개발, 검증, QA
    ├── inventory_qa.md            # 재고 관리 테스트 전문
    └── accounting_qa.md            # 회계 검증 테스트 전문
```

## 스킬 vs 에이전트

| | 스킬 (skills) | 에이전트 (agents) |
|---|---|---|
| 위치 | `.agent/workflows/skills/` | `.agent/workflows/agents/` |
| 호출 | 직접 읽기 (View File) | 페르소나 채택 (Embody Role) |
| 실행 | 현재 대화에 지침 주입 | 유기적 협업 및 작업 수행 |
| 용도 | 역할/스타일/모드 적용 | 복잡한 작업 독립 수행 |
| 예시 | orchestration, secretary | analysis, planning, worker |

### 스킬 목록
| 스킬 | 용도 |
|------|------|
| `orchestration` | 에이전트 팀 조율 모드 |
| `secretary` | 이중 언어 문서화 모드 |
| `curation` | Golden Path 테스트 생성 모드 |
| `token_optimization` | 토큰 절약 모드 |

### 에이전트 목록
| 에이전트 | 용도 |
|----------|------|
| `auto_delegate` | 복합 요청 분석 및 조율 |
| `worker` | 범용 작업 처리 |
| `analysis` | 분석, 연구, 조사 |
| `planning` | 계획 수립, 전략 설계 |
| `implementation` | 코드 구현, 통합 |
| `testing` | 테스트 작성, 검증 |
| `inventory_qa` | 재고 관리 테스트 |
| `accounting_qa` | 회계 시스템 테스트 |

## 언어 규칙

- 사용자 커뮤니케이션: 한국어 + 영어 (이중 언어)
- 코드 주석: 영어
- 문서: 한국어 우선
