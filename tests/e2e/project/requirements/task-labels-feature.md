# Follow-up feature: task labels

Add optional labels to tasks so a developer can group work.

## Acceptance criteria

- `addTask` accepts an optional array of label strings.
- Labels are trimmed, blank labels are rejected, and duplicates are removed while preserving order.
- Existing callers that add only a title behave exactly as before.
- Listed tasks cannot be used to mutate the board's stored labels.

Keep this dependency-free and reuse the task model and validation seams delivered by the first change.
