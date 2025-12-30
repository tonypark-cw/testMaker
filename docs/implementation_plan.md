# Implementation Plan - Fix Filename Generation & Restore Discovery Power

We are addressing two critical issues:
1.  **Filename Overwriting**: Multiple pages (e.g., `/app/lot/1`, `/app/lot/2`) generate the same output filename, causing data loss.
2.  **Poor Discovery**: The scraper only finds 2 pages. This is likely due to:
    -   Potential conflict between "Menu Expansion" and "Sidebar Discovery" phases toggling (expand -> collapse) menus.
    -   Login failure or limited link detection on the initial page.

## User Review Required
> [!IMPORTANT]
> I will modify `scripts/generator.ts` to include a content hash in the filename, distinct from the simple path-based naming. This ensures every unique URL gets a unique output file.
> I will also modify `src/scraper.ts` to share "Visited" state between Menu Expansion and Sidebar Discovery to prevent counter-productive toggling.

## Proposed Changes

### Fix Filename Generation

#### [MODIFY] [generator.ts](file:///Users/doongle/auto_test_form/testMaker-fix2/scripts/generator.ts)
-   Update `generateMarkdown`, `generatePlaywright`, and `generateJson` methods.
-   Generate a unique hash from `result.url` (MD5 of full URL including query params).
-   Append this hash to the filename (e.g., `test-cases-app-lot-a1b2c3.md`) to prevent collisions.

### Restore Discovery Power

#### [MODIFY] [scraper.ts](file:///Users/doongle/auto_test_form/testMaker-fix2/src/scraper.ts)
-   **Consolidate Visited Sets**: prevent Phase 5 (Sidebar) from clicking buttons already clicked by Phase 4 (Expansion) by checking `visitedExpansionButtons` in Phase 5 or sharing a single set.
-   **Enhance Login Detection**: Add a fallback check for login fields. If "Reset Password" is found, distinctively check if we are on a login page and log it clearly.
-   **Verify Navigation**: Ensure that if sidebar buttons *do* navigate, we capture it.
-   **Explicit Link Re-scan**: If sidebar interaction doesn't navigate, strictly logging if it revealed new content.

## Verification Plan

### Automated Tests
1.  **Run Analysis**: `npm run analyze -- --url "https://stage.ianai.co" --depth 2 --limit 5`
2.  **Verify Output Files**: Check `./output/markdown/...` and `./output/json/...` to ensure multiple files exist and have unique hashes.
3.  **Verify Discovery**: Check logs to see if more than 2 pages are analyzed and if "Sidebar links" count > 0.

### Manual Verification
-   Inspect the generated Markdown files to ensure they correspond to different pages.
