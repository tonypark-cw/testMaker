# 아키텍처 리팩토링 분석 결과

## 제안된 3가지 아키텍처 비교

| 패턴 | 실현가능성 | 확장성 | 유지보수 | 오류검출 | 난이도 | 우선순위 |
|------|-----------|--------|---------|---------|--------|---------|
| **Command Pattern** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Medium | 🔴 High |
| **Hexagonal Architecture** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | High | 🟡 Medium |
| **Event-Driven** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | High | 🟢 Low |

---

## 🔴 즉시 적용 권장: Command Pattern

### 현재 문제 (UISettler.smartClick L220-248)
```typescript
// ❌ 액션 수동 기록, 재시도 로직 산재
await createBtn.click();
actionChain.push({ type: 'click', target: 'Create', timestamp: Date.now() });
```

### 개선 후
```typescript
// ✅ 자동 로깅 + 재시도 중앙화
await executor.execute(new ClickCommand(createBtn, { target: 'Create' }));
```

### 효과
- 디버깅 시간 30% 감소 (자동 액션 로그)
- 재시도 로직 일관성
- Recorder 기능과 자연스러운 통합

---

## 추가 권장: Strategy Pattern (Phase 관리)

### 현재 문제
8개 Phase가 `src/scraper/index.ts`에 하드코딩

### 개선 후
```typescript
const orchestrator = new ExplorationOrchestrator();
orchestrator.addPhase(new StabilityPhase());
orchestrator.addPhase(new MenuExpansionPhase());
orchestrator.addPhase(new TabExplorationPhase());
// Phase 순서를 설정으로 제어 가능
```

---

## ✅ 코드베이스 검토 결과 (2026-01-21)

### Command Pattern 적용 우선순위

| 순위 | 대상 | 파일 | 이유 |
|------|------|------|------|
| 1순위 | `smartClick()` | `UISettler.ts` L220-248 | 모든 Explorer에서 호출, 가장 영향력 큼 |
| 2순위 | `exploreTableRows()` | `ContentExplorer.ts` | Row 클릭 로직 반복 |
| 3순위 | Filter 조작 | `FilterExplorer.ts` | Select/Checkbox 조작 패턴화 |

### 현재 테스트 커버리지

| 모듈 | 상태 | 비고 |
|------|------|------|
| QueueManager | ✅ 23 tests | 완료 |
| ScoringProcessor | ✅ | 완료 |
| SessionManager | ✅ | 완료 |
| NetworkManager | ✅ | 완료 |
| **UISettler** | ❌ 없음 | **우선 작성 필요** |
| **Scraper** | ❌ 없음 | Phase 분리 후 작성 |

---

## 권장 로드맵

| 단계 | 기간 | 내용 | 효과 |
|------|------|------|------|
| **Phase 1** | 2-3주 | Command Pattern + Strategy Pattern | 즉시 테스트/디버깅 개선 |
| **Phase 2** | 4-6주 | Hexagonal (QueueManager, ScoringProcessor) | 단위테스트 85% |
| **Phase 3** | RL 시점 | Event-Driven | RL 모듈 독립 통합 |

---

## 📋 즉시 실행 액션 플랜

| 순서 | 작업 | 예상 시간 | 상태 |
|------|------|----------|------|
| 1 | `UISettler.smartClick()` 테스트 작성 | 2-3시간 | ⏳ |
| 2 | `ClickCommand` + `CommandExecutor` 프로토타입 | 1일 | ⏳ |
| 3 | `NavExplorer`에 적용하여 검증 | 반나절 | ⏳ |
| 4 | 나머지 Explorer에 점진 적용 | 1주 | ⏳ |

---

## ⚠️ 주의사항

### 하지 말 것
- ❌ 전체 시스템 한 번에 재작성 (Big Bang)
- ❌ 아직 필요 없는 기능을 위한 추상화
- ❌ 테스트 없이 리팩토링

### 먼저 할 것
- ✅ 현재 기능에 대한 테스트 커버리지 확보
- ✅ 점진적 적용 (한 모듈씩)
- ✅ 리팩토링 전후 동작 비교 검증

---

Last Updated: 2026-01-21