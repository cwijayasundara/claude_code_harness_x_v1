---
description: Operate, assess, or maintain an installed lean expert-generalist harness without treating the underlying JavaScript utilities as the user-facing workflow.
disable-model-invocation: true
---

# Harness operations

The user request is:

```text
$ARGUMENTS
```

Use this skill for harness setup, health checks, specification/evidence maintenance,
sensor execution, upgrades, release checks, waivers, or readiness
assessment. Work in the target project unless the request explicitly names the
plugin repository.

First identify the smallest requested operation and use the deterministic helper
below. State the command you ran and report its factual output; do not infer a
passing result.

| User intent | Deterministic helper |
| --- | --- |
| Initialise or validate a target | `harness-init.js`, then `harness-validate.js` |
| Diagnose environment readiness | `harness-doctor.js` |
| Intake/register/approve/validate grounded specifications | `harness-specs.js` |
| Configure opt-in tracker MCP servers | `harness-tracker-mcp.js` |
| Build a bounded brownfield map or inspect domain status | `harness-brownfield.js` or `harness-domain-status.js` |
| Resolve path-scoped profiles or model/context routing | `harness-profile-context.js` or `harness-routing.js` |
| Inspect or advance story state | `harness-ratchet.js` |
| Run/finalize pre-PR verification | `harness-verify.js` |
| Run or watch profile sensors, inspect agent status, or run CI | `harness-sensors.js`, `harness-sensor-watch.js`, `harness-status.js`, or `harness-ci.js` |
| Run risk-triggered independent modularity review | Invoke `harness-modularity-review` (it prepares, independently evaluates, and merges evidence) |
| Preview/apply an additive upgrade (missing files + merge new baseline controls such as file-size / near-duplication; never overwrites existing policy files) | `harness-upgrade.js [--target .] [--apply]` |
| Run matched canaries or the release gate | `harness-p7-canary.js` or `harness-release-check.js` |
| Record learning evidence or operate a human-approved harness experiment | `harness-improvement.js` |
| Create an explicitly approved sensor waiver | `harness-waiver.js` |
| Inspect flakiness/SLOs, compact retained history, attest evidence, or record production feedback | `harness-operations-evidence.js` |
| Inspect or explicitly install managed pre-commit/pre-push gates | `harness-git-hooks.js status|install` |

Run plugin helpers using `node "$CLAUDE_PLUGIN_ROOT/scripts/<helper>.js"`.
For a target-local release check, use `node .claude/scripts/harness-release-check.js`.
Preserve each helper's safety contract: inspect before an `--apply` operation
and never invent approval details for a waiver, gate, route promotion, or model
receipt.

If the request is a product change rather than an operational task, invoke the
`harness` skill instead. If it is a retrospective, invoke `harness-retro`.
