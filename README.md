# 🧪 TestMaker (v2.1.0) - Agentic Regression Edition

**TestMaker** is an advanced **Automated Test Analysis & Generation Tool** designed for IanAI. It autonomously navigates the web application, discovers testable scenarios, captures visual evidence, and—most recently—synthesizes robust **Golden Path** regression suites.

> **Key Upgrade (v2.1)**: Integrated the **Curator Agent** workflow for synthesizing high-stability "Golden Path" tests from successful user flows, featuring resilient multi-layer authentication and modal-aware verification.

---

## 🌟 Key Features

### 1. 🥇 Golden Path Synthesis (New!)
- **Curated Flows**: Automatically extracts successful navigation paths into stable Playwright test files (`tests/golden_paths/main_flow.spec.ts`).
- **Resilient Auth**: Handles complex staging environments using combined **Basic Auth URL injection** and **Form-based auto-login**.
- **Hydration Awareness**: Implements deterministic waits for SPA hydration and "Dashboard Ready" states.
- **History Tracking**: Maintain a detailed record of test evolution in `docs/GOLDEN_PATH_HISTORY.md`.

### 2. ⚡️ Agentic Architecture
- **Curator Agent**: Orchestrates the synthesis of regression suites and selector refinement.
- **Tester Agent**: Validates generated tests in headless/background environments.
- **Secretary Agent**: Manages documentation, progress logs, and automated Git operations.
- **Skill System**: Powered by specialized skills like `clickSafe`, `waitForResponseSafe`, and `drawerVerification`.

### 3. �️ Intelligent Scraper
- **Multi-Tab Parallelism**: Utilizes a `Worker Pool` to process multiple URLs concurrently within a single login session.
- **Deep Discovery**: Navigates nested sidebars, expansion menus, and complex data tables (Mantine UI optimized).
- **Fast-Fail Logic**: Aborts unresponsive actions quickly to maximize throughput.

### 4. 📊 Live Dashboard V2
- **QA Tagging**: Mark pages as `PASS`, `FAIL`, or `BLOCK` directly from the UI.
- **Infinite Gallery**: High-performance exploration of thousands of screenshots.
- **Real-Time Monitoring**: Watch the agent discovery process as it happens.

---

## 🚀 Quick Start

### 1️⃣ Synthesis & Regression
Run the synthesized Golden Path tests to verify application stability.
```bash
npx playwright test tests/golden_paths/main_flow.spec.ts --project=chromium
```

### 2️⃣ Dashboard & QA Tool
Run the web dashboard to view live results, run analysis, and tag QA issues.
```bash
npm run dashboard
# Access at: http://localhost:3000
```

### 3️⃣ Discovery Runner
Runs the headless browser scraper to discover new pages and scenarios.
```bash
npm run analyze -- --url https://stage.ianai.co/ --depth 5 --limit 200 --concurrency 3
```

---

## 📂 Project Structure

- **`src/core`**: The engine (Scraper, Runner, CLI logic).
- **`src/dashboard`**: The UI (Server, Frontend dashboard).
- **`tests/golden_paths`**: Permanent high-stability regression suites.
- **`docs/`**: Project governance (Agent Architecture, Implementation Plans, Golden Path History).
- **`output/`**: Transient artifacts (Screenshots, raw JSON data, generated reports).

---

## 🛠️ Project Direction
The current mission of the `fix` branch is to transform raw discovery data into **Bulletproof Regression Assets**. We are moving away from simple "page scraping" towards **Intelligent Flow Synthesis**, where the tool understands the semantic relationship between pages (e.g., List → Drawer → Sub-tab) and generates tests that mimic expert user behavior with high deterministic stability.
