# Golden Path Synthesis History

This document tracks the iterative development and refinement of the `ianaiERP` Golden Path regression suite.

## Initial Objective
Create a stable, deterministic "Golden Path" test (`main_flow.spec.ts`) that verifies:
1. **Authentication**: Successful entry through Basic Auth and Form-based login.
2. **Dashboard Navigation**: Verification of the Home page landing.
3. **Reports**: Navigation through Sales Overview and tab switching.
4. **Item Drawer**: Opening and verifying the detail modal (drawer) from the item list.
5. **Settings**: Navigation to the configuration area.

---

## Iteration Cycle

### Cycle 1: The Foundation
- **Goal**: Establish the basic navigation script.
- **Problem**: Staging environment protected by Basic Auth; Playwright's default `page.goto` fails without credentials.
- **Fix**: Incorporated Basic Auth credentials (`ianai:vofflsemfha12321`) into the URL.
- **Result**: Successfully reached the login form but failed because session state wasn't being maintained across navigations.

### Cycle 2: Authentication Stability
- **Goal**: Handle the dual-auth layer (Basic + Form).
- **Problem**: Headless execution often missed the "Login" form rendering timing, or raced against the dashboard if already logged in.
- **Fix**: Implemented `Promise.race` to detect either the login form (marker: email input) or the dashboard (marker: "Custom Layout" button).
- **Result**: Improved detection but hit "Strict Mode" violations where multiple "Custom Layout" buttons were found in the DOM.

### Cycle 3: Selector Refinement & Session Loss
- **Goal**: Resolve locator ambiguity and session persistence.
- **Problem**: Sub-page navigation (`page.goto('/app/item')`) caused a redirect back to login because the Basic Auth session was lost in headless mode.
- **Fix**: 
    - Used `.first()` for locators to settle strict mode errors.
    - Switched to using `AUTH_URL` for every `page.goto` call to ensure the session header is always provided.
- **Result**: Solved the session loss, but the login form submission via `keyboard.press('Enter')` proved flaky in the background.

### Cycle 4: Deterministic Redirection (Ongoing)
- **Goal**: Ensure the test waits for a fully settled UI before proceeding.
- **Problem**: After login, the script often moved to navigation before the SPA had finished hydration, leading to "Element not found" errors on reports/items.
- **Fix**: 
    - Replaced keyboard submission with an explicit `loginBtn.click()`.
    - Added mandatory `waitForURL` and a check for confirmed dashboard text ("Welcome") after login.
    - Increased timeouts to 45s-60s for loading-heavy pages.
- **Current Status**: Refinement of the "Login State" detection to be even more resilient to different DOM states (e.g., detecting if the email field is truly interactive before filling).

---

## Key Learnings
- **Headless Contexts**: Standard browser behaviors (like Enter-to-submit) can be less reliable than explicit clicks.
- **SPA Hydration**: Waiting for URL change is not enough; one must wait for a "Dashboard Ready" marker.
- **Session Persistence**: In staging environments with Basic Auth, using the `user:pass@domain` format for *every* navigation is more robust than relying on browser-level cookie persistence in transient contexts.
