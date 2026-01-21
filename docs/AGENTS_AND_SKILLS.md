# AI Agents & Skills System

This document defines the **AI Agentic Architecture** used in this project. All AI sessions must refer to this document to understand their role, available tools (Skills), and the chain of command (Authority).

---

## 1. Concepts

### 🤖 Sub-Agents (Agents)
**Sub-Agents** are specialized AI personas defined in `.agent/workflows/agents/`.
- They differ from simple prompts; they have **specific roles, responsibilities, and Authority Levels**.
- They are orchestrated by the **Auto-Delegate** agent or invoked directly by the user.

**Location**: `.agent/workflows/agents/*.md`

### 🛠️ Skills
**Skills** are reusable capabilities or standard procedures defined in `.agent/workflows/skills/`.
- They are "tools" that agents can execute to perform complex tasks (e.g., performing a rigorous code review, running a security scan).
- Agents "possess" skills; skills do not act on their own.

**Location**: `.agent/workflows/skills/*.md`

---

## 2. Authority System (Chain of Command)

To ensure stability and security, Agents operate under a strict **Authority Hierarchy**. Conflicts are resolved by the highest-ranking agent.

| Authority Level | Score | Agents | Description |
| :--- | :--- | :--- | :--- |
| **CRITICAL** | 30 | `security` | **Absolute Veto Power**. Can stop any process if a violation is detected. Must be obeyed immediately. |
| **HIGH** | 20 | `planning`, `testing`, `qa-specialist` | **Gatekeepers**. Implementation cannot proceed without their explicit approval (PASS). |
| **NORMAL** | 10 | `implementation`, `analysis` | **Executors**. Perform the actual work according to plans and constraints. |
| **LOW** | 0 | `worker` | **Generalists**. Handle routine tasks, file finding, and simple fixes. |

---

## 3. Workflow & Gates

### Blocking Logic
1.  **Security Block**: If `security` detects a vulnerability, ALL work stops. No code is committed.
2.  **QA Gate**: `testing` and `qa-specialist` must provide a formatted Validation Report.
    - **Required Fields**: Scope, Purpose, Function, Success Status.
    - **Rule**: If Status != PASS, `implementation` agent cannot merge or consider the task complete.

### Delegation Flow
```mermaid
graph TD
    User[User Request] --> Router[Auto-Delegate Agent]
    Router -->|Analyze| Analyzer[Analysis Agent]
    Router -->|Plan| Planner[Planning Agent]
    
    Planner -->|Spec| Impl[Implementation Agent]
    Planner -->|Spec| Tester[Testing Agent]
    
    Impl -->|Code| Review[Review Skill]
    Review -->|Feedback| Impl
    
    Impl -->|Ready| QA[QA Gate (Testing/Specialist)]
    QA -->|PASS| Merge[Git Push]
    QA -->|FAIL| Impl
    
    Security[Security Agent] -.->|Monitor| Impl
    Security -.->|Block| Merge
```
