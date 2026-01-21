# Git Commit Message Convention

To maintain a clean and readable project history, we follow a simple commit message convention. This helps team members quickly understand the context and purpose of changes.

## Format

```text
[Keyword] Description of changes
```

- **Prefix**: Start with a keyword enclosed in square brackets `[]`. This highlights the type of change at a glance.
- **Description**: Follow with a concise summary of what was changed or reflected.

## Guidelines

1.  **Use Square Brackets `[]`**: Always wrap the primary keyword in brackets.
    - Example: `[Update]`, `[Fix]`, `[Refactor]`, `[Add]`
2.  **Descriptive Message**: Briefly explain *what* changed and *why* (if necessary).
3.  **Keywords**:
    - We do not strictly enforce a specific list of keywords at this stage. You may use terms that best describe the action.
    - Common examples might include:
        - `[Init]` : Initial Commit
        - `[Create]`: New features
        - `[Fix]`: Bug fixes
        - `[Update]`: General updates, often for dependencies, configurations, or content syncing
        - `[Modify]`: Modifications to existing code logic or behavior
        - `[Refactor]`: Code restructuring without behavior change
        - `[Docs]`: Documentation changes
        - `[Test]`: Test-related changes
        - `[Chore]`: Maintenance tasks (build, configs, etc.)

## Examples

- `[Update] playwright config timeout and refine inventory verification logic`
- `[Fix] resolve timeout issue in cleanup script`
- `[Add] new sorting test cases to docs`
- `[Refactor] extract menu navigation to helper function`
