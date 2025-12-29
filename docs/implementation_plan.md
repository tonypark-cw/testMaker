# Implementation Plan - Advanced Page Discovery & Navigation Optimization

## Goals
1. **Fix Limited Page Discovery**: Ensure sidebar buttons (non-anchors) are correctly identified and clicked.
2. **Robust Row-Click Navigation**: Ensure table rows correctly trigger URL changes or modals using coordinate-based clicking.
3. **Navigation Optimization**: Prevent redundant exploration of the global sidebar across different pages.
4. **Visual Verification**: Use MD5 hashing to ensure unique screenshots are captured for SPA routes.

## Proposed Changes

### [Scraper] [scraper.ts](file:///Users/doongle/auto_test_form/testMaker/src/scraper.ts)
- **Coordinate-based Clicking**: Use `mouse.click` at the element's bounding box center to bypass SPA event filtering.
- **Navigation Caching**: Use `static` sets to track visited sidebar buttons and menu expansion toggles globally across the session.
- **Table-based Row Optimization**: Iterate through each `<table>` and attempt to click the **SECOND** `<tr>`. If not available, fall back to the **FIRST** `<tr>`. If a table has no rows, it is skipped. This prevents redundant exploration while ensuring data interaction.
- **Immediate Element Capture**: For both modals AND detail pages discovered via interaction, the scraper will extract interactive elements and take a screenshot **immediately**. This ensures consistent data collection regardless of whether the UI uses a modal or a separate page.
- **Consolidated Flow**: Flatten discovery phases (Menu Expansion -> Sidebar Discovery -> Row Click -> Global Actions) into a clean, singular execution path.
- **Robust URL Polling**: Increase wait times to 5 seconds with polling every 500ms for both URL changes and modals.

## Verification Plan
1. **Run Analyze**: Execute `npm run analyze -- --url "https://stage.ianai.co" --recursive --depth 2 --limit 50 --force`
2. **Verify Logs**:
   - `Expanded X NEW menu items` (Should only occur significantly on the first page).
   - `Active Sidebar Discovery (Cached: X)` (Should show increasing cache size and skipped buttons).
   - `✓ URL Change` or `✓ Modal found` after `Clicking row`.
3. **Check Output**: Inspect `output/screenshots` for detail page and modal captures.
---

## Implementation History (Append-only)

### [2025-12-29] Phase 8: Optimized Table Discovery & Consistent Capture
- **[MODIFIED] [scraper.ts](file:///Users/doongle/auto_test_form/testMaker/src/scraper.ts)**:
    - **Table-based Row Logic**: Updated `PHASE 6` to iterate through `page.$$('table')`.
    - **Row Selection**: Implemented logic to click the 2nd `tr` (`rows[1]`) if available, otherwise the 1st `tr` (`rows[0]`). If no rows exist, the table is skipped.
    - **Immediate Detail Capture**: Added `[IMMEDIATE CAPTURE]` block within the URL change detection loop. This extracts up to 50 interactive elements and takes a full-page screenshot of the detail page before navigating back.
    - **Data Alignment**: Detail page captures are now stored in `modalDiscoveries` using a consistent schema (`triggerText`, `modalTitle`, `elements`, `links`, `screenshotPath`), ensuring they appear in the final report alongside modals.
    - **Error Handling**: Added try-catch blocks around row interactions to prevent one failure from stopping the entire analysis.
- **Status**: Completed and verified via code review.

### [2025-12-29] Phase 9: URL Protocol Filtering & Scheme Cleanup
- **[MODIFIED] [scraper.ts](file:///Users/doongle/auto_test_form/testMaker/src/scraper.ts)**:
    - **Global Filtering**: Updated `processLinks` to strictly allow only `http:` and `https:` protocols.
    - **Debug Log Cleanup**: Updated raw link debug evaluation to exclude `blob:` and other non-standard links from `sampleUuidLinks`.
    - **Navigation Resilience**: Updated row-click and action button navigation checks to ignore URL changes that result in non-http/https schemes (e.g., direct blob downloads).
- **Status**: Completed and verified via code review.

### [2025-12-29] Phase 10: Page/Sidebar Exclusions & Debug Cleanup
- **[MODIFIED] [scraper.ts](file:///Users/doongle/auto_test_form/testMaker/src/scraper.ts)**:
    - **Page Exclusion**: Updated `processLinks` to skip any path starting with `/app/support`.
    - **Sidebar Exclusion**: Updated sidebar discovery to skip buttons with text "Miscellaneous" or "Support".
    - **Debug Log Cleanup**: Hardened raw link debug extraction to explicitly exclude non-http/https schemes from all counts and samples.
- **Status**: Completed and verified via code review.

### [2025-12-29] Phase 11: Link Discovery Fix & Comprehensive Exclusions
- **[MODIFIED] [scraper.ts](file:///Users/doongle/auto_test_form/testMaker/src/scraper.ts)**:
    - **Relative Link Fix**: Fixed `processLinks` to correctly resolve relative URLs before filtering. Previously, it was incorrectly excluding any link not starting with `http`.
    - **Hardened Protocol Filtering**: Improved protocol detection to reliably exclude `blob:`, `mailto:`, and `tel:` URLs from discovery and debug logs.
    - **Advanced Page Exclusion**: Implemented a keyword-based path filter (`/app/support`, `miscellaneous`, `feedback`, `help`) in `processLinks` to skip unwanted sections.
    - **Sidebar Robustness**: Improved sidebar button discovery and exclusion to ensure "Miscellaneous" and "Support" items are skipped.
- **Status**: Completed and verified via code review.
+
