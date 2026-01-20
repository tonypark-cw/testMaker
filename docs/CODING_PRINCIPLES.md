# TestMaker Coding Principles & Standards

## 목적
이 문서는 TestMaker 프로젝트의 코딩 원칙과 아키텍처 표준을 정의하여, 모든 개발자와 AI 에이전트가 일관된 코드를 작성할 수 있도록 합니다.

---

## 1. TypeScript 원칙

### 타입 안정성
```typescript
// ✅ 명시적 타입 정의
interface ScraperConfig {
  url: string;
  depth: number;
  limit: number;
}

// ❌ any 사용 금지
function process(data: any) { } // BAD
function process(data: ScraperConfig) { } // GOOD
```

### Strict Mode
- `tsconfig.json`에 `strict: true` 유지
- `null`과 `undefined` 명시적 처리
- Optional chaining (`?.`) 적극 활용

---

## 2. 아키텍처 패턴

### Singleton 패턴
**사용처**: 전역 상태, 세션 관리
```typescript
// SessionManager, RecoveryManager 등
class SessionManager {
  private static instance: SessionManager;
  static getInstance() { ... }
}
```

### Explorer 패턴
**사용처**: 탐색 로직 분리
```typescript
// NavExplorer, ContentExplorer, ActionExplorer
class NavExplorer {
  static async expandMenus(...) { }
  static async discoverSidebar(...) { }
}
```

### 책임 분리
- **Runner**: 브라우저 관리, 워커 분배
- **Scraper**: 8-Phase 탐색 실행
- **QueueManager**: URL 큐 관리
- **각 Explorer**: 특정 탐색 로직

---

## 3. 에러 처리

### Try-Catch 필수
```typescript
// ✅ 모든 외부 호출은 try-catch
try {
  await page.click(selector);
} catch (e) {
  console.error(`Click failed: ${e}`);
  // Fallback 로직
}
```

### 방어적 프로그래밍
```typescript
// ✅ null 체크
if (!page || page.isClosed()) {
  return { /* default */ };
}

// ✅ Optional chaining
const title = await page.title().catch(() => 'Unknown');
```

### 에러 전파
- Critical 에러: throw
- Non-critical 에러: log and continue
- User-facing 에러: 명확한 메시지

---

## 4. 로깅 원칙

### 구조화된 로깅
```typescript
// ✅ 컨텍스트 포함
console.log(`[QueueMgr] ➕ Added to queue: ${url} (depth=${depth})`);
console.log(`[Runner] [${count}/${limit}] Worker started for: ${url}`);

// ❌ 모호한 로그
console.log('Added'); // BAD
```

### 로그 레벨 이모지
- `🔍` - Check/Verify
- `➕` - Add/Create
- `✅` - Success/Complete
- `⏭️` - Skip
- `🚫` - Reject/Block
- `❌` - Error/Fail
- `📊` - Summary/Stats
- `⚠️` - Warning

### 디버그 로그
- 중요 상태 변화는 반드시 로그
- `[Component]` prefix 일관성 유지
- 숫자는 진행 상황 표시 (`[3/100]`)

---

## 5. 테스팅 원칙

### 유닛 테스트 필수
```typescript
// tests/*.test.ts
describe('QueueManager', () => {
  it('should not add visited URLs', () => {
    // Given
    const qm = new QueueManager(...);
    
    // When
    qm.markVisited(url);
    const added = qm.addJobs([{ url, depth: 0 }]);
    
    // Then
    expect(added).toBe(0);
  });
});
```

### 테스트 대상
- 핵심 비즈니스 로직
- 상태 관리 코드
- 버그 수정 후 회귀 방지

### Given-When-Then 패턴
- Given: 초기 상태 설정
- When: 테스트할 동작 실행
- Then: 결과 검증

---

## 6. 파일 구조

### 명명 규칙
```
src/
├── core/
│   ├── lib/
│   │   ├── explorers/
│   │   │   ├── NavExplorer.ts      # Pascal Case
│   │   │   ├── ContentExplorer.ts
│   │   │   └── ActionExplorer.ts
│   │   ├── QueueManager.ts
│   │   └── SessionManager.ts
│   ├── runner.ts                    # camelCase
│   └── scraper.ts
├── dashboard/
│   └── assets/
│       └── js/
│           ├── state.js             # camelCase
│           ├── filter.js
│           └── selection.js         # NEW features
└── tests/
    └── QueueManager.test.ts         # PascalCase.test.ts
```

### 모듈 분리
- 한 파일당 하나의 주요 책임
- 500줄 이상이면 분리 고려
- Helper functions는 별도 파일

---

## 7. 상태 관리

### Immutability
```typescript
// ✅ 새 배열/객체 반환
const newList = [...workingList].filter(...);

// ❌ 원본 변경
workingList.filter(...); // BAD
```

### Set/Map 활용
```typescript
// ✅ 중복 제거, O(1) 조회
const visited = new Set<string>();
const groups = new Map<string, Screenshot[]>();

// ❌ Array includes (O(n))
const visited = [];
if (visited.includes(url)) { } // SLOW
```

---

## 8. 비동기 처리

### Async/Await 사용
```typescript
// ✅ 명시적 async/await
async function scrape() {
  await page.goto(url);
  const title = await page.title();
}

// ❌ Promise chaining (가독성 낮음)
```

### Promise.all 활용
```typescript
// ✅ 병렬 처리 가능한 경우
const results = await Promise.all([
  page.screenshot(),
  page.title(),
  page.url()
]);
```

### Timeout 설정
```typescript
// ✅ 무한 대기 방지
await page.waitForTimeout(2000);
await page.goto(url, { timeout: 30000 });
```

---

## 9. 코드 리뷰 체크리스트

작업 완료 시 반드시 확인:

- [ ] TypeScript 컴파일 에러 없음
- [ ] 새 기능에 대한 로그 추가
- [ ] 에러 처리 (try-catch) 존재
- [ ] 중요 로직에 유닛 테스트 추가
- [ ] 파일명/함수명 규칙 준수
- [ ] README/문서 업데이트 (필요 시)
- [ ] 하드코딩된 값 제거 (환경변수 사용)

---

## 10. 금지 사항

### 절대 하지 말 것
- ❌ `any` 타입 사용 (unavoidable한 경우만 주석 명시)
- ❌ `console.log` 없는 중요 로직
- ❌ try-catch 없는 외부 API 호출
- ❌ 하드코딩된 credential
- ❌ 동기 blocking 코드 (fs.readFileSync 등)
- ❌ 전역 변수 (Singleton 제외)

---

## 11. 변경 시 문서 업데이트

### 필수 업데이트 대상
- `docs/PROJECT_BRIEFING.md` - 새 기능 추가 시
- `docs/architecture/*.md` - 아키텍처 변경 시
- `docs/history/known-issues.md` - 버그 수정 시
- `README.md` - 사용법 변경 시

### 주석 규칙
```typescript
// [BUG FIX] 설명
// [CRITICAL FIX] 설명
// [OPTIMIZATION] 설명
// [NEW] 설명
```

---

## 12. Git Commit 규칙

### Conventional Commits
```bash
feat: Add DELETE tag soft-delete feature
fix: URL scope filtering to prevent sibling path exploration
test: Add 23 unit tests for QueueManager
docs: Update PROJECT_BRIEFING with 2026-01-20 changes
refactor: Extract ControlExplorer from Scraper
```

### Type 종류
- `feat`: 새 기능
- `fix`: 버그 수정
- `test`: 테스트 추가
- `docs`: 문서 변경
- `refactor`: 리팩토링
- `perf`: 성능 개선

---

Last Updated: 2026-01-20
