# Dashboard Screenshot Cache 통합 가이드

## 설치

```bash
npm install chokidar
```

## server.ts 통합 방법

### 1. Import 추가 (상단)

```typescript
import { getScreenshotCache, ScreenshotCache } from './ScreenshotCache.js';
```

### 2. 서버 시작 시 초기화 (server.listen 전)

```typescript
// Initialize screenshot cache
const screenshotCache = getScreenshotCache(OUTPUT_DIR);
await screenshotCache.init();
await screenshotCache.waitForReady();
```

### 3. getStats 함수 수정

**기존 (느림 - 매번 디렉토리 스캔)**:
```typescript
async function getStats(forceRefresh = false) {
    // ... 475-516줄의 traverse 로직
}
```

**신규 (빠름 - 메모리 캐시)**:
```typescript
async function getStats(forceRefresh = false) {
    const cache = getScreenshotCache();
    const screenshots = cache.getAll(); // 즉시 반환 (0ms)

    // 나머지 로직은 동일...
    return {
        analyzedCount: screenshots.length,
        screenshots,
        // ...
    };
}
```

## 예상 효과

| 지표 | 기존 | 신규 |
|------|------|------|
| /api/stats 응답 | 200-500ms | **< 1ms** |
| 디스크 I/O | 매 요청 | 변경 시에만 |
| CPU 사용 | 높음 (재귀 스캔) | 최소 |

## Fallback

chokidar가 설치되지 않은 경우 기존 동작으로 자동 폴백됩니다.
