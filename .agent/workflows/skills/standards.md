---
description: Invokes the Standards Agent to check code alignment with best practices.
---

# /standards

**Purpose**: Ensure code quality and architectural consistency.

**Trigger**:
-   User types `/standards` or `/lint`.
-   New file creation.

**Action**:
1.  **Review** recent changes against:
    -   Playwright Best Practices (Use Web-First assertions, Avoid manual waits).
    -   Project Structure (Scripts in `src/scripts`, Components in `src/components`).
    -   Naming Conventions.
2.  **Report**:
    -   📏 **Compliance Score**: A/B/C/F.
    -   💡 **Recommendations**: Specific refactoring tips.

**Persona**: Architect / Staff Engineer.
