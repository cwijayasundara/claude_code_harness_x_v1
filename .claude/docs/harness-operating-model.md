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
**exception-handling**, **logging-discipline**, **performance-heuristics**, and
**near-duplication** (thresholds in `.claude/project/maintainability.json`).
Gitleaks unavailability is advisory in an interactive run and blocking under
`harness-ci.js --all --fail-on-warn`. Active language and framework profiles
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
