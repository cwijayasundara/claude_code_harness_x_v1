# Implementation guide

Keep the harness thin. Prefer a deterministic, dependency-free contract over a
new service, dashboard, workflow engine, hook, agent, or general framework.

## Boundaries

- Plugin product code lives under `.claude/`; target artifacts live under the
  target's `.claude/`.
- `CLAUDE.md` files are progressive-disclosure maps, not full manuals.
- `.claude/specs/index.json` is metadata and traceability only; large graphs and
  content remain in their package files.
- `.claude/state/` is mutable resumable state, never proof of correctness.
- Approved specifications and recorded evidence are hash checked.
- All subprocesses use argument arrays rather than shell interpolation.
- Project paths are resolved and rejected when they escape the target root.

## Change discipline

1. Change the smallest governing module and its negative-path tests.
2. Preserve the three-skill public surface.
3. Add a control only for a demonstrated recurring failure, with owner, cadence,
   correction path, review date, and removal condition. Active controls outside
   `control_budget.baseline_ids` need `net_add_justification` or `replaces`, and
   active count must stay ≤ `control_budget.max_active`.
4. Do not duplicate capabilities already owned by specifications, ratchet,
   verification, routing, profiles, or sensors.
5. Co-design gates use `harness-specs.js proposal` before `approve`.
6. Story red/implement evidence should come from executed commands
   (`lib/story-evidence.js`); see `scripts/harness-lived-canary.js`.
7. Pre-PR checks must be configured with real commands; unconfigured required
   kinds fail closed. Use `agent_summary` on verification reports for
   corrections.
8. Brownfield maps are scoped; optional Graphify/CCE/LSP adapters are import-only
   with edge provenance. Prefer reuse via `proposeChangeStrategy` patterns.
9. Expert-generalist base is `harness-engineering-core` plus progressive
   references. Language/framework packs load only via path/content signals or
   an explicit configured hint (`harness-profile-context.js`).
10. Cost routing uses `decideRoute` / `harness-routing.js`. Never invent token
    costs; record only provider-evidenced receipts. Strong risks never use the
    economical evaluator.
11. M7: pilots are immutable + hash-checked; subtraction is proposal-only;
    rollout eligibility never authorizes automation.
12. Run the focused tests, then `harness-release-check.js`.
13. Existing targets: `harness-upgrade.js --target <project> --apply` creates
    missing files (including `maintainability.json`) and **merges** new baseline
    controls (`file-size`, `near-duplication`) into `harness-manifest.json`
    without overwriting local control customizations.
14. Harness learning is an evidence-to-experiment ratchet, not autonomous
    self-editing. `lib/improvement-ratchet.js` records hash-backed observations,
    corroborates recurring patterns across independent work, requires explicit
    human experiment approval, evaluates a fixed hypothesis and protected
    guardrails, and emits eligibility only. Promotion remains a human Git change.

Model quality, provider cost, human review time, and escaped defects cannot be
proven by deterministic unit tests. Label synthetic measures honestly and keep
promotion/release decisions human controlled.

## P8 implementation boundary

`lib/pilot-evidence.js` validates target-owned policy, records immutable pilot
observations under `.claude/specs/evidence/pilots`, revalidates cited hashes on
every read, and derives a human-only rollout recommendation.
`scripts/harness-pilot.js` is its only command-line adapter. P8 adds no public
skill, execution state, service, or autonomous rollout mechanism.
