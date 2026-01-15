# Keyword Refactoring Plan: analyze → search/transform/analyze

## 배경 및 동기

현재 코드베이스에서 `analyze`라는 키워드가 실제 동작과 맞지 않게 사용되고 있음.

### 문제점
- `npm run analyze` → 실제로는 페이지를 **수집(scraping)**하는 동작
- `Analyzer` 클래스 → 실제로는 요소를 시나리오로 **변환(transform)**하는 동작
- 진짜 **분석(analyze)**은 `analyzeGoldenPath()`에서 점수 기반 판별을 수행

### 목표
용어를 실제 동작에 맞게 정리하여 코드 가독성과 유지보수성 향상

---

## 변경 후 플로우

```
┌─────────────────────────────────────────────────────────────────┐
│                         npm run search                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   URL 입력                                                      │
│      │                                                          │
│      ▼                                                          │
│   ┌───────────────────── search (수집) ─────────────────────┐  │
│   │   Scraper ──▶ 페이지 방문, 요소 추출, 스크린샷          │  │
│   └──────────────────────────────────────────────────────────┘  │
│                      │                                          │
│                      ▼                                          │
│   ┌───────────────────── transform (변환) ──────────────────┐  │
│   │   Transformer ──▶ 요소 → 테스트 시나리오 변환           │  │
│   └──────────────────────────────────────────────────────────┘  │
│                      │                                          │
│                      ▼                                          │
│   ┌───────────────────── analyze (분석) ────────────────────┐  │
│   │   analyzeGoldenPath ──▶ 점수 평가, 품질 판별            │  │
│   └──────────────────────────────────────────────────────────┘  │
│                      │                                          │
│                      ▼                                          │
│   ┌───────────────────── generate (출력) ───────────────────┐  │
│   │   Generator ──▶ JSON, Markdown, Playwright 출력         │  │
│   └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 변경 상세 매핑

### 1. 명령어 & API

| Before | After | 파일 |
|--------|-------|------|
| `npm run analyze` | `npm run search` | `package.json` |
| `/api/analyze` | `/api/search` | `src/dashboard/server.ts` |
| `--force` "Force re-analysis" | `--force` "Force re-search" | `src/core/cli.ts` |

### 2. 타입 & 인터페이스

| Before | After | 파일 |
|--------|-------|------|
| `AnalysisResult` | `SearchResult` | `types/index.ts` |
| `GoldenPathAnalysis` | 유지 (진짜 분석) | - |

### 3. 클래스 & 함수

| Before | After | 파일 |
|--------|-------|------|
| `Analyzer` 클래스 | `Transformer` 클래스 | `scripts/analyzer.ts` → `scripts/transformer.ts` |
| `analyzer.analyze()` | `transformer.transform()` | 위 파일 |
| `analyzeGoldenPath()` | 유지 (진짜 분석) | - |

### 4. 변수명

| Before | After | 파일 |
|--------|-------|------|
| `analyzedCount` | `searchedCount` | `src/core/runner.ts`, `src/dashboard/server.ts` |
| `lastAnalyzedCount` | `lastSearchedCount` | `src/dashboard/server.ts` |
| `analysisResult` | `searchResult` | `src/core/runner.ts` |
| `this.analyzer` | `this.transformer` | `src/core/runner.ts` |

### 5. UI & 메시지

| Before | After | 파일 |
|--------|-------|------|
| "Start Analysis" | "Start Search" | `src/dashboard/index.html` |
| "Stop" (stopAnalysis) | "Stop" (stopSearch) | `src/dashboard/index.html` |
| "Analyzed Pages" | "Searched Pages" | `src/dashboard/index.html` |
| "Re-analyze FAIL" | "Re-search FAIL" | `src/dashboard/index.html` |
| "Analysis running" | "Search running" | `src/dashboard/server.ts` |
| "Analysis queued" | "Search queued" | `src/dashboard/server.ts` |
| "Analysis started" | "Search started" | `src/dashboard/server.ts` |
| `startAnalysis()` | `startSearch()` | `src/dashboard/index.html` |
| `stopAnalysis()` | `stopSearch()` | `src/dashboard/index.html` |
| `reanalyzeFailures()` | `researchFailures()` | `src/dashboard/index.html` |

---

## 파일별 변경 목록

### Phase 1: 핵심 (우선 완료)

#### 1. `package.json`
```json
// Before
"analyze": "tsx src/core/cli.ts"

// After
"search": "tsx src/core/cli.ts"
```

#### 2. `types/index.ts`
```typescript
// Before
export interface AnalysisResult { ... }

// After
export interface SearchResult { ... }
```

#### 3. `scripts/analyzer.ts` → `scripts/transformer.ts`
- 파일명 변경: `analyzer.ts` → `transformer.ts`
- 클래스명 변경: `Analyzer` → `Transformer`
- 메서드명 변경: `analyze()` → `transform()`
- 로그 메시지: `[Analyzer]` → `[Transformer]`

#### 4. `src/core/runner.ts`
```typescript
// Before
import { Analyzer } from '../../scripts/analyzer.js';
private analyzer = new Analyzer();
private analyzedCount = 0;
const scenarios = this.analyzer.analyze(result.elements);
const analysisResult: AnalysisResult = { ... };
console.log(`[Runner] Completed (${this.analyzedCount}): ...`);
console.log(`[Runner] Finished. Analyzed ${this.analyzedCount} pages...`);

// After
import { Transformer } from '../../scripts/transformer.js';
private transformer = new Transformer();
private searchedCount = 0;
const scenarios = this.transformer.transform(result.elements);
const searchResult: SearchResult = { ... };
console.log(`[Runner] Completed (${this.searchedCount}): ...`);
console.log(`[Runner] Finished. Searched ${this.searchedCount} pages...`);
```

### Phase 2: API/서버

#### 5. `src/dashboard/server.ts`
- `/api/analyze` → `/api/search`
- `lastAnalyzedCount` → `lastSearchedCount`
- `analyzedCount` → `searchedCount`
- 로그 메시지들 변경

#### 6. `src/dashboard/worker.ts`
```typescript
// Before
const args = ['run', 'analyze', '--', '--url', job.url, '--force'];

// After
const args = ['run', 'search', '--', '--url', job.url, '--force'];
```

#### 7. `src/core/cli.ts`
```typescript
// Before
.description('Automated Test Analysis Tool (Multi-Tab Parallel)')
.option('--force', 'Force re-analysis', false)

// After
.description('Automated Test Search Tool (Multi-Tab Parallel)')
.option('--force', 'Force re-search', false)
```

### Phase 3: UI/문서

#### 8. `src/dashboard/index.html`
- 버튼 텍스트: "Start Analysis" → "Start Search"
- 라벨: "Analyzed Pages" → "Searched Pages"
- 버튼: "Re-analyze FAIL" → "Re-search FAIL"
- 함수명: `startAnalysis()` → `startSearch()`, `stopAnalysis()` → `stopSearch()`, `reanalyzeFailures()` → `researchFailures()`

#### 9. `scripts/generator.ts`
```typescript
// Before
import { AnalysisResult, GeneratorOptions } from '../types/index.js';
async generate(result: AnalysisResult, options: GeneratorOptions)

// After
import { SearchResult, GeneratorOptions } from '../types/index.js';
async generate(result: SearchResult, options: GeneratorOptions)
```

#### 10. `README.md`
- `npm run analyze` → `npm run search`
- "Analyzer" → 적절히 수정
- 다이어그램 업데이트

#### 11. 기타 문서
- `docs/PROJECT_BRIEFING.md`
- `docs/architecture/systems.md`
- `docs/architecture/golden-path.md`

---

## 유지되는 항목 (변경 안 함)

| 항목 | 이유 |
|------|------|
| `analyzeGoldenPath()` | 진짜 분석 (점수 기반 판별) |
| `GoldenPathAnalysis` 타입 | 진짜 분석 결과 |
| `.agent/workflows/agents/analysis.md` | Claude 에이전트 설정 (별개) |

---

## 검증 체크리스트

- [ ] `npm run search` 명령어 정상 동작
- [ ] 대시보드 UI에서 검색 시작/중지 동작
- [ ] `/api/search` 엔드포인트 응답
- [ ] TypeScript 컴파일 에러 없음
- [ ] ESLint 경고 없음
- [ ] 기존 output 파일과 호환성 (SearchResult 구조)

---

## 참고: 현재 analyze 사용처 검색 결과

```bash
# analyze/Analyze/ANALYZE 검색 결과 주요 파일
src/dashboard/worker.ts
src/dashboard/server.ts
src/dashboard/index.html
src/core/cli.ts
src/core/runner.ts
scripts/analyzer.ts
scripts/generator.ts
types/index.ts
package.json
README.md
```

---

*Created: 2026-01-15*
*Status: Planning*
