---
description: Summarize the active harness artifacts, configured profiles, recent evidence, and blockers for the current project.
disable-model-invocation: true
---

# Harness status

Run `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-status.js" .` from the target project. Use its output as the factual baseline, then return a compact status with: current request/story, route, latest evidence status, unresolved decisions, and the next concrete action. Do not infer success without evidence.
