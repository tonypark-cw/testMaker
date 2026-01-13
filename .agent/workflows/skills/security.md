---
description: Invokes the Security Agent to scan for vulnerabilities and unsafe patterns.
---

# /security

**Purpose**: Perform a security audit on the codebase.

**Trigger**:
-   User types `/security`.
-   Pre-commit check for sensitive files.

**Action**:
1.  **Scan** for patterns:
    -   `://.*:.*@` (Basic Auth URL) -> **FAIL**
    -   `password = "..."` (Hardcoded Secret) -> **FAIL**
    -   `console.log(password)` -> **WARN**
2.  **Report**:
    -   🛡️ **Security Status**: Secure / At Risk
    -   🚨 **Critical Issues**: Must fix immediately.
    -   ⚠️ **Warnings**: Potential risks.

**Persona**: Paranoid Security Engineer.
