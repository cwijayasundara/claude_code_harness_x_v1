# Harness operating model

This plugin applies harness engineering as a small user-controlled system around
a coding agent. It aims to increase the chance of a correct first attempt and
to surface actionable feedback early enough for self-correction. It does not
claim that sensors replace product, domain, security, or architectural judgement.

## Control model

Every active control in `.claude/harness-manifest.json` declares:

- `direction`: `feedforward` for a guide or `feedback` for a sensor;
- `execution_type`: `computational`, `inferential`, or `human`;
- `regulates`: one or more of `maintainability`, `architecture-fitness`, and
  `behaviour`;
- lifecycle ownership, recurring failure, cost, review date, and removal path;
- for feedback controls, an agent-facing `self_correction` path.

The manifest also declares a **control budget** (`control_budget.max_active` and
`baseline_ids`). Active controls outside the baseline must set
`net_add_justification` or `replaces` (with the replaced control retired). Active
count may not exceed `max_active`. This is the subtractive ratchet that prevents
unbounded harness growth.

`harness-validate` rejects an incomplete manifest. This keeps guides and
sensors legible as a coherent control system rather than an accumulation of
unexplained commands.

## Feedforward guide coverage

`.claude/guides.json` is the validated feedforward catalog. The
`harness-guides.js` resolver selects its smallest task-relevant subset and
reports external adapters as unavailable until the current agent confirms
them. Its coverage maps to Fowler's examples as follows:

| Fowler guide | Harness support |
| --- | --- |
| Principles, conventions, rules, and how-tos | Root `CLAUDE.md`, engineering core, and path-scoped profile guides |
| CFRs (cross-functional requirements) | Approved architecture, performance, security, privacy, and observability requirements |
| Reference docs | Project architecture, canonical reference patterns, domain packs, and optional API-doc sources |
| Functional specification | Human-approved G0-G4 specification packages and story contracts |
| Language servers | Optional `lsp` capability plus deterministic brownfield fallback |
| CLIs and scripts | Plugin harness commands declared as computational guides |
| Bootstrap scripts | Optional `project-bootstrap` capability paired with task instructions |
| Codemods | Optional `codemod` capability; never claimed available without a usable tool |
| Team knowledge | Optional `knowledge-mcp` capability with project-owned source authority |

This catalog describes feedforward availability, not successful execution.
Computational output becomes evidence only after the selected tool actually
runs; inferential sources remain subject to human ownership and approval.

## Feedback lifecycle

1. Before implementation, guides select the smallest relevant context,
   technology profile, domain rules, local patterns, and acceptance criteria.
2. During implementation, run `harness-sensor-watch.js .` in a separate
   terminal when rapid feedback is useful. It debounces edits, invokes only
   applicable profile/domain sensors, and records `sensor-watch.json`.
3. After a sensor run, use `harness-status.js . --agent`. It prints only
   actionable results: status, affected paths, why the control fired, correction
   path, and trend against the immediately preceding outcome.
4. Before completion, run focused verification and the normal sensor runner.
   CI repeats the configured computational sensors from a clean environment.
5. Use bounded independent evaluation for semantic gaps. Escalate unresolved
   product, domain, security, privacy, or material architecture decisions to a
   human rather than treating an evaluator as an automatic authority.
6. Run slower drift controls only when a demonstrated need justifies them;
   report first, then decide whether a recurring problem warrants a new guard.

## Sensor admission and retirement

Built-in computational sensors always available from `harness-sensors.js`
(**same set for vibe / outside-the-loop and `/harness` / on-the-loop**):
secret-scan (built-in patterns plus Gitleaks), architecture-boundaries, **file-size**, **function-size**,
**code-complexity**, **exception-handling**, **logging-discipline**,
**performance-heuristics**, **near-duplication**, **dependency-cycles**, and
**coupling-impact**. Maintainability thresholds live in
`.claude/project/maintainability.json`; dependency graph thresholds live in
`.claude/project/dependency-sensors.json`. Clone detection compares changed code
against the eligible repository corpus. Complexity, cycle, and coupling
heuristics begin advisory while precision is measured; project-owned native
lint/import tools remain authoritative.

Optional regression-effectiveness adapters read coverage and mutation JSON
configured in `.claude/project/regression-sensors.json`. They are disabled by
default because the harness cannot infer a repository's test runner or create
honest baseline thresholds. Once enabled, their overall and changed-file
metrics are persisted in the normalized report and sensor history.
`harness-regression.js . --kind mutation --changed <path>` (or `coverage`,
`property`, `fuzz`) executes only the explicit command/argument arrays in that
configuration, without shell interpretation, then evaluates the resulting
report. Test-integrity sensing remains fast and advisory by default.

Risk-triggered semantic modularity review uses
`.claude/project/modularity-review.json`. Run `harness-modularity.js .` to write
a grounded packet, obtain the configured number of genuinely independent review
documents, then rerun with one `--review <path>` per document. The deterministic
merge escalates corroborated high or blocking findings. Accepted hubs and
trade-offs live in expiring `.claude/project/modularity-decisions.json`; material
architecture changes remain human-approved.

Prefer the native `harness-modularity-review` workflow: it prepares the packet,
invokes two strong evaluators in isolated contexts, and merges their exact JSON.
P4 operational budgets live in `.claude/project/sensor-operations.json`.
`harness-ci.js` runs a deliberate bad-code canary and then verifies fresh sensor
evidence plus the hash-chained metric history. `harness-status.js` exposes stale
completion evidence and watcher running/stale/crashed state.

Run `harness-operations-evidence.js status --root .` for flakiness, production
SLO, watcher, and integrity posture. `compact` archives retained history;
`attest --private-key <path>` signs current evidence with an externally managed
Ed25519 key; `record-production --file <json>` records immutable operational
feedback. Set `attestation.required_in_ci` only after configuring its public key
and the CI-only `HARNESS_EVIDENCE_PRIVATE_KEY_PATH`. Run
`harness-git-hooks.js status --root .` before explicitly choosing `install`;
installation never overwrites an unrelated Git hook.

When the plugin is enabled, `hooks/hooks.json` automatically schedules
changed-path sensors after Claude Code file edits. Claude cannot complete the
main turn, mark a task complete, or stop the harness generator while blocking
sensor evidence is missing, stale, workspace-mismatched, or failing. The hook
adapter returns exit code 2 and actionable findings. It is inert outside
projects containing `.claude/harness.yaml`; the watcher remains useful for
changes made by external editors.
Gitleaks unavailability is a non-pass outcome with blocking disposition in
interactive and CI runs. Sensor outcome is reported separately from policy:
advisory maintainability warnings remain visible without blocking, while
blocking controls must pass. Active language and framework profiles
also run Semgrep; the fail-closed pre-PR `security` command should combine
Gitleaks history scanning, Semgrep, dependency audit, and any applicable
container or infrastructure scanner.

Add a sensor only for a recurring, observable failure. Before making it
blocking, establish a small baseline and review:

- correction rate: did the agent repair the issue using the result?
- precision: were warnings actionable rather than noise?
- latency: does it fit the stage where it runs?
- reviewer value: did it reduce avoidable review work?
- coverage gap: what does it see that existing controls miss?

When a control has no useful signal, produces persistent false positives, or is
superseded by a simpler equivalent, retire, downgrade, or replace it through
the manifest review process. A sensor that never fires is not automatically a
success; it may be unnecessary or inadequately aimed.

## Boundaries

The harness deliberately remains a local plugin. It has no fleet, scheduler,
dashboard, automatic merge, or deployment capability. The watcher is optional,
local, and dependency-free; it is a feedback affordance, not a new workflow
engine.
