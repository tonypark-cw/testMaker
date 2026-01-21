# [Phase 3] Advanced Architecture & Orchestration 마무리 계획서

본 계획서는 기존 Phase 3 로드맵에 명시된 **아키텍처 고도화**의 핵심인 **오케스트레이터(Orchestrator)** 도입과 **상태 격리(Context)**를 포함하여 시스템을 완성하는 것을 목표로 합니다.

## 핵심 목표
- **유연한 흐름 제어**: `Scraper.scrape()`의 절차적 호출을 `ExplorationOrchestrator`로 전환하여 탐색 페이즈의 추가/제거 및 순서 제어를 유연하게 개선.
- **인스턴스 기반 상태 격리**: Static 변수를 완전히 제거하고 `ExplorationContext`를 통해 각 탐색 세션의 독립성을 보장 (멀티탭 경쟁 조건 해결).
- **느슨한 결합(Decoupling)**: Event Bus를 통해 핵심 로직과 부가 기능(RL 학습, 로깅)을 분리.
- **실행 신뢰성**: 커맨드 실행 후 기대 상태(Validation) 체크를 수행하여 탐색의 정확도 향상.

## 상세 변경 사항

### 1. 오케스트레이션 및 상태 관리 (Orchestration & Context)
- [NEW] `src/scraper/phases/IExplorationPhase.ts`: 페이즈 공통 인터페이스 정의.
- [NEW] `src/scraper/phases/ExplorationContext.ts`: 세션별 상태(Hash, Visited 등)를 담는 객체 정의.
- [NEW] `src/scraper/phases/ExplorationOrchestrator.ts`: 등록된 페이즈들을 순차적으로 실행하는 전략 패턴 구현.
- [MODIFY] `src/scraper/index.ts`: 직접적인 페이즈 호출을 제거하고 `orchestrator.execute(context)` 방식으로 전환.

### 2. 통신 및 부가 기능 (Event Bus)
- [NEW] `src/shared/events/EventBus.ts`: Pub/Sub 기반의 이벤트 버스 구현.
- [NEW] `src/scraper/subscribers/RLSubscriber.ts`: 스크래퍼에서 발생하는 이벤트를 가로채 RL 학습 데이터 업데이트.

### 3. 커맨드 고도화 (Advanced Command)
- [MODIFY] `src/scraper/commands/Command.ts`: `validate(): Promise<boolean>` 추상 메서드 추가.
- [MODIFY] `src/scraper/commands/CommandExecutor.ts`: 검증 실패 시 스마트 재시도 로직 강화.

## 실행 순서
1. `ExplorationContext` 및 `IExplorationPhase` 정의.
2. `EventBus` 구현 및 `RLStateManager` 호출을 이벤트 발행으로 전환.
3. 기존 페이즈들을 `IExplorationPhase` 인터페이스에 맞춰 리팩토링.
4. `Scraper` 클래스에서 static 변수를 제거하고 오케스트레이터 적용.
5. 커맨드 검증(Validation) 로직 추가.

## 검증 계획
- **정적 분석**: `npx tsc --noEmit`을 통해 구조 변경 후의 타입 안정성 확인.
- **유닛 테스트**: `ExplorationOrchestrator`가 페이즈들을 올바른 순서로 실행하는지 테스트.
- **통합 검증**: 단일 도메인 스캔을 통해 이벤트 발행 및 데이터 수집 결과 확인.
