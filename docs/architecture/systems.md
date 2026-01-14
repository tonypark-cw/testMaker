# Core Systems

> Extracted from PROJECT_BRIEFING.md for detailed reference

## Golden Path Analysis

페이지 안정성 및 테스트 적합성을 자동 평가하는 기능. **scraper.ts L35-139**에 구현됨.

### 개요
| 항목 | 설명 |
|------|------|
| **목적** | 테스트에 적합한 안정적인 페이지 식별 |
| **출력** | confidence score (0-1), isStable, reasons |
| **표시** | CLI 로그 + 대시보드 badge |
| **호출 시점** | Phase 8 Extraction 완료 후 (L1101) |

### Confidence Score 계산
| 조건 | 감점 | 설명 |
|------|------|------|
| Loading indicator | -0.4 | 로더, 스피너 감지 |
| Error message | -0.5 | alert, error 클래스 |
| Testable elements < 3 | -0.3 | 최소 3개 필요 |
| No actionable content | -0.2 | 버튼, 폼 없음 |

### 안정성 판단
- **Stable**: 로더 없음 AND 에러 없음
- **권장 임계값**: confidence ≥ 0.6

### 구현 파일
| 파일 | 변경 내용 |
|------|----------|
| `types/index.ts` | GoldenPathInfo 타입 추가 |
| `src/core/types.ts` | ScrapeResult.goldenPath 필드 |
| `src/core/scraper.ts` | analyzeGoldenPath() 메서드 (L35-139) |
| `src/core/runner.ts` | CLI 출력 |
| `src/dashboard/server.ts` | 대시보드 표시 |

---

## Action Chain System

사용자 여정을 추적하여 Golden Path 검증에 활용.

### 구조
```typescript
interface ActionRecord {
  type: 'click' | 'nav' | 'input';
  selector: string;
  label: string;
  timestamp: string;
  url: string;
}
```

### 데이터 흐름
```
ScrapeJob.actionChain → Scraper 실행 → ScrapeResult.actionChain → Validator 검증
```

### 구현 위치
| 파일 | 라인 | 설명 |
|------|------|------|
| `src/core/types.ts` | L7, L20 | actionChain 필드 정의 |
| `src/core/scraper.ts` | L23-29 | 인스턴스 레벨 추적 |

---

## RL (Reinforcement Learning) System

페이지 신뢰도 학습 및 상태 관리 시스템.

### 구성 파일
| 파일 | 역할 |
|------|------|
| `src/core/rl/RLStateManager.ts` | 상태 영속성 관리 |
| `src/core/rl/ReliabilityScorer.ts` | 페이지 신뢰도 점수 계산 |
| `src/core/rl/ReliabilityScorer.test.ts` | 유닛 테스트 |

### 통합 위치
- `src/core/scraper.ts` L146-148: RLStateManager 초기화 (탭 간 공유)

---

## Development Tools

### Inspector (src/core/inspector.ts)

UI 구조 디버깅 및 분석 도구.

| 항목 | 설명 |
|------|------|
| **목적** | 사이드바 구조, 버튼, 페이지네이션 캡처 |
| **출력** | `output/ui_inspection.log` |
| **용도** | 탐색 로직 디버깅, 요소 발견 검증 |

### Validator (scripts/validator.ts)

탐색 결과 일관성 검증 도구.

| 항목 | 설명 |
|------|------|
| **목적** | 제목/경로 상관관계 검증 |
| **점수** | 0-100 일관성 점수 |
| **출력** | Markdown 보고서 |

---

Last Updated: 2026-01-14
