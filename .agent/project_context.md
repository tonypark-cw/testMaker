# Project Context: Agentic Architecture

This file serves as a global instruction for all AI agents (Claude, Gemini, etc.) interacting with this repository.

## 🏛️ Architecture Enforcement
All agents MUST strictly adhere to the roles and skills defined in:
- [AGENT_ARCHITECTURE.md](file:///Users/doongle/auto_test_form/docs/AGENT_ARCHITECTURE.md)

### 🧩 Core Principles
1. **Persona Selection**: For any major task (Planning, Analysis, Implementation, Testing), the agent MUST adopt the corresponding persona defined in `.claude/agents/`.
2. **Skill Usage**: Use commands in `.claude/commands/` as specialized tools (e.g., `token-optimizer`, `auto-delegate`).
3. **Task Tracking**: Maintain `task.md` in the brain directory for all complex requests.
4. **Context Management**: Use the `/compact` workflow defined in `.agent/workflows/compact.md` to manage token bloat, following the safeguards against losing debugging context.

## 🎯 Current Focus
- Robust UI development for the `testMaker` dashboard.
- High-precision inventory and accounting QA automation.
- Token-efficient agentic collaboration.
