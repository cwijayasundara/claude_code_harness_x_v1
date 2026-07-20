# Production sensor system

## Purpose

The sensor system is the harness feedback plane. Its job is to detect unsafe,
incorrect, weakly tested, or structurally degrading generated code early enough
for the coding agent to self-correct, and to prevent stale or false-green
evidence from satisfying a delivery gate.

Sensors reduce risk; they do not replace human ownership of product meaning,
domain policy, security/privacy decisions, or material architecture changes.

## Design principles

1. **Truthful before broad.** A sensor must never report pass when it inspected
   no applicable files, had no effective rules, or used stale evidence.
2. **Deterministic first.** Linters, compilers, graph tools, tests, coverage, and
   mutation tools establish facts. Inferential reviews interpret semantic
   design concerns that deterministic tools cannot decide.
3. **Changed-code feedback, repository-wide context.** Fast checks focus on the
   change, while duplication, dependency, and impact sensors compare it with the
   whole relevant codebase.
4. **Policy is separate from outcome.** `pass`, `warn`, and `fail` describe the
   observation. `advisory`, `blocking`, and `waived` describe gate disposition.
5. **Fresh evidence only.** Reports bind to the Git HEAD and exact working-tree
   content. Any subsequent product-code change invalidates the report.
6. **Actionable output.** Every non-pass result identifies paths, evidence, why
   it matters, and the smallest safe correction.
7. **Ratcheted adoption.** Expensive or noisy sensors begin in report-only mode,
   establish a baseline, then become blocking only with measured precision.
8. **No automatic architecture rewrites.** Inferential modularity findings may
   propose options, but material redesign requires human approval.

## Runtime architecture

```text
Git/worktree scope resolver
        |
        v
Sensor orchestrator -----> technology/domain command adapters
        |                  deterministic built-in sensors
        |                  slower scheduled/inferential sensors
        v
Normalized results: outcome + policy + metrics + affected paths
        |
        +----> concise agent correction view
        +----> human status/trends
        +----> append-only effectiveness history
        +----> story and pre-PR gates
```

Each report records:

- Git HEAD and a working-tree fingerprint;
- resolved changed paths, including untracked files and rename destinations;
- scope (`changed-path` or `project-wide`) and inspected-file counts;
- per-sensor outcome, policy disposition, metrics, evidence, and duration;
- raw health status and aggregate blocking status;
- configuration/rule identity where relevant.

## Delivery phases

### P0 — trustworthy enforcement foundation

Objective: eliminate false-green, incomplete-scope, stale-evidence, and severity
ambiguity before adding more sensors.

- Resolve tracked, untracked, deleted, and renamed paths from Git status.
- Expand project-wide scope consistently for every built-in sensor.
- Treat zero architecture rules as unconfigured, never as a successful check.
- Bind reports to HEAD plus exact working-tree content.
- Reject a sensor report after product code changes.
- Separate sensor outcome from blocking/advisory/waived disposition.
- Add adversarial tests for mixed tracked/untracked changes, project-wide
  boundaries, empty rules, advisory warnings, and stale reports.

Exit: no supported path can produce a passing gate without inspecting the
intended files using fresh evidence.

### P1 — deterministic code and dependency baseline

Objective: cover the common low-cost agent failure modes with language-aware
tools and repository-owned rules.

- Add native lint/type adapters by active profile.
- Enforce function arguments, function/file length, cyclomatic/cognitive
  complexity, unsafe suppression comments, and structured-logging conventions.
- Add AST-aware dependency rules, cycles, approved roots, and module ownership.
- Compare changed code against the whole codebase for clone/reuse detection.
- Report fan-in, fan-out, changed high-impact hubs, and dependency deltas.
- Pin tool versions and configuration hashes; fail closed when a blocking tool
  or required configuration is unavailable.

Exit: every supported production profile has lint, types, tests, security, and
dependency enforcement with no empty active controls.

Implementation status: P1 engineering is complete. It includes advisory
argument and cyclomatic estimates, changed-code versus repository clone
detection, a queryable local dependency graph, changed-code cycle detection,
approved-root enforcement, new-edge dependency deltas, governed exact-path
expiring suppressions, fan-in/fan-out impact metrics, and native
import-architecture adapter slots for the default Python and React/TypeScript
profiles. Each target must configure its approved roots and native architecture
tool before claiming calibration. Promotion from advisory to blocking remains a
human decision after real-pilot precision is measured; the harness deliberately
does not manufacture that evidence.

### P2 — regression effectiveness

Objective: establish that generated tests detect behavior changes, not merely
that they execute code.

- Parse statement, branch, function, and changed-line coverage.
- Introduce ratcheted coverage thresholds without rewarding test-only inflation.
- Add incremental mutation adapters (Stryker for JS/TS and a selected Python
  mutation tool), survivor/no-coverage metrics, and changed-file queries.
- Detect deletion/weakening of assertions and unexplained removal of regression
  tests.
- Provide optional property/fuzz adapters for input-heavy components.
- Run full mutation analysis on a slower cadence; run incremental mutation
  checks for risky changed code.

Exit: critical changed behavior has approved scenarios plus effective assertions
demonstrated by coverage visibility and a ratcheted mutation score.

Implementation status: the P2 computational foundation is present. It includes
disabled-by-default adapters for Istanbul/coverage.py JSON, Stryker mutation
JSON, normalized property-test JSON, and normalized fuzz JSON. It emits overall
and changed-file coverage, mutation scores, survivors, no-coverage mutants,
generative case/failure counts, and threshold outcomes into reports and metric
history. An advisory test-integrity sensor compares the working tree with HEAD
for net assertion/test deletion. `harness-regression.js` safely invokes an
explicit configured command without a shell and supports changed-path argument
templates for incremental mutation runs. A weak-test canary proves that 100%
coverage can still fail mutation effectiveness. Projects enable and ratchet
expensive adapters in `.claude/project/regression-sensors.json`. Remaining P2
work is real-runner adapters beyond the supported JSON contracts, semantic
review of intentional test removal, scheduled orchestration, and real-pilot
threshold calibration.

### P3 — coupling and semantic modularity

Objective: detect design debt that crosses file and module boundaries.

- Build/query a deterministic dependency and change-impact graph.
- Surface cycles, unstable dependency direction, change amplification, hubs, and
  cross-boundary semantic duplication for review triage.
- Add a dedicated modularity review based on Vlad Khononov's modularity prompts,
  grounded in code, architecture decisions, and graph evidence.
- Run semantic review before large PRs, after a configurable story cadence, and
  when deterministic risk triggers fire.
- Support explicit, expiring classifications for intentional hubs and accepted
  architectural trade-offs.
- Repeat high-risk inferential review independently and merge findings without
  allowing the generator to self-approve.

Exit: cross-file degradation has both deterministic risk signals and bounded
semantic review, with material changes remaining human-owned.

Implementation status: P3 is complete. Deterministic
change size, new-edge, high-impact-module, and dependency-cycle thresholds
create a workspace-hashed review packet grounded in architecture and graph
evidence. `harness-modularity.js` accepts only fresh versioned review documents,
requires distinct reviewer and context identities, and deterministically merges
findings by category plus affected paths. Corroborated high findings and any
blocking finding require a human decision. Intentional hubs, accepted trade-offs,
and false positives require exact finding fingerprints, human approval, owner,
reason, and expiry in `modularity-decisions.json`. This extends the existing
independent-evaluation control rather than adding another top-level control.
Story-cadence triggers and fail-closed pre-PR freshness enforcement are also
integrated. The native `harness-modularity-review` workflow creates two isolated
`harness-evaluator` contexts without cross-contaminating their findings. Pilot
evidence separately records modularity review count, precision, useful-review
rate, and review time; rollout remains ineligible until real evidence meets the
human-owned thresholds.

### P4 — operational hardening and continuous improvement

Objective: make sensor execution unavoidable, observable, affordable, and
provably useful in real production delivery.

- Integrate sensor freshness into agent completion, pre-commit/pre-push, and CI.
- Add per-sensor cadence, timeout, cancellation, concurrency, sandbox, and
  resource budgets.
- Use portable watch backends with crash recovery and visible stale/not-running
  state.
- Store metric histories and baselines, not only pass/warn/fail states.
- Measure precision, correction rate, time-to-feedback, flakiness, escaped
  defects, and reviewer value.
- Quarantine flaky sensors; expire waivers; review zero-fire/high-noise controls.
- Sign or hash-chain material evidence and retain CI provenance/artifacts.
- Exercise deliberate bad-code canaries to prove that blocking sensors continue
  to detect representative failures.
- Define production SLOs for feedback latency, availability, and false-green
  rate, with human-owned rollout and rollback decisions.

Exit: completion and integration cannot proceed with missing/stale blocking
evidence, effectiveness is measured from real pilots, and sensor regressions are
detected by recurring canaries.

Implementation status: P4 is complete as a configurable, human-ratcheted
operational system. `sensor-operations.json`
defines execution timeout, feedback SLO, completion/pre-PR/CI freshness,
watch-heartbeat, and bad-code-canary budgets. Story completion, branch
finalization, and CI fail closed on stale evidence. Sensor metric history is
SHA-256 hash chained; legacy rows remain readable while new rows form the
trusted chain. CI runs deliberate oversized-file, boundary, and embedded-secret
canaries before normal sensors. The watcher records PID/state/heartbeat, exposes
stale/crashed state, and falls back to per-directory watches where recursive
watching is unavailable. Flakiness is measured over a bounded history window;
only an explicit, expiring, human-approved quarantine can demote a failing
non-protected sensor, and secrets, architecture, and SAST are never eligible.
Retention archives old hash-chained rows before rebuilding the live chain.
Optional Ed25519 CI attestation binds the sensor report, history head, commit,
provider run, and job provenance without storing private keys. Immutable
production feedback feeds the improvement ratchet and reports false-green and
sensor-availability SLOs. Managed pre-commit/pre-push gates are available only
through explicit installation and refuse to overwrite existing hooks. Real
pilot calibration and rollout/rollback decisions remain human-owned by design.

Activation status: the plugin is always-on in installed harness projects.
`hooks/hooks.json` schedules debounced changed-path sensors after Claude Code
`Edit`, `Write`, and `NotebookEdit` calls. Blocking `Stop`, `TaskCompleted`, and
generator `SubagentStop` hooks require fresh, workspace-matched evidence and
translate blocking policy into Claude Code exit code 2 with correction guidance.
Hooks are inert when the current project has no `.claude/harness.yaml`. Bash or
external filesystem changes that bypass edit hooks are still detected at the
completion gate from the workspace fingerprint. Git and CI remain independent
enforcement layers.

The `/harness` skill also declares the edit, Stop, and TaskCompleted handlers in
its frontmatter, so invoking the command explicitly activates the same lifecycle
for the skill even when command-scoped behavior is being inspected. Claude Code
deduplicates the identical plugin and skill handlers.

## Cadence model

| Cadence | Typical sensors | Gate policy |
| --- | --- | --- |
| Edit batch/watch | format, lint, type, focused tests, secrets, changed boundaries | fast blocking plus selected advisory |
| Story completion | required story tests, changed-code sensors, fresh independent review | blocking |
| Pre-PR/CI | clean build, full tests, security, boundaries, coverage, smoke | blocking |
| Scheduled/risk-triggered | full mutation, dependency freshness, coupling, modularity | report first, ratchet selectively |
| Production feedback | escaped defects, performance/security/runtime signals | human-owned improvement input |

## Normalized policy semantics

- `outcome=pass`: the sensor ran and its configured target was met.
- `outcome=warn`: actionable degradation, unavailable optional capability, or an
  unconfigured control.
- `outcome=fail`: configured acceptance criteria were violated.
- `disposition=advisory`: visible but does not block the current gate.
- `disposition=blocking`: any non-pass outcome blocks the current gate.
- `disposition=waived`: an exact-path, approved, expiring exception; protected
  security and architecture controls remain non-waivable.

The report's `status` describes raw health. `blocking_status` is the only value
used to decide whether delivery may progress.

## Rollout rule

Implement one phase at a time. Each phase requires negative-path tests, a lived
bad-code canary, documentation/config migration, and clean full-suite evidence.
P1–P4 controls must not be made blocking merely because tooling exists: observe
precision and correction behavior first, then ratchet thresholds with explicit
human approval.
