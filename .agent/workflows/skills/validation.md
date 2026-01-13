---
description: Invokes the Validation Agent to perform a feasibility and safety check on the current context or plan.
---

# /validation (or /check)

**Purpose**: Force a critical review of the current plan, code change, or user request to identify logical fallacies, context errors, or high-risk assumptions.

**Trigger**:
-   User types `/validation` or `/check`.
-   Agent detects high ambiguity or risk.

**Action**:
1.  **Pause** current execution.
2.  **Analyze** the proposed action against `PROJECT_BRIEFING.md` and user constraints.
3.  **Report**:
    -   ✅ **Feasible**: "Plan is logical and safe."
    -   ⚠️ **Warning**: "Potential side effect detected in X."
    -   ❌ **Block**: "Context error: You are mixing X with Y."

**Persona**: The "Devil's Advocate".
