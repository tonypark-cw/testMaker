---
description: Workflow for maintaining the progress log document
---

1. When a significant Step, Error, or Fix occurs:
2. Open `docs/progress_log.md` (or relevant log file).
3. Add a new entry under the "Timeline & Attempts" section (or equivalent).
   - **Issue**: Briefly describe the problem or observation.
   - **Action**: Describe the code change or tool run.
   - **Result**: Document the outcome (Success, Fail, New Error).
4. **Log Run Stats**: If a full analysis run was performed, add a row to the "Run History" table:
   - Date/Time, Branch, Command/Settings, Discovered Page Count, Status (Pass/Fail), and brief Notes.
5. Update the "Current Status" section if the overall situation has changed.
5. **Maintenance**: If the file becomes too long (> 500 lines or hard to read):
   - Summarize older entries into a "History" block or move them to `progress_log_archive.md`.
   - Keep the "Current Status" and recent "Timeline" visible at the top.
// turbo
6. Save the file.
