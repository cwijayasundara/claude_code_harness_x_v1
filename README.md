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

## User guide: scaffold and use a repository

### 1. Initialize the scaffold

Set the plugin root to this repository's `.claude` directory and initialize the
target repository:

```sh
export CLAUDE_PLUGIN_ROOT=/absolute/path/to/claude_code_harness_x_v1/.claude
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-init.js" /absolute/path/to/target-repository
cd /absolute/path/to/target-repository
```

Initialization is additive: existing files are preserved. It creates the
project-owned `.claude/` scaffold, a short agent-facing `CLAUDE.md`, and a
human-facing `HARNESS_USER_GUIDE.md`. The latter is customized with the target
repository's name and detected ecosystem markers and is intended to be edited
as the team's local operating guide.

### 2. Customize the new repository

Before asking the harness to deliver product code:

1. Edit `.claude/harness.yaml`. Keep only the technology profiles the target
   actually uses and select the appropriate domain pack.
2. Document real boundaries and reusable examples in
   `.claude/project/architecture.md` and
   `.claude/project/reference-patterns.md`.
3. Configure real install/build, test, smoke, lint, type, security, boundary,
   and performance checks in `.claude/verification.json`. Required checks fail
   closed when they remain placeholders.
4. Review the generated `HARNESS_USER_GUIDE.md` and add repository-specific
   prerequisites, requirement locations, ownership, and release conventions.
5. Validate the installation:

   ```sh
   node "$CLAUDE_PLUGIN_ROOT/scripts/harness-validate.js" .
   node "$CLAUDE_PLUGIN_ROOT/scripts/harness-doctor.js" .
   ```

Commit this configuration so humans and agents operate with the same guides.

### 3. Deliver a change

Create a feature branch—the harness refuses specification and implementation
writes on protected branches—then put the request in a durable file:

```sh
git switch -c feature/example-change
mkdir -p requirements
# Write requirements/example-change.md before starting delivery.
claude --plugin-dir "$CLAUDE_PLUGIN_ROOT"
```

In Claude Code, run:

```text
/lean-expert-generalist-harness:harness "deliver requirements/example-change.md"
```

The harness proposes, but never self-approves, the specification gates:

- G0: source, interpretation, and intended outcome
- G1: epics, stories, estimates, dependencies, and delivery order
- G2: test strategy, cases, and test data
- G3: architecture, alternatives, design, and performance budgets
- G4: executable story contracts and requirements/test traceability

After approval it executes one story at a time through a failing test,
implementation, independent review, deterministic sensors, and verification.
Use `/lean-expert-generalist-harness:harness-status` to see the current gate or
story state, required evidence, and actionable failures. Humans retain product,
material architecture, security/privacy, merge, and deployment decisions.

### 4. Brownfield repositories

For an existing system, identify the smallest owning package or subsystem in
the request. The harness first records baseline health (B0), builds a bounded
provenance-labelled code map (B1), and proposes the smallest reuse-first change
strategy (B2). Review cited code and tests before approving the strategy; the
map is a navigation aid, not a claim of complete understanding.

### 5. Operate and upgrade

Useful commands from the target repository are:

```sh
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-guides.js" --root . --path src/example.ts
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-sensors.js" .
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-status.js" . --agent
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-upgrade.js" --target .
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-upgrade.js" --target . --apply
```

Upgrade preview is read-only. Applying an upgrade adds missing scaffold files
and merges supported baseline controls without overwriting project-owned policy
or the customized `HARNESS_USER_GUIDE.md`. Use
`/lean-expert-generalist-harness:harness-retro` to review repeated failures and
propose the smallest useful guide, sensor, fixture, or control removal.

## Delivery model

Greenfield work:

```text
G0 source, SPDD analysis, REASONS Canvas / direct-BRD interpretation
 -> G1 epics, estimated stories, dependency DAG, critical path, allocation clusters
 -> G2 test strategy, cases, data
 -> G3 architecture, design, performance budgets
 -> G4 executable story contracts + requirements/test traceability
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

Feedforward guides are catalogued in `.claude/guides.json` and resolved per
task by `harness-guides.js`. The validated catalog covers principles,
conventions, rules, reference docs, how-tos, cross-functional requirements,
functional specifications, CLIs/scripts,
architecture/performance/observability requirements, profile/API guidance,
bootstrap tools, codemods, code intelligence, and team knowledge sources.
External computational integrations remain capability adapters and are
reported unavailable until the current agent confirms a usable integration.

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
plans, optional tracker projections, evidence, reviews, brownfield analysis, and amendments. Tracker
exports require a separate human approval after G1; the harness performs no live
provider write, and local specifications remain authoritative. Mutable ratchet
and context state lives under `.claude/state/` and is never treated as evidence.

Official Linear and Atlassian remote MCP endpoints and Microsoft's Azure DevOps
MCP package can be added per project without credentials in source control:

```sh
node .claude/scripts/harness-tracker-mcp.js configure --provider linear --root .
node .claude/scripts/harness-tracker-mcp.js configure --provider jira --root .
node .claude/scripts/harness-tracker-mcp.js configure --provider azure-devops --azure-org YOUR-ORG --root .
```

Configuration and OAuth do not authorize publication. The tracker publication
skill requires an approved projection, a second explicit confirmation of the
remote mutation plan, idempotent reconciliation, and an immutable receipt.

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
[production sensor-system design](.claude/docs/production-sensor-system.md),
[operating model](.claude/docs/harness-operating-model.md), and
[release guide](.claude/docs/release.md).

Production sensors are activated through plugin-level Claude Code hooks:
file-edit events schedule debounced checks, while Stop, TaskCompleted, and the
generator's SubagentStop fail closed on missing, stale, or blocking evidence.
Scripts stored under `.claude/scripts` are not considered active by themselves.
