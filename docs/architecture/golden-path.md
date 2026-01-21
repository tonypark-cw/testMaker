# Golden Path 기능 통합 구현 계획서

## Overview
fix 브랜치의 static 메서드 기반 아키텍처를 유지하면서 main 브랜치의 Golden Path 분석 기능을 복원합니다.

---

## Implementation Phases

### Phase 1: 타입 정의 추가 (10분)

#### Task 1.1: `types/index.ts`에 GoldenPathInfo 인터페이스 추가
- **파일:** `/Users/doongle/testMaker/types/index.ts`
- **위치:** 파일 끝 (export 섹션)
- **변경 내용:**
```typescript
/**
 * Golden Path analysis result
 * Evaluates page stability and testability
 */
export interface GoldenPathInfo {
  isStable: boolean;           // Overall stability assessment
  hasTestableElements: boolean; // Minimum testable elements present
  confidence: number;          // 0.0 to 1.0 confidence score
  reasons: string[];           // Human-readable analysis reasons
}
```
- **검증:** `npx tsc --noEmit` 성공

#### Task 1.2: `src/core/types.ts`의 ScrapeResult 확장
- **파일:** `/Users/doongle/testMaker/src/core/types.ts`
- **위치:** `ScrapeResult` 인터페이스 내부
- **변경 내용:**
```typescript
import { GoldenPathInfo } from '../../types/index.js';

export interface ScrapeResult {
  // ... 기존 필드들 ...
  goldenPath?: GoldenPathInfo; // Optional for backward compatibility
}
```
- **의존성:** Task 1.1 완료 후
- **검증:** 타입 import 해결, 빌드 성공

---

### Phase 2: 분석 로직 구현 (30분)

#### Task 2.1: Scraper에 analyzeGoldenPath static 메서드 추가
- **파일:** `/Users/doongle/testMaker/src/core/scraper.ts`
- **위치:** 클래스 내부, processPage 메서드 위
- **변경 내용:**
```typescript
/**
 * Analyze page stability and testability for Golden Path generation
 * Based on loading indicators, errors, and actionable content
 */
private static async analyzeGoldenPath(
  page: Page,
  elements: TestableElement[]
): Promise<GoldenPathInfo> {
  let confidence = 1.0;
  const reasons: string[] = [];

  // 1. Check for loading indicators (-0.4)
  const hasLoaders = await page.evaluate(() => {
    const loaderSelectors = [
      '.mantine-Loader-root',
      '.loader',
      '.spinner',
      '.loading',
      '[aria-busy="true"]',
      '.ant-spin',
      '.nprogress-bar',
      '[class*="Loading"]',
      '[class*="Spinner"]'
    ];

    return loaderSelectors.some(sel => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        parseFloat(style.opacity) > 0;
    });
  });

  if (hasLoaders) {
    reasons.push('Loading indicators detected - page may not be stable');
    confidence -= 0.4;
  } else {
    reasons.push('No loading indicators detected');
  }

  // 2. Check for error messages (-0.5)
  const hasErrors = await page.evaluate(() => {
    const errorSelectors = [
      '[role="alert"]',
      '.error',
      '.alert-error',
      '[class*="Error"]',
      '[class*="error"]',
      '.mantine-Alert[data-severity="error"]'
    ];

    return errorSelectors.some(sel => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const text = el.textContent?.toLowerCase() || '';
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        text.includes('error');
    });
  });

  if (hasErrors) {
    reasons.push('Error messages detected on page');
    confidence -= 0.5;
  } else {
    reasons.push('No error messages detected');
  }

  // 3. Check for sufficient testable elements (-0.3 if < 3)
  const testableElementCount = elements.length;
  const hasTestableElements = testableElementCount >= 3;

  if (hasTestableElements) {
    reasons.push(`Page has ${testableElementCount} testable elements`);
  } else {
    reasons.push(`Insufficient testable elements (${testableElementCount} < 3)`);
    confidence -= 0.3;
  }

  // 4. Check for actionable content (-0.2 if none)
  const hasActionableContent = elements.some(el =>
    el.type === 'button' ||
    el.tag === 'form' ||
    el.type === 'text-input' ||
    el.type === 'select'
  );

  if (hasActionableContent) {
    reasons.push('Page has actionable content (forms/buttons)');
  } else {
    reasons.push('No actionable content detected');
    confidence -= 0.2;
  }

  // Ensure confidence stays in valid range [0, 1]
  confidence = Math.max(0, Math.min(1, confidence));

  const isStable = !hasLoaders && !hasErrors;

  return {
    isStable,
    hasTestableElements,
    confidence,
    reasons
  };
}
```

#### Task 2.2: processPage 메서드에 Golden Path 분석 통합
- **파일:** `/Users/doongle/testMaker/src/core/scraper.ts`
- **위치:** `processPage` 메서드, return 문 직전
- **변경 내용:**
```typescript
// 기존 요소 추출 후, return 전에 추가:

// Analyze Golden Path stability
const goldenPath = await this.analyzeGoldenPath(page, elements);
console.log(`[Scraper] Golden Path: Stable=${goldenPath.isStable}, Confidence=${goldenPath.confidence.toFixed(2)}`);

// return에 goldenPath 추가
return {
  url,
  pageTitle,
  elements,
  links: discoveredLinks,
  sidebarLinks,
  screenshotPath,
  modalDiscoveries,
  newlyDiscoveredCount: discoveredLinks.length,
  goldenPath,  // <-- 추가
};
```
- **의존성:** Task 2.1 완료 후
- **검증:** `npx tsc --noEmit` 성공

---

### Phase 3: CLI 출력 구현 (10분)

#### Task 3.1: Runner에서 Golden Path 결과 로깅
- **파일:** `/Users/doongle/testMaker/src/core/runner.ts`
- **위치:** `runWorker` 메서드 내부, result 받은 직후
- **변경 내용:**
```typescript
// 기존: const result = await Scraper.processPage(...);
// 그 아래에 추가:

if (result.goldenPath) {
  const { isStable, confidence, reasons } = result.goldenPath;
  const status = isStable ? '✓ STABLE' : '⚠ UNSTABLE';
  const confidencePercent = (confidence * 100).toFixed(0);

  console.log(`[Runner] Golden Path: ${status} (${confidencePercent}%)`);
  reasons.forEach(reason => console.log(`[Runner]   - ${reason}`));
}
```
- **의존성:** Phase 2 완료 후
- **검증:** CLI 실행 시 Golden Path 로그 출력 확인

---

### Phase 4: 대시보드 통합 (10분)

#### Task 4.1: 대시보드 서버에 confidence score 표시
- **파일:** `/Users/doongle/testMaker/src/dashboard/server.ts`
- **위치:** JSON 메타데이터 파싱 부분
- **변경 내용:**
```typescript
// JSON 파일에서 goldenPath 정보 추출
const metadata = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
const goldenPath = metadata.goldenPath;

// 엔트리에 confidence 추가
entry.confidence = goldenPath?.confidence ?? null;
entry.isStable = goldenPath?.isStable ?? null;
entry.goldenPathReasons = goldenPath?.reasons ?? [];
```

#### Task 4.2: index.html에 confidence badge 표시
- **파일:** `/Users/doongle/testMaker/src/dashboard/index.html`
- **위치:** 스크린샷 카드 렌더링 부분 (JavaScript 섹션)
- **변경 내용:**
```javascript
// 카드 생성 시 confidence badge 추가
const confidenceBadge = entry.confidence !== null
  ? `<span class="confidence-badge"
          style="background: ${entry.isStable ? '#4caf50' : '#ff9800'};
                 color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px;"
          title="${entry.goldenPathReasons?.join('\n') || ''}">
       ${(entry.confidence * 100).toFixed(0)}% ${entry.isStable ? '✓' : '⚠'}
     </span>`
  : '';

// 카드 HTML에 badge 삽입
cardHtml += confidenceBadge;
```
- **의존성:** Phase 2 완료 후
- **검증:** 대시보드 접속 시 confidence badge 표시 확인

---

### Phase 5: 문서화 및 검증 (15분)

#### Task 5.1: 통합 테스트
```bash
# 1. 타입 체크
npx tsc --noEmit

# 2. CLI 테스트
npx tsx src/core/cli.ts --url "https://example.com" --limit 1

# 3. 대시보드 확인
npm run dashboard
```

#### Task 5.2: 검증 체크리스트
- [ ] `GoldenPathInfo` 타입 정의됨
- [ ] `ScrapeResult.goldenPath` 필드 존재
- [ ] `analyzeGoldenPath` 4가지 조건 평가
- [ ] CLI에 confidence + reasons 출력
- [ ] 대시보드에 confidence badge 표시
- [ ] 기존 스크래핑 기능 정상

---

## Confidence Score 계산 기준

| 조건 | 감점 | 설명 |
|------|------|------|
| Loading indicator 감지 | -0.4 | 로더, 스피너 등 |
| Error message 감지 | -0.5 | alert, error 클래스 |
| Testable elements < 3 | -0.3 | 최소 3개 필요 |
| Actionable content 없음 | -0.2 | 버튼, 폼 등 없음 |

**안정성 판단:**
- `isStable = true`: 로더 없음 AND 에러 없음
- `confidence >= 0.6`: 테스트에 적합

---

## 모듈 의존성

```
types/index.ts (GoldenPathInfo)
    ↓
src/core/types.ts (ScrapeResult 확장)
    ↓
src/core/scraper.ts (analyzeGoldenPath)
    ↓
├── src/core/runner.ts (CLI 출력)
└── src/dashboard/server.ts (대시보드)
```

---

## AI 에이전트 전달 지침

1. **Phase 순서 엄격히 준수** (1→2→3→4→5)
2. **매 변경 후 `npx tsc --noEmit` 실행**
3. **`goldenPath?` optional 유지** (하위 호환성)
4. **fix 브랜치의 static 메서드 패턴 유지**
5. **기존 테스트 영향 최소화**

---

Last Updated: 2026-01-13
