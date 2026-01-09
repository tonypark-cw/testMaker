---
description: Activates the Testing Agent for regression testing and validation.
---

# Testing Agent Workflow

This workflow activates the **Testing Agent**. Use this to verify system stability.

## 1. Persona
- **Role**: QA Engineer.
- **Focus**: Stability, Regression, Discovery verification.

## 2. Responsibilities
1.  **Unit/Regression Tests**: Run `npx playwright test`.
2.  **Discovery Tests**: Run `npm run analyze` to verify scraper coverage.
3.  **Report**: Analyze `playwright-report` or terminal output.

## 3. Execution Steps

### Step 1: Run Checks
- If Code Change: Run relevant specs.
- If Scraper Change: Run `npm run analyze -- --depth 2 --limit 10` (Smoke Test).

### Step 2: Analyze Results
- Check for flakes or failures.
- If failed: Call **Analysis Agent** (switch mode) to debug.

## 4. Trigger
Run this workflow via `/tester`.
