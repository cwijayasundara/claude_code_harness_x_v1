---
description: Review recurring delivery failures and propose a minimal guide, pattern, fixture, sensor, ADR, or removal change to improve the harness.
disable-model-invocation: true
---

# Harness retrospective

Review source-grounded evidence, branch reviews, test failures, escaped defects,
and repeated implementation corrections. Prefer **subtraction** when a control
adds noise without correction value.

## 1. Pull automated nominations (read-only)

```sh
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-subtract.js" --write --root .
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-m7-scorecard.js" --root .
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-pilot.js" report --root .
```

Read:
- `.claude/specs/evidence/control-subtraction-proposals.json`
- `.claude/specs/evidence/m7-scorecard.json`
- `.claude/specs/evidence/pilot-readiness.json` (if present)

## 2. Draft a human-gated proposal

Draft one `amendments` JSON artifact with
`content.artifact_type: harness-improvement-proposal`, link its source and
evidence IDs, and register it with `harness-specs.js register`. Do not approve or
apply it automatically.

For each proposal, include:

- repeated failure and evidence;
- likely upstream cause;
- smallest proposed change (**retire / demote / replace** before net-add);
- alternatives considered;
- cost/cadence and expected benefit;
- owner and review date; and
- what existing control it replaces, simplifies, or why a net addition is justified
  (`net_add_justification` + control_budget headroom).

Do not automatically change harness policy, add hooks, or add sensors. Ask for
human approval first. Rollout remains **human-only** even when pilot status is
`eligible-for-human-rollout-decision`.
