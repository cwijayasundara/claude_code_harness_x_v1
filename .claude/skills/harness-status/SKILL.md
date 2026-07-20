---
description: Summarize the active harness artifacts, configured profiles, recent evidence, and blockers for the current project.
disable-model-invocation: true
---

# Harness status

Run `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-status.js" .` from the target project. It leads with the active change, outcome, route, mode, checkpoint progress, human action, and recomputed next action. Use `--full` only when the user requests operational detail. Use its output as the factual baseline and do not infer success without evidence.
