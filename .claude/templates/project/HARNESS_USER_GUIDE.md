# Using the harness in {{PROJECT_NAME}}

This guide is for people delivering changes in **{{PROJECT_NAME}}** with the
Lean Expert-Generalist Harness. It was generated for this repository and is
safe to edit. Re-running initialization or an upgrade will not overwrite it.

## Detected repository context

{{STACK_SIGNALS}}

Detection is only a starting point. Confirm the active profiles in
`.claude/harness.yaml`; remove profiles this repository does not use and enable
only profiles supported by the codebase.

## One-time setup

1. Edit `.claude/harness.yaml` to select the technology profiles and optional
   domain pack used here.
2. Replace the placeholders in `.claude/project/architecture.md` and
   `.claude/project/reference-patterns.md` with this repository's real
   boundaries, seams, and canonical examples.
3. Configure every required command in `.claude/verification.json`. A required
   check left unconfigured blocks pre-PR readiness by design.
4. Run the plugin validator and environment doctor from this repository:

   ```sh
   node "$CLAUDE_PLUGIN_ROOT/scripts/harness-validate.js" .
   node "$CLAUDE_PLUGIN_ROOT/scripts/harness-doctor.js" .
   ```

5. Commit the scaffold and repository-specific configuration so every user and
   agent receives the same guides and controls.

## Deliver a change

1. Create or switch to a feature branch. The harness refuses specification and
   implementation writes on `main`, `master`, and `develop`.
2. Start from the artifact you actually have: idea, PRD, BRD, feature, epic,
   story, issue, design, tests, or existing diff. Put PRD/BRD authority and any
   reusable request in a durable local file such as `requirements/change-name.md`.
3. Start Claude Code with the plugin enabled:

   ```sh
   claude
   ```

4. Start delivery in Claude Code:

   ```text
   /lean-expert-generalist-harness:harness "Deliver requirements/change-name.md"
   /lean-expert-generalist-harness:harness "Implement requirements/US-142.md"
   /lean-expert-generalist-harness:harness "Add invoice export"
   /lean-expert-generalist-harness:harness "Continue"
   ```

   The harness infers the entry kind, stopping point, repository posture,
   delivery lane, and interaction mode. Use `guided`, `checkpoint` (default),
   or `unattended`; unattended execution requires an already approved contract.

5. Review each proposed product or solution decision before approving it. The
   evidence remains recorded through these internal gates:

   - G0 confirms the source and intended outcome.
   - G1 confirms epics, stories, estimates, dependencies, and delivery order.
   - G2 confirms the test strategy, cases, and data.
   - G3 confirms architecture, design alternatives, and performance budgets.
   - G4 confirms executable story contracts and traceability.

6. Let the harness execute one approved story at a time through failing test,
   implementation, independent review, deterministic sensors, and verification.
   A material product, security, privacy, domain, or architecture decision
   returns to a human.
7. Inspect progress at any time:

   ```text
   /lean-expert-generalist-harness:harness-status
   ```

8. When all stories and branch checks pass, review the draft-PR readiness
   evidence under `.claude/specs/evidence/`. Merge and deployment remain human
   decisions.

## Existing repositories

For a brownfield change, scope the request to the smallest owning package or
subsystem. The harness adds B0 baseline health, B1 a provenance-labelled code
map, and B2 a reuse-first change strategy before the normal G1-G4 flow. Verify
the cited implementation and tests; do not treat a generated map as complete.

## Everyday commands

| Need | Command |
| --- | --- |
| Validate configuration | `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-validate.js" .` |
| Diagnose prerequisites | `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-doctor.js" .` |
| Resolve task guides | `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-guides.js" --root . --path <path>` |
| Run sensors | `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-sensors.js" .` |
| Watch sensors during edits | `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-sensor-watch.js" .` |
| Inspect concise agent status | `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-status.js" . --agent` |
| Preview an upgrade | `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-upgrade.js" --target .` |
| Apply an additive upgrade | `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-upgrade.js" --target . --apply` |
| Review recurring failures | `/lean-expert-generalist-harness:harness-retro` |

## Where information lives

- `CLAUDE.md`: short agent navigation map.
- `HARNESS_USER_GUIDE.md`: this repository's human operating guide.
- `.claude/harness.yaml`: active profiles, domain pack, and review policy.
- `.claude/guides.json`: feedforward guide and tool-capability catalog.
- `.claude/project/`: architecture, reference patterns, boundaries, and sensor thresholds.
- `.claude/specs/`: approved intent, designs, stories, tests, evidence, and reviews.
- `.claude/state/`: mutable workflow state; never evidence by itself.
- `.claude/verification.json`: repository-owned pre-PR commands and budgets.

## Troubleshooting

- If validation fails, fix the named missing or malformed repository setting;
  do not bypass it with invented evidence.
- If a required tool is unavailable, install/configure it or explicitly revise
  the project policy with its human owner.
- If a sensor reports a failure, follow its correction text and rerun it. Use a
  waiver only for a named, bounded, expiring exception approved by a human.
- If context grows too large, narrow the affected paths, keep approved decisions
  and evidence references, then compact or start a fresh session.
