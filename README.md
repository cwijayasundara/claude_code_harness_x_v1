# Lean Expert-Generalist Harness

A deliberately small Claude Code plugin for source-grounded, human-steered
software delivery. Humans approve product meaning, tests, architecture, and
material risk. Agents execute one bounded story at a time through TDD,
independent review, deterministic sensors, and pre-PR verification.

The plugin is self-contained under `.claude/`. A target repository receives a
short root `CLAUDE.md`; all harness configuration, specifications, state,
profiles, and evidence remain under that target's `.claude/` directory.

## Run locally

```sh
claude --plugin-dir /absolute/path/to/claude_code_harness_x_v1/.claude
```

The supported public surface is intentionally small:

```text
/lean-expert-generalist-harness:harness "deliver requirements/change-prd.md"
/lean-expert-generalist-harness:harness-status
/lean-expert-generalist-harness:harness-retro
```

`harness-operations` remains an internal/maintainer entry point for setup,
validation, sensors, upgrades, and release checks.

## Delivery model

Greenfield work:

```text
G0 source and interpretation
 -> G1 epics, stories, dependencies
 -> G2 test strategy, cases, data
 -> G3 architecture, design, performance budgets
 -> G4 executable story contracts
 -> story ratchet
 -> pre-PR verification
 -> independent branch review
 -> draft PR readiness
```

Brownfield work adds:

```text
B0 baseline health
 -> B1 bounded provenance-labelled code map
 -> B2 smallest change/reuse strategy and design amendment
 -> G1-G4 and the same story ratchet
```

Every approval is an explicit human decision recorded in
`.claude/specs/index.json`. Specification writes and implementation are refused
on `main`, `master`, and `develop`.

## Story ratchet

```text
READY -> RED_TEST -> IMPLEMENT -> STORY_REVIEW -> FAST_SENSORS -> STORY_VERIFIED
```

Starting a story persists and prints a concise completion contract: its
acceptance criteria, required sensors and evidence, and the exact
`STORY_VERIFIED` exit state. Harness status also labels recorded feedback by
source (`deterministic-test`, `independent-evaluator`, `deterministic-sensor`,
or `human-decision`) so reconsidering an agent's own output is never mistaken
for external verification.

The ratchet checks approved dependencies, allowed Git scope, failing-test and
passing-test evidence, immutable hashes, a fresh read-only evaluator verdict,
required sensors, and a single configured repair limit. A
`human-decision-required` verdict stops automation.

## Responsible local verification

Each target owns `.claude/verification.json`. Before draft-PR readiness it must
configure real commands for install/build, complete unit tests, hermetic
integration tests, hermetic system regression, safe public-seam success/failure
smoke journeys, lint, type, security, boundary contracts, and measurable
performance budgets. Unconfigured required checks fail.

External databases, HTTP services, queues, LLMs, embeddings, clocks, and other
boundaries declare their test doubles. PostgreSQL-specific behavior uses
ephemeral PostgreSQL; an in-memory substitute requires an explicit statement
that PostgreSQL semantics are not under test plus documented caveats.

## Context and cost control

`.claude/routing.json` keeps deterministic work model-free, uses a Sonnet
sidekick for bounded implementation, and reserves Opus for strong-risk and
branch review. Haiku validation is disabled until matched cases preserve
first-pass acceptance without more defects, repairs, or human review time and a
human enables promotion.

Initialized projects also default the main session to Sonnet at medium effort,
cap fixed extended-thinking budgets at 8,000 tokens, keep auto-compaction on,
and default dynamic workflows to small Sonnet teams. Their status line displays
live context percentage, estimated API-session cost, effort/thinking state, and
subscription limit usage when Claude Code provides it. At 70% context it warns;
at 85% it recommends compacting or clearing. The dollar value is a local
estimate, not authoritative billing.

Context packs have role budgets. Requirements, approved decisions, invariants,
and expected test results are never compressed. Only verbose tool output may be
excerpted, with file hash and line provenance. Usage/cost is recorded only from
durable provider or session evidence; observed ceilings are not misrepresented
as provider-enforced limits.

Large repositories are handled through package/subsystem-scoped discovery,
generated/vendor read-deny defaults, layered project guidance, optional sparse
worktrees, and a preference for LSP/code-intelligence navigation over broad
scans. Static mapping has no source-file-count ceiling.

## Project layout

```text
.claude/
  .claude-plugin/plugin.json
  skills/                 # public workflows and engineering core
  agents/                 # Sonnet generator, Haiku/Opus read-only evaluators
  hooks/                  # narrow destructive-Git protection
  scripts/                # deterministic internal capabilities
  lib/                    # dependency-free contracts
  tests/                  # contract and negative-path tests
  templates/project/      # target scaffold
  docs/                   # operating model, implementation, release, roadmap
  release/                # synthetic matched release scorecard
```

Target specifications are separated under `.claude/specs/`: source, BRD/PRD,
epics, stories, dependencies, test data/cases/plans, design, architecture,
plans, evidence, reviews, brownfield analysis, and amendments. Mutable ratchet
and context state lives under `.claude/state/` and is never treated as evidence.

## Verification and release

Run the complete plugin release gate:

```sh
node .claude/scripts/harness-release-check.js
```

It validates the Claude Code plugin, runs the full test suite, executes lived
canaries (TDD, brownfield reuse, routing/cost), matched P7 greenfield/brownfield
canaries, and writes an M7 scorecard plus control-subtraction **proposals**
(never auto-applied). The committed
[P7 scorecard](.claude/release/p7-scorecard.json) is deliberately honest:
deterministic canaries cannot measure human review time, escaped production
defects, provider cost, or real graph retrieval value.

Real pilots close that gap without automating governance. Maintainers record
hash-backed observations with `harness-pilot.js record`; the aggregate report is
`insufficient-evidence`, `hold`, or `eligible-for-human-rollout-decision`. Only a
human can authorize rollout. Prefer subtraction via `/harness-retro` when
controls stop paying rent.

See [the improvement plan](.claude/docs/v1-improvement-plan.md),
[operating model](.claude/docs/harness-operating-model.md), and
[release guide](.claude/docs/release.md).
