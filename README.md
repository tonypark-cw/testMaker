# TestMaker

**Playwright 기반 자동 테스트 케이스 생성 도구**

웹 애플리케이션을 자동으로 분석하여 테스트 가능한 요소를 추출하고, 테스트 케이스(TC) 문서와 Playwright 테스트 코드를 자동 생성합니다.

---

## 목차

- [프로젝트 개요](#프로젝트-개요)
- [주요 기능](#주요-기능)
- [아키텍처](#아키텍처)
- [설치](#설치)
- [사용법](#사용법)
- [출력 구조](#출력-구조)
- [Dashboard](#dashboard)
- [Supervisor](#supervisor)
- [Self-Healing](#self-healing)
- [Regression Testing](#regression-testing)
- [환경 변수](#환경-변수)
- [프로젝트 구조](#프로젝트-구조)

---

## 프로젝트 개요

### 해결하고자 하는 문제

수동 테스트 케이스 작성은 시간이 많이 소요되고 누락이 발생하기 쉽습니다. 특히 SPA(Single Page Application) 환경에서는 동적 요소 탐지가 어렵고, UI 변경 시 테스트 유지보수 비용이 큽니다.

### 솔루션

TestMaker는 웹 페이지를 자동으로 크롤링하여:
1. **테스트 가능한 요소**를 자동 식별 (버튼, 입력 필드, 링크 등)
2. **테스트 시나리오**를 자동 그룹화 (폼 제출, 네비게이션, CRUD 등)
3. **실행 가능한 테스트 코드**를 자동 생성 (Playwright .spec.ts)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         TestMaker Pipeline                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌─────────┐      ┌──────────┐      ┌───────────┐      ┌────────┐  │
│   │   URL   │ ───▶ │ Scraper  │ ───▶ │ Analyzer  │ ───▶ │ Output │  │
│   └─────────┘      └──────────┘      └───────────┘      └────────┘  │
│                         │                  │                 │      │
│                    ┌────▼────┐        ┌────▼────┐      ┌─────▼────┐ │
│                    │ Elements│        │Scenarios│      │ JSON     │ │
│                    │ Extract │        │ Grouping│      │ Markdown │ │
│                    │ Screenshot       └─────────┘      │ Playwright│
│                    └─────────┘                         └──────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 주요 기능

### Core Features

| 기능 | 설명 |
|------|------|
| **Multi-page Crawling** | BFS 알고리즘으로 연결된 페이지 자동 탐색 |
| **Element Detection** | 버튼, 입력필드, 링크, 모달, 테이블 등 자동 식별 |
| **Scenario Grouping** | 관련 요소를 테스트 시나리오로 자동 그룹화 |
| **Code Generation** | Playwright .spec.ts 파일 자동 생성 |
| **Screenshot Capture** | 각 페이지 스크린샷 자동 저장 (WebP 최적화) |
| **Authentication** | 로그인 상태 유지 및 인증 지원 |

### Advanced Architecture (Phase 4 Complete)

| 기능 | 설명 |
|------|------|
| **Exploration Orchestrator** | Strategy Pattern을 통한 유연한 탐색 페이즈 제어 |
| **Type Safety** | Strict Typing & `any` elimination in core logic (2026-01-22) |
| **Exploration Context** | 세션별 상태 격리로 멀티탭 환경 경쟁 조건 완전 해결 |
| **Event-Driven Bus** | Pub/Sub 기반 비결합 시스템으로 확장성 확보 |
| **Recorder & Learning** | 사용자 행동 학습을 위한 레코더 및 이벤트 트래커 (Strictly Typed) |
| **Command Validation** | UI 액션 실행 후 상태 검증 및 스마트 재시도 로직 강화 |
| **Hexagonal Architecture** | Playwright 의존성 분리를 통한 테스트 용이성 |
| **Dashboard** | 웹 기반 분석 결과 시각화 및 실행 인터페이스 (Adaptive Watcher) |
| **DB Integration** | [PHASE 6] MariaDB/MySQL 연동 및 오프라인-퍼스트 결과 관리 |

---

## 아키텍처

### 3단계 파이프라인

```mermaid
flowchart LR
    subgraph Stage1["Stage 1: Scraper"]
        A[URL Input] --> B[Page Load]
        B --> C[Discovery Phase]
    end

    subgraph Stage2["Stage 2: Analyzer"]
        D[Type Analysis]
        E[Pattern Recognition]
        F[Anomaly Detection]
        C --> D --> E --> F
    end

    subgraph Stage3["Stage 3: Generator"]
        G[JSON Output]
        H[Markdown TC]
        I[Playwright Code]
        E --> G & H & I
    end
```

### 탐색 전략

```mermaid
flowchart TD
    subgraph Discovery["Element Discovery Strategy"]
        A[Page Load] --> B{Authentication?}
        B -->|Yes| C[Login Flow]
        B -->|No| D[Direct Access]
        C --> D
        D --> E[Sidebar Menu Expansion]
        E --> F[Main Content Scan]
        F --> G[Modal Detection]
        G --> H[Table Row Clicks]
        H --> I[Link Collection]
    end

    subgraph BFS["BFS Crawling"]
        J[Queue: URLs] --> K{Depth < Max?}
        K -->|Yes| L[Process Page]
        K -->|No| M[Skip]
        L --> N[Extract Links]
        N --> O[Add to Queue]
        O --> J
    end

    I --> J
```

### 시스템 구성

```mermaid
graph TB
    subgraph CLI["Command Line Interface"]
        A[test-maker CLI]
    end

    subgraph Core["Core Modules"]
        B[Scraper]
        C[Recorder]
        D[Regression]
    end

    subgraph Support["Support Systems"]
        E[Dashboard Server]
        F[AuthManager (Unified)]
        G[NetworkManager]
    end

    subgraph Output["Output Artifacts"]
        H[(Baselines)]
        I[(Recordings)]
        J[(Reports)]
    end

    A --> B & C & D
    B --> I & J
    C --> I
    D --> H
    E --> A
```

---

## 설치

### 요구 사항

- Node.js 18+
- npm 또는 yarn

### 설치 방법

```bash
# 프로젝트 디렉토리로 이동
cd testMaker

# 의존성 설치
npm install

# Playwright 브라우저 설치
npx playwright install chromium
```

### Git Hooks

이 프로젝트는 commitlint를 사용하여 커밋 메시지 컨벤션을 강제합니다.
자세한 내용은 `docs/COMMIT_MESSAGE_CONVENTION.md`를 참조하세요.

---

## 사용법

### 기본 분석

```bash
# 단일 페이지 분석
npm run analyze -- --url https://example.com

# 재귀 모드 (연결된 페이지 자동 탐색)
npm run analyze -- --url https://example.com --recursive --depth 3

# 최대 페이지 수 제한
npm run analyze -- --url https://example.com --recursive --limit 50
```

### Recorder (사용자 행동 학습)

```bash
# 레코더 실행
npm run record -- --url https://example.com
```

### Regression Testing (회귀 테스트)

UI 변경 사항을 자동으로 감지하고 검증하는 회귀 테스트 시스템입니다.

**주요 기능**:

| 단계 | 기능 | 설명 |
|------|------|------|
| **Phase 1** | Visual Regression | `pixelmatch` 기반 픽셀 단위 비교 |
| **Phase 2** | Content Verification | 테이블, 버튼, 입력 필드 구조 검증 |
| **Phase 3** | Anomaly Detection | 중요 요소 변경 자동 감지 (점수 기반) |

**사용법**:

```bash
# 베이스라인 생성 (최초 1회)
npm run regression:baseline -- --url https://example.com

# 회귀 테스트 실행 (전체)
npm run regression:test -- --url https://example.com

# Anomaly Detection 점수
# 70+ (CRITICAL), 40-69 (WARNING), 0-39 (INFO)
```

### 인증이 필요한 사이트

```bash
# 환경 변수로 인증 정보 설정
export emailname="user@example.com"
export password="your-password"

# 분석 실행 (자동 로그인)
npm run analyze -- --url https://app.example.com/dashboard --recursive
```

---

## 출력 구조

```
output/                          # 모든 실행 결과물 (Artifacts)
├── recordings/                 # 분석 시 캡처된 녹화 파일
├── tests/                      # Playwright 테스트 결과
│   ├── playwright-report/      # HTML 리포트
│   └── test-results/           # 실행 로그 및 트레이스
├── json/                       # 분석 결과 데이터 (JSON/Domain 기반)
├── markdown/                   # 사람이 읽는 테스트 케이스 (Markdown)
├── playwright/                 # 자동 생성된 .spec.ts 코드
└── screenshots/                # 분석 시 캡처된 스크린샷 (WebP)
```

### JSON 출력 예시

```json
{
  "pageInfo": {
    "url": "https://example.com/app/users",
    "title": "User Management",
    "domain": "example.com",
    "path": "/app/users"
  },
  "elements": [
    {
      "id": "elem-001",
      "selector": "button[data-testid='add-user']",
      "testId": "add-user",
      "tag": "button",
      "type": "button",
      "label": "Add User",
      "state": { "visible": true, "enabled": true }
    }
  ],
  "scenarios": [
    {
      "id": "scenario-001",
      "name": "User CRUD Operations",
      "category": "crud-operation",
      "priority": 1,
      "actions": [...]
    }
  ],
  "discoveredLinks": ["https://example.com/app/users/new"],
  "screenshot": "users.webp"
}
```

---

## Dashboard

웹 기반 대시보드로 분석 결과를 조회하고 분석을 실행할 수 있습니다.

### 실행

```bash
npm run dashboard
```

### 기능

```
http://localhost:3000
├── /                    # 메인 대시보드
├── /api/analyze         # 분석 실행 API (POST)
├── /api/status          # 분석 상태 조회
└── /screenshots/*       # 스크린샷 조회
```

### 인증

```bash
export DASHBOARD_USER="admin"
export DASHBOARD_PASS="secure-password"
npm run dashboard
```

---

## Supervisor

테스트 프로세스를 감독하고 실패 시 자동으로 재시작합니다.

### 실행

```bash
npm run start:supervisor
```

### 기능

- **Watchdog Timer**: 5분간 출력 없으면 행(hang) 감지
- **Auto Restart**: 프로세스 실패 시 10초 후 자동 재시작
- **Status Tracking**: `output/supervisor_status.json`에 상태 기록
- **Logging**: `output/supervisor.log`에 활동 로그

```mermaid
stateDiagram-v2
    [*] --> IDLE: Start
    IDLE --> RUNNING: Run Tests
    RUNNING --> COMPLETED: Success
    RUNNING --> FAILED: Error/Timeout
    FAILED --> IDLE: Wait 10s
    COMPLETED --> IDLE: Restart Cycle
```

---

## Self-Healing

테스트 실패 시 자동 복구를 위한 컨텍스트를 캡처합니다.

### 캡처 데이터

| 데이터 | 용도 |
|--------|------|
| **HTML Snapshot** | 실패 시점의 DOM 상태 |
| **Accessibility Tree** | 의미론적 요소 구조 |
| **Error Metadata** | 오류 정보 및 URL |

### 사용 방법

```typescript
// tests/example.spec.ts
import { captureHealingContext } from '../src/core/healer';

test.afterEach(async ({ page }, testInfo) => {
    await captureHealingContext(page, testInfo);
});
```

---

## Database Integration (Phase 6)

TestMaker는 오프라인-퍼스트 전략을 사용하여 분석 데이터의 안정성을 보장하고 중앙 집중식 관리를 지원합니다.

### 아키텍처: Per-Page Local Archive & Batch Upsert
1. **로컬 저장**: 각 페이지 분석 직후 `output/json`에 즉각 저장 (네트워크 오류 대응).
2. **배치 동기화**: `search` 명령어 종료 시 `SyncService`가 로컬 파일을 읽어 원격 DB로 업로드.
3. **중복 관리**: `URL` + `Content Hash`를 고유 키로 사용하여 기존 데이터 자동 업데이트(`upsert`).

### 사용 방법

```bash
# 환경 변수 설정 (.env)
DATABASE_URL="mysql://user:password@host:3306/db_name"

# 분석 후 자동 동기화 (기본값)
npm run search -- --url https://example.com

# 수동 동기화 실행
npm run db:sync -- --env dev --url https://example.com
```

### 지원 데이터베이스
- **MariaDB / MySQL** (Prisma `mysql` provider)
- 추천 무료 호스팅: Supabase(Postgres 용), Neon(Postgres 용), **Aiven(MySQL/MariaDB)**, PlanetScale.

---

## Database Integration (Phase 6)

TestMaker는 오프라인-퍼스트 전략을 사용하여 분석 데이터의 안정성을 보장하고 중앙 집중식 관리를 지원합니다.

### 아키텍처: Per-Page Local Archive & Batch Upsert
1. **로컬 저장**: 각 페이지 분석 직후 `output/json`에 즉각 저장 (네트워크 오류 대응).
2. **배치 동기화**: `search` 명령어 종료 시 `SyncService`가 로컬 파일을 읽어 원격 DB로 업로드.
3. **중복 관리**: `URL` + `Content Hash`를 고유 키로 사용하여 기존 데이터 자동 업데이트(`upsert`).

### 사용 방법

```bash
# 환경 변수 설정 (.env)
DATABASE_URL="mysql://user:password@host:3306/db_name"

# 분석 후 자동 동기화 (기본값)
npm run search -- --url https://example.com

# 수동 동기화 실행
npm run db:sync -- --env dev --url https://example.com
```

### 지원 데이터베이스
- **MariaDB / MySQL** (Prisma `mysql` provider)
- 추천 무료 호스팅: Supabase(Postgres 용), Neon(Postgres 용), **Aiven(MySQL/MariaDB)**, PlanetScale.

---

## 환경 변수

`.env` 파일 또는 환경 변수로 설정:

```bash
# 분석 대상
TESTMAKER_URL=https://stage.ianai.co

# 로그인 정보 (EMAIL, PASSWORD 권장)
EMAIL=your-email@example.com
PASSWORD=your-password

# 임시 세션 유지 Workaround (Backend 이슈 해결 시 false 설정)
INJECT_CUSTOM_HEADERS=true
CUSTOM_COMPANY_ID=0199daf1-af4d-7b42-8265-6c18b3724036
BLOCK_REFRESH_TOKEN=false
CLEAR_LOGIN_FIELDS=false

# Dashboard 인증
DASHBOARD_USER=admin
DASHBOARD_PASS=secure-password

# Database (Phase 6)
DATABASE_URL=mysql://user:password@host:3306/db_name
```

---

## 프로젝트 구조

```
testMaker/
├── src/                     # 모든 소스 코드 및 개발 데이터
│   ├── cli/                 # CLI 진입점 프로젝트 실행 제어
│   ├── scraper/             # 핵심 분석 엔진 (Orchestrator, Phases)
│   ├── shared/              # 공용 모듈 (Auth, Network, SyncService)
│   ├── dashboard/           # 결과 시각화 웹 UI
│   ├── types/               # [NEW] 공용 타입 정의 상위 통합
│   ├── templates/           # [NEW] Handlebars 리포트 템플릿
│   ├── scripts/             # [NEW] 유틸리티 및 오프라인 분석 스크립트
│   └── tests/               # [NEW] 모든 유닛 및 통합 테스트 코드
│
├── prisma/                  # [NEW] DB 스키마 및 마이그레이션
├── output/                  # 모든 분석 결과 및 실행 아티팩트
├── docs/                    # 프로젝트 문서
├── package.json
├── playwright.config.ts
├── prisma.config.ts         # [NEW] Prisma 7 설정 파일
└── tsconfig.json
```

---

## 타입 정의

### TestableElement

```typescript
interface TestableElement {
    id: string;                    // 고유 식별자
    selector: string;              // CSS 선택자
    testId?: string;               // data-testid
    tag: string;                   // HTML 태그
    type: ElementType;             // 요소 타입
    label: string;                 // 텍스트/라벨
    rect: { top, left, width, height };
    state: { visible, enabled, required };
    attributes: Record<string, string>;
}
```

### ElementType

```typescript
type ElementType =
    | 'button' | 'link' | 'text-input' | 'textarea'
    | 'select' | 'checkbox' | 'radio' | 'file-input'
    | 'dialog' | 'tab' | 'menu' | 'accordion' | 'custom';
```

### TestScenario

```typescript
interface TestScenario {
    id: string;
    name: string;
    category: ScenarioCategory;
    description: string;
    actions: TestAction[];
    priority: 1 | 2 | 3;
}
```

---

## 현재 구현 상태

### 구현 완료

- [x] 3단계 파이프라인 (Scraper → Analyzer → Generator)
- [x] BFS 기반 Multi-page 탐색
- [x] 인증 지원 (수동/자동 로그인)
- [x] 사이드바 메뉴 자동 확장
- [x] 모달 다이얼로그 탐색
- [x] 테이블 행 클릭 탐색
- [x] WebP 스크린샷 최적화
- [x] Dashboard 웹 UI
- [x] Supervisor 프로세스 관리
- [x] Self-Healing 컨텍스트 캡처
- [x] SPA 라우트 인터셉션
- [x] 네비게이션 버튼 클릭 탐색
- [x] 탭/아코디언 및 필터(Select/Checkbox) 요소 탐색
- [x] iframe 콘텐츠 탐색
- [x] 프레임워크별 Link 감지

### 추후 개발 예정

- [ ] BDD (Gherkin) 지원
- [ ] AI 기반 예상 결과 추론

---

## Regression Testing

UI 변경 사항을 자동으로 감지하고 검증하는 회귀 테스트 시스템입니다.

### 주요 기능

| 단계 | 기능 | 설명 |
|------|------|------|
| **Phase 1** | Visual Regression | `pixelmatch` 기반 픽셀 단위 비교 |
| **Phase 2** | Content Verification | 테이블, 버튼, 입력 필드 구조 검증 |
| **Phase 3** | Anomaly Detection | 중요 요소 변경 자동 감지 |

### 사용법

```bash
# 베이스라인 생성 (최초 1회)
npm run regression:baseline -- --url https://example.com

# 회귀 테스트 실행 (전체)
npm run regression:test -- --url https://example.com

# Visual만 테스트
npm run regression:test -- --url https://example.com --visual-only

# Content만 테스트
npm run regression:test -- --url https://example.com --content-only
```

### Anomaly Detection

중요 요소의 변경을 자동 감지하여 심각도를 판단합니다:

| 유형 | 심각도 | 점수 |
|------|--------|------|
| 중요 버튼 삭제 (Submit, Save 등) | CRITICAL | +30 |
| 필수 입력 필드 삭제 | CRITICAL | +25 |
| 테이블 삭제 | WARNING | +15 |
| 컬럼 삭제 | WARNING | +10 |

```
점수 70+ → CRITICAL: 배포 금지
점수 40-69 → WARNING: 검토 필요
점수 0-39 → INFO: 정상
```

### 출력 구조

```
output/
├── regressions/
│   ├── baselines/           # 베이스라인 스크린샷
│   │   └── {domain}/
│   │       ├── index.json   # 베이스라인 인덱스
│   │       └── *.webp       # 스크린샷
│   ├── diffs/               # 차이 이미지
│   │   └── *.png
│   └── content/             # 콘텐츠 추출 데이터
│       └── *.json
```

## 코드 품질 및 타입 안정성 (Phase 7)
    
프로젝트의 유지보수성과 안정성을 높이기 위해 다음과 같은 엄격한 코드 관리 규칙을 준수합니다.

- **Strict Type Safety**: `any` 타입 사용을 지양하고 `unknown` 및 명확한 인터페이스를 사용합니다.
- **Lint Compliance**: 모든 ESLint 에러를 해결하고 경고를 최소화합니다.
- **TypeScript Verification**: 빌드 시 컴파일 에러 0개를 목표로 합니다.
- **Unused Code Cleanup**: 사용하지 않는 임포트와 변수를 주기적으로 제거합니다.

---

## 라이센스

ISC

---

## 기여

이슈 및 PR 환영합니다.