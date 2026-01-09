# 🧪 TestMaker (v2.0.0)

**TestMaker** is an advanced **Automated Test Analysis & Generation Tool** designed for IanAI. It autonomously navigates the web application, discovers testable scenarios, captures visual evidence, and generates ready-to-use Playwright test specifications.

> **Key Upgrade (v2.0)**: Now powered by a **Multi-Tab Parallel Engine** that runs 3x faster by utilizing multiple browser tabs within a single login session.

---

## 🌟 Key Features

### 1. ⚡️ Multi-Tab Parallelism (New!)
- **Speed**: Utilizes `Worker Pool` architecture to process multiple URLs concurrently using a single browser instance.
- **Single Session**: Shares authentication state (Cookies/LocalStorage) across all tabs, eliminating repetitive login overhead.
- **Concurrency Control**:Configurable number of workers (Default: 3 tabs).

### 2. 🛡️ Intelligent Scraper
- **Fast-Fail Strategy**: Instantly aborts analysis on unresponsive rows (< 0.6s) to maximize throughput.
- **Deep Discovery**: Capable of navigating nested sidebars, expansion menus, and data tables.
- **Robustness**: Automatically handles modals, popups, and client-side routing race conditions.

### 3. 📊 Live Dashboard V2
- **Real-Time Monitoring**: Watch the scraper working in real-time.
- **Infinite Gallery**: Browse thousands of captured screenshots with high-performance infinite scroll.
- **Lightbox Mode**: Detailed inspection of screenshots with keyboard navigation.
- **QA Tagging**: Mark pages as `PASS`, `FAIL`, or `BLOCK` directly from the UI. Tags are persisted to `output/qa-tags.json`.

### 4. � Auto-Generation
- **Test Specs**: Generates `playwright.spec.ts` files automatically based on discovered elements.
- **Documentation**: Creates Markdown reports summarizing test coverage and scenarios.

---

## �🚀 Quick Start

### 1️⃣ Dashboard (Real-time Monitoring)
Runs the web dashboard to view live results, run analysis, and tag QA issues.
```bash
npm run dashboard
# Access at: http://localhost:3000
```

### 2️⃣ Runner (Multi-Tab Scraper)
Runs the headless browser scraper in parallel tabs.
```bash
# Basic run
npm run analyze

# Custom run (recommended)
npm run analyze -- --url https://stage.ianai.co/ --depth 5 --limit 200 --concurrency 3
```

### 3️⃣ Serveo (Public Tunnel)
Expose your local dashboard to the team.
```bash
# Run in a separate terminal
ssh -R ianai-test:80:localhost:3000 serveo.net
# Public URL: https://ianai-test.serveo.net
```
*Note: Ensure `npm run dashboard` is running first.*

---

## � Project Structure

- **`src/core`**: The brain of the operation.
    - `scraper.ts`: Stateless page processor (extracts links, elements, screenshots).
    - `runner.ts`: Manager for Job Queue and Worker Pool.
    - `cli.ts`: Command-line entry point.
- **`src/dashboard`**: The eyes of the operation.
    - `server.ts`: Node.js HTTP server (API + Static Assets).
    - `index.html`: Modern Dashboard UI.
- **`src/scripts`**: Helper utilities.
    - `analyzer.ts`: Heuristics to identify test scenarios.
    - `generator.ts`: Template engine for Report/Spec generation.
- **`output`**: Artifacts.
    - `screenshots/`: Organized by domain.
    - `markdown/`: Generated test reports.
    - `playwright/`: Generated test code.
