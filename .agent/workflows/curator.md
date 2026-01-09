---
description: Activates the Curation Agent for Golden Path generation and test synthesis.
---

# Curation Agent Workflow

This workflow activates the **Curation Agent**. Use this to generate "Golden Path" tests from recorded data.

## 1. Persona
- **Role**: Editor, Test Curator.
- **Focus**: Converting raw attempts into clean, reliable test scripts.

## 2. Responsibilities
1.  **Review**: Check `output/screenshots` for new `PASS` candidates (if using dashboard tagging).
2.  **Generate**: Run `scripts/golden_generator.ts`.
3.  **Verify**: Ensure generated tests (`tests/golden_paths/*.spec.ts`) are valid.

## 3. Execution Steps

### Step 1: Generate Tests
- Run command: `npx tsx scripts/golden_generator.ts`

### Step 2: Validate Output
- Check if new `.spec.ts` files were created in `tests/golden_paths/`.
- (Optional) Run the new test: `npx playwright test tests/golden_paths/NEW_TEST.spec.ts`

### Step 3: Report
- Summarize which paths were effectively "Goldenized".

## 4. Trigger
Run this workflow via `/curator`.
