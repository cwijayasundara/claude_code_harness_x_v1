---
description: Turn a bounded BRD, story, issue, or change request into a small, tested, reviewable draft PR using the lean expert-generalist workflow.
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: node "$CLAUDE_PLUGIN_ROOT/hooks/pre-tool-safety.js"
---

# Harness delivery workflow

The user request is:

```text
$ARGUMENTS
```

Use this workflow. Keep artifacts and context proportionate to risk; do not invent a larger process.

If the request is to initialise, validate, diagnose, migrate, upgrade, audit,
run sensors/CI, maintain evidence, or otherwise operate the harness rather
than deliver a product change, invoke `harness-operations` and stop this
delivery workflow. If it is a retrospective, invoke `harness-retro` instead.

## 0. Vibe / outside-the-loop re-entry

If the user was **vibe coding** (outside the loop) or the tree has ungoverned
agent edits, do **not** skip sensors:

1. Run `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-sensors.js" .` (or `--changed`
   paths). Craft sensors always run: file-size, function-size, exception-handling,
   logging-discipline, performance-heuristics, near-duplication, secrets, boundaries.
2. Run `harness-status.js . --agent` and clear **fail** findings before co-design.
3. Use the target template `.claude/specs/vibe-to-harness.template.md` (or copy from
   plugin `templates/project/.claude/specs/vibe-to-harness.template.md`) to capture a
   governing source file, then continue at step 1 below.
4. Prefer brownfield B0–B2 when the spike already sprawled across many modules.

Sensors are **mode-independent**: they run for vibe sessions and for `/harness`
story work. Co-design gates still apply before product claims and draft PRs.

## 1. Establish the grounded change

1. Confirm the target project has `.claude/harness.yaml`; if not, run `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-init.js" .` from the target project before proceeding.
2. Run `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-validate.js" .` before reading project context. Resolve configuration errors before delivery work.
3. Invoke `harness-engineering-core` and `harness-context-selection`. Read only the relevant project files they identify.
4. Confirm Git is on a named feature branch. Never write specifications or product code on `main`, `master`, or `develop`.
5. For a BRD/PRD inside the project, run `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-specs.js" intake --change <id> --source <path> --kind <brd|prd> --root .`. This captures an immutable source and hash in `.claude/specs/index.json`. Do not treat a conversation summary as a BRD/PRD; ask the human to save or identify the governing source.
6. Put every derived artifact in its matching `.claude/specs/<package>/` as schema-compatible JSON, then register it with `harness-specs.js register --file <path> --root .`. Every artifact must name captured `source_ids`, precise `source_locations`, assumptions, and open questions.
7. Stop when ambiguity changes observable behaviour, domain meaning, data handling, security, architecture, or test expectations. Never silently promote an inference to a requirement.

## 2. Co-design through human gates

The agent drafts and critiques; the human decides. For each gate, register the
draft artifacts, then render a reviewable proposal pack and present it to the
human **before** recording approval:

```sh
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-specs.js" proposal \
  --change <id> --gate <G0..G4|B0..B2> --write --root .
```

Show the generated markdown (also written under
`.claude/specs/evidence/<id>-gate-<gate>-proposal.md` when `--write` is set).
Each gate pack leads with a **human decision session** (G0 interpretation, G1
stories/deps, G2 tests, G3 structural alternatives, G4 contracts, B0–B2 brownfield)
before the JSON appendix. Do not call `approve` until the human explicitly accepts
that pack.

Gate meanings:

- G0: feature branch, captured source, scope, assumptions, and open questions.
- G1: epics, stories, acceptance criteria, and dependency ordering.
- G2: test data, test cases, integration/system journeys, and test plan.
- G3: architecture, design, folder structure, seams, risks, and measurable performance budgets.
  Architecture must present three **stack-agnostic** structural alternatives
  (`clone-vertical`, `shared-modules`, `parameterized-spine`), a selected shape
  with rationale, and a `second_slice_reuse_policy` / evolutionary rules so the
  next similar capability reuses seams or opens a design amendment—not a silent
  vertical clone. Technology (workers, modules, graph runtimes, etc.) is chosen
  after the structural shape, not instead of it.
  **Present the G3 proposal as a design session:** show the generated markdown
  (decision summary, three alternatives, second-slice policy, checklist) to the
  human before `approve`. Prefer `--write` so the pack lands under
  `.claude/specs/evidence/*-gate-G3-proposal.md`. Do not ask the human to read
  only raw JSON.
- G4: story execution order and bounded TDD plan. Each story contract sets
  `implementation_posture` (`first-slice` | `reuse-existing` | `extract-shared` |
  `justified-divergence`) with `reuse_targets` or a divergence justification as
  required. Dependent stories cannot claim `first-slice`.

Use `harness-specs.js approve --change <id> --gate <G0..G4> --approver <human> --root .`
only after that explicit decision. Gates are sequential. Do not implement before G4.

For brownfield work use its own human-approved discovery track before the
greenfield-style story/design gates:

- B0: register exact baseline build/test/lint/type/security results, known
  failures, protected interfaces, compatibility constraints, migrations, and
  test gaps using `brownfield/baseline.example.json`.
- B1: run `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-brownfield.js" map --change
  <id> --source-id <id>-source --path <bounded-scope> --focus <path-or-symbol> --root .`. Prefer a bounded
  LSP/Graphify/CCE export via `--adapter <file>` when available (adapter schema:
  provider + nodes + provenance-labelled edges; the harness never vendors a
  graph engine). Review graph provenance, code/folder/API/test maps, hotspots,
  impacted callers, and canonical reuse candidates against the cited source.
- B2: register the agreed smallest seam, **reuse first** (no speculative
  generalization), `second_slice_decision`, duplication risks, characterization
  tests, regression scope, migration and rollback in a `change-strategy`
  artifact plus a design amendment.
  Strategy content may be drafted with the same fields as
  `lib/brownfield-strategy.js` (`proposeChangeStrategy`).

Approve each with `harness-specs.js approve --gate B0|B1|B2` only after the
human reviews it. Navigate from symbols and relationships first; broaden text
search only for a recorded gap. Do not generalize speculatively: reuse
demonstrated concepts and record why a new abstraction is warranted.

## 3. Implement in vertical slices

For each dependency-ready approved story, start the persisted ratchet with
`harness-ratchet.js start --change <id> --story <story-id> --root .`. It loads
the approved G4 contract and refuses the wrong branch, incomplete dependency,
or missing contract.

Before any model call, create a small context manifest and run
`harness-routing.js pack --role <sidekick|evaluator-economical|evaluator-strong>
--story <id> --manifest <json> --root .`. Requirements, approved decisions,
domain invariants, and expected test results are protected and never compressed.
Only verbose tool output may be excerpted with source/hash/line provenance; omit
low-priority optional context rather than exceeding the approved budget.

Run `harness-routing.js decide --task <implementation|story-validation|repair>
--change <id> --story <id> [--risk <contract-risk>] --root .` and obey its
route. Deterministic tasks use no model. Security, privacy, domain, architecture,
public-contract, migration, performance, and every branch review use the strong
evaluator. The economical evaluator remains unavailable until matched quality
evidence passes policy and a human explicitly enables it.

1. Give `harness-generator` only the contract and referenced context. **Run**
   the smallest public-seam test (do not invent an exit code). Capture the real
   command, exit code, stdout/stderr, expected failure, and observed failure in
   red-test evidence, then run
   `harness-ratchet.js red --story <id> --file <json>`. Prefer the
   `story-evidence` helpers pattern used by `harness-lived-canary.js`.
2. Implement the smallest passing change, keeping all Git changes within
   `allowed_change_scope`. **Re-run** the focused tests and record the real
   passing command, changed_paths, and test_paths, then run
   `harness-ratchet.js implement --story <id> --file <json>`.
3. Invoke the evaluator returned by routing (`harness-evaluator-fast` only when
   promoted, otherwise `harness-evaluator`) in fresh context with
   source/design/story/test, diff, and evidence paths—never the generator's
   narrative or suggested verdict. Save its strict JSON and run
   `harness-ratchet.js review`.
4. A `revise` verdict allows one root-cause repair via `repair-start` and
   `repair-outcome`, followed by a fresh evaluator pass. A
   `human-decision-required` verdict stops automation.
5. Run fast relevant sensors after validator pass and record their normalized
   report with `harness-ratchet.js sensors`.
6. Run `harness-ratchet.js verify --story <id>` to checkpoint
   `STORY_VERIFIED`. Only then select the next dependency-ready story.

Prefer a proven local pattern over a second implementation. The main workflow
owns state, evidence, routing, and gates; neither generator nor evaluator may
self-advance the ratchet.

For defects, investigate and reproduce the root cause before proposing a fix. Do not stack speculative fixes.

## 4. Verify and report

1. Run `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-sensors.js" .` from the target repository after implementation, then run `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-status.js" . --agent`. Use only failing or warning entries relevant to the story, and follow the supplied correction path before claiming completion.
2. Run any additional focused commands required by the selected profiles/domain rules.
3. Keep transition inputs in `.claude/specs/evidence/` and validator output in
   `.claude/specs/reviews/`; ratchet state itself lives under
   `.claude/state/stories/` and is never a substitute for evidence.
4. Treat evaluator findings as input to one evidence-backed repair cycle, not as
   permission to bypass tests or human gates. Domain, security, privacy,
   architecture, migration, public-contract, or performance decisions require
   the declared strong route and any applicable human approval.
5. Do not claim completion or prepare a PR without fresh verification evidence
   and a recorded evaluator verdict. Prepare a draft PR only; never merge or deploy.

After every approved story is `STORY_VERIFIED`, run the project-owned pre-PR
contract with `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-verify.js" --action run
--change <id> --cadence pre-pr --root .`. `.claude/verification.json` must name
**configured, executable** install/build, unit, hermetic integration, hermetic
system regression, public-seam smoke success/failure journeys, lint, type,
security, boundary doubles, and explicit performance budgets. Pre-PR is
**fail-closed**: unconfigured required kinds throw before execution. Read
`agent_summary.corrections` on a failing report for path, reason, and next
action. Prefer story-fast unit cadence during the ratchet when useful.

Invoke `harness-evaluator` once more in fresh context for the complete branch,
using the governing sources, approved design/stories, full diff, story verdicts,
and pre-PR report. Save its JSON under `.claude/specs/reviews/`, then run
`harness-verify.js --action finalize --change <id> --report <pre-pr-report>
--review <branch-review> --root .`. Only `ready-for-draft-pr` evidence permits a
draft PR; it never permits merge or deployment.

When Claude Code/provider session usage is available, save the provider export
and record it with `harness-routing.js receipt --file <receipt.json>`. Never
estimate or invent tokens or dollars. `receipt-observed` ceilings stop further
model routing only after recorded spend reaches the limit; use
`provider-enforced` only when the cited provider control actually enforces it.

## Guardrails

- The scoped safety hook blocks only clearly destructive Git commands: hard reset, forced clean, `checkout --`, and force-push. It does not replace normal human approval for other operations.
- Never add a new workflow engine, hook, sensor, or profile control while completing a product change.
- Approved specifications are immutable. Record a linked amendment or superseding artifact and obtain the affected gate approval again.
- Do not add new domain rules without a domain-owner decision.
- Keep context packs narrow and summaries concise.
- Escalate after one failed automated repair attempt or when a domain/architecture decision is required.
- Record a cost receipt only when provider/session evidence is available; never fabricate model cost.
