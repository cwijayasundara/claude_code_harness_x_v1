# Project delivery guide

This repository uses the Lean Expert-Generalist Harness. This file is the
entry-point map, not the full operating manual. Keep durable project knowledge
versioned under `.claude/` and load only what the current task needs.

## Start every delivery task

1. Read `.claude/harness.yaml` to identify active technology profiles, the
   selected domain pack, review policy, and artifact root.
2. Run the plugin's `harness-validate.js` before loading project context.
3. Read `.claude/project/architecture.md` and
   `.claude/project/reference-patterns.md`; then load only the profile, domain,
   code, and test material relevant to the requested change.

## Where to look next

| Need | Source of truth |
| --- | --- |
| Architecture, seams, and dependency direction | `.claude/project/architecture.md` and `.claude/project/boundaries.yaml` |
| Canonical local implementations to extend | `.claude/project/reference-patterns.md` |
| Path-scoped language/framework guidance | Run the plugin profile resolver, then read only its returned `.claude/profiles/<profile>/guide.md` paths |
| Business vocabulary, invariants, policies, and fixtures | `.claude/domains/<selected-domain-pack>/` |
| Source-grounded requirements, stories, design, tests, approvals, and evidence | `.claude/specs/index.json` and the relevant `.claude/specs/<package>/` |
| Active story state and next ratchet transition | `.claude/state/stories/` (read-only; advance with the plugin) |
| Harness configuration | `.claude/harness.yaml` |
| Model routing, context budgets, promotion evidence, and observed spend | `.claude/routing.json` and `.claude/specs/evidence/model-usage.jsonl` |

## Delivery rules

- Scope first: identify the smallest affected paths, public seam, canonical
  pattern, relevant rules, and tests. Do not scan the whole repository unless
  the task requires it.
- For behavior changes, add one focused failing test, implement the smallest
  passing change, and keep checks green while refactoring.
- Use fresh deterministic evidence before claiming completion. Escalate domain,
  security, privacy, lifecycle, or material architecture decisions to a human.
- When a sensor watch session is active, use `harness-status.js . --agent`
  after a batch of edits to read only actionable feedback and its correction path.
- Never implement before the applicable G0-G4 human gates in
  `.claude/specs/index.json` are approved. Approved specifications are amended
  or superseded, never silently rewritten. Keep this guide short; put
  project-specific detail in its linked source of truth.
