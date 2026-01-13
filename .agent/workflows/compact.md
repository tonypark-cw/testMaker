---
description: Compacting the conversation context to save tokens and maintain focus.
---

# Compact Workflow

This workflow is designed to "compact" the current session by summarizing key context, decisions, and pending tasks into a persistent file, allowing you to safely clear the context window or start a new session without losing continuity.

## Trigger Points (Deliberate Only)
- **Task Completion**: When a major feature or bug fix is fully verified.
- **Context Switch**: Before moving to a completely different topic (e.g., from Frontend to Backend).
- **Session Bridge**: When you are about to stop working and want to pick up later in a fresh session.

> [!WARNING]
> **DO NOT** run `/compact` during active debugging or in "Execution Mode". Detailed error logs, stack traces, and transient variable states are lost during summarization.

## Steps

1.  **Analyze Current State & Safeguard Context**
    - **Active Debugging Check**: If in "Execution Mode", ask: "Do I have persistent logs of the current errors?"
    - **Snapshot Creation**: If critical technical details exist, save them to `docs/debug_snapshots/session_[id].log` before compacting.
    - Identify current active task and status.
    - List any critical decisions made during this session.
    - Identify any open questions or blocked items.
    - List modified files that are relevant to the **next** steps.

2.  **Update Artifacts**
    - Update `progress_log.md` (or equivalent) with completed items.
    - Update `task.md` to reflect the current checklist status.

3.  **Generate Session Summary**
    - Create a concise summary block in the chat or append to a `docs/session_notes.md` (create if needed).
    - Format:
        ```markdown
        ## Session Summary [YYYY-MM-DD]
        - **Completed**: [Brief list of what was done]
        - **Decisions**: [Key technical decisions]
        - **Next Steps**: [Immediate next actions]
        - **Context**: [Critical file paths or variable states to remember]
        ```

4.  **Notify User**
    - Inform the user that the session is compacted.
    - Recommend: "Context saved. You can now start a new chat or run `/clear` if supported."
