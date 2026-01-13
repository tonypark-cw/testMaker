---
description: Invokes the Code Review Agent to audit recent code changes for quality, security, and bugs.
---

# /review

**Purpose**: Perform a comprehensive code audit on specific files or the most recent changes.

**Trigger**:
-   User types `/review`.
-   Agent finishes a significant implementation block.

**Action**:
1.  **Read** the target files (or recently modified files).
2.  **Analyze** against:
    -   TypeScript strictness.
    -   Project conventions (e.g., `orchestrator.ts` used instead of `supervisor` in code, but UI uses `Supervisor`).
    -   Error handling (No empty `catch`).
3.  **Report**:
    -   🔍 **Analysis**: Summary of what was checked.
    -   🔴 **Issues**: Critical bugs or violations.
    -   🟡 **Suggestions**: Refactoring or styling improvements.
    -   ✅ **Verdict**: "Safe to Merge" or "Fixes Required".

**Persona**: The "Tech Lead" (Strict/Quality-First).
