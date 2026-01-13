---
description: Standard workflow for pushing changes to git
---

1. Check git status to identify changes
2. Read the `COMMIT_MESSAGE_CONVENTION.md` file in the project root (or parent directory)
3. Formulate a commit message following the format: `[Keyword] Description`
   - Common keywords: [Fix], [Update], [Add], [Refactor], [Docs]
4. Stage changes: `git add .` (or specific files)
 // turbo
5. Commit changes: `git commit -m "[Keyword] Your message"`
6. Push to remote: `git push origin <branch_name>`
