# Lean Expert-Generalist Harness

A deliberately small Claude Code plugin for source-grounded, human-steered
software delivery. Humans approve product meaning, tests, architecture, and
material risk. Agents execute one bounded story at a time through TDD,
independent review, deterministic sensors, and pre-PR verification.

The plugin is self-contained under `.claude/`. A target repository receives a
short root `CLAUDE.md`; all harness configuration, specifications, state,
profiles, and evidence remain under that target's `.claude/` directory.

## Install locally

```sh
claude plugin marketplace add /absolute/path/to/claude_code_harness_x_v1
claude plugin install harness@harness-local
```

The install defaults to user scope, making the plugin available in every
project. Use `--scope local` on both commands for a gitignored, project-specific
installation. Restart Claude Code after installing. After editing or pulling
changes into this checkout, refresh it with:

```sh
claude plugin marketplace update harness-local
claude plugin update harness@harness-local
```

For one-session development without installing the plugin, use:

```sh
claude --plugin-dir /absolute/path/to/claude_code_harness_x_v1/.claude
```

`--plugin-dir` only loads a plugin for the process it starts. It does not create
a persistent Claude Code plugin installation.

The supported public surface is intentionally small:

```text
/harness:run "Deliver requirements/change-prd.md"
/harness:status
/harness:retro
```

`/harness:run` is the single SDLC front door. It accepts an idea, PRD, BRD,
feature, epic, story, issue, design, tests, or existing diff; it can stop after
an intermediate artifact or continue through verified draft-PR readiness.

`/harness:ops` remains an internal/maintainer entry point for setup,
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

### 3. Start or continue SDLC work

Create a feature branch—the harness refuses specification and implementation
writes on protected branches. Durable files are recommended and required for
PRD/BRD authority:

```sh
git switch -c feature/example-change
mkdir -p requirements
# Write requirements/example-change.md before starting delivery.
claude
```

Start from whatever durable input you actually have:

```text
/harness:run "Deliver requirements/example-change.md"
/harness:run "Implement requirements/US-142.md"
/harness:run "Add invoice export"
/harness:run "Fix issue #381"
/harness:run "Design invoice export but do not write code"
/harness:run "Continue"
```

The harness reports the inferred starting point, target, repository posture,
delivery lane, and interaction mode before it drafts artifacts. Optional
overrides are `--from`, `--through`, `--mode`, `--change`, `--new-system`, and
`--existing-system`. Normal use does not require them.

Interaction modes are:

- `guided`: detailed co-design decisions;
- `checkpoint` (default): consolidated product, solution, and readiness stops;
- `unattended`: implementation only inside an already human-approved contract.

Risk changes review and evidence depth, not the size of the delivery lane.
A bounded security-sensitive story remains bounded.

Checkpoint mode keeps G0-G4 as separate evidence and approval records. Product
combines G0+G1; solution combines G2+G3+G4. A combined approval is recorded only
after every constituent gate validates, and a failure leaves no partial gate
approval.

Internally, the harness proposes, but never self-approves, the specification gates:

- G0: source, interpretation, and intended outcome
- G1: epics, stories, estimates, dependencies, and delivery order
- G2: test strategy, cases, and test data
- G3: architecture, alternatives, design, and performance budgets
- G4: executable story contracts and requirements/test traceability

After approval it executes one story at a time through a failing test,
implementation, independent review, deterministic sensors, and verification.
Use `/harness:status` to see the current gate or
story state, target, route, required human action, and recomputed next step. Use
the full status view for detailed evidence and actionable failures. Humans
retain product, material architecture, security/privacy, merge, and deployment
decisions.

## Detailed user guide

### Use one front door

You do not need to choose a different command for requirements, design, tests,
implementation, or an existing-code change. Describe the source and the outcome
to `/harness:run`; it selects the smallest sufficient route and reports its choice
before writing delivery artifacts.

```text
/harness:run "<what you want delivered>"
```

The classification has five independent parts:

| Field | Meaning | Examples |
| --- | --- | --- |
| Starting point | What evidence you supplied | `prd`, `brd`, `feature`, `story`, `issue`, `design`, `tests`, `diff` |
| Target | Where this run should stop | `backlog`, `design`, `tests`, `implementation`, `verified`, `draft-pr` |
| Repository posture | Whether existing behaviour must be preserved | `greenfield`, `brownfield` |
| Delivery lane | How much process the scope needs | `documentation`, `bounded-change`, `feature`, `initiative`, `refactor`, `re-entry` |
| Interaction mode | When the harness returns to you | `guided`, `checkpoint`, `unattended` |

If classification confidence is not high, the harness exposes its assumption
and asks only questions that could change observable behaviour, domain meaning,
data/security handling, architecture, or test expectations.

### Choose a starting point

#### Idea or short feature description

Use natural language when the work is still taking shape:

```text
/harness:run "Add invoice export for account administrators"
```

The harness captures the exact request as a durable source, proposes a governing
intent, and decides whether the result is one bounded story, a multi-story
feature, or a larger initiative. It does not invent a fictional PRD or BRD.

#### PRD

Use a repository-owned file for product requirements:

```text
/harness:run "Deliver requirements/payments-prd.md"
```

PRD intake preserves the immutable source, performs source-grounded SPDD
analysis, completes the REASONS Canvas, then proposes product and solution
checkpoints. The original PRD remains authoritative.

#### Direct BRD

An already reviewed, sufficiently bounded BRD can enter directly:

```text
/harness:run "Deliver requirements/refunds-brd.md" --from brd
```

The product checkpoint makes the direct-BRD rationale and sufficiency checks
explicit. Ambiguous business requirements are not silently promoted.

#### Epic or feature

Use a feature or epic when the outcome is known but decomposition is not:

```text
/harness:run "Deliver the account notification-preferences feature"
```

The product checkpoint shows epics, INVEST-sized stories, estimates,
dependencies, critical path, and proposed allocation clusters. Allocation is a
human decision; the harness does not assign engineers automatically.

#### User story

A bounded story can start close to implementation:

```text
/harness:run "Implement requirements/US-142.md" --from story
```

The harness checks actor, observable outcome, acceptance criteria, scope,
dependencies, affected surfaces, and material risks. It fills only missing
design, test, and traceability contracts. If the story contains several
independently deliverable outcomes, it proposes promotion to a feature for human
review instead of rewriting it silently.

#### Issue, bug, or defect

```text
/harness:run "Fix issue #381"
```

The route begins with reproduction and expected behaviour, then creates a
bounded governing intent, regression test, implementation, independent review,
sensors, and verification. Do not stack speculative fixes when the defect has
not been reproduced.

#### Existing ungoverned changes

Use the re-entry route after exploratory or vibe coding:

```text
/harness:run "Bring the current diff into the harness and verify it" --from diff
```

The harness runs sensors first, records the governing intent, examines the
actual diff, and reconstructs missing tests and evidence. Existing code is not
treated as proof that the intended behaviour is correct.

### Stop at an intermediate SDLC stage

Not every run needs to write code. State the stopping point naturally or use
`--through`:

```text
/harness:run "Turn requirements/payments-prd.md into an approved backlog; do not code"
/harness:run "Design US-142 but do not implement it" --through design
/harness:run "Create traceable test cases for US-142" --through tests
/harness:run "Deliver US-142" --through draft-pr
```

Supported targets are:

| Target | Result |
| --- | --- |
| `brief` | Grounded intent and open decisions |
| `backlog` | Approved epics, stories, estimates, and dependency order |
| `design` | Approved structural design and measurable budgets |
| `tests` | Approved strategy, cases, data, and traceability |
| `implementation` | Code and focused tests, without readiness claim |
| `verified` | Story and branch verification evidence |
| `draft-pr` | Verified readiness for a draft PR; never merge or deployment authority |

### Choose the interaction mode

#### Checkpoint mode — default

Checkpoint mode minimizes interruptions while keeping product and architecture
decisions human-owned:

```text
Product checkpoint -> Solution checkpoint -> Story execution -> Readiness
```

- Product combines G0 and G1: source meaning, scope, stories, and dependencies.
- Solution combines G2, G3, and G4: tests, design, contracts, and traceability.
- Readiness summarizes implementation, independent review, sensors, and pre-PR
  verification.

Each combined approval is atomic. If one constituent gate is incomplete, no
partial approval is recorded.

#### Guided mode

Use guided mode for unfamiliar domains, substantial ambiguity, or when the team
wants to inspect each decision in detail:

```text
/harness:run "Deliver requirements/payments-prd.md" --mode guided
```

The harness presents the individual gate sessions and returns whenever a
material product, test, architecture, security, privacy, migration, public API,
or performance decision is required.

#### Unattended mode

Use unattended mode only after the solution and story contracts are already
human-approved:

```text
/harness:run "Deliver approved story US-142" --mode unattended
```

Unattended means autonomous execution inside an approved envelope. It does not
allow the agent to approve product meaning, architecture changes, security
exceptions, merge, or deployment. If required approvals are missing, the
harness prepares the missing checkpoint and stops.

### Review a checkpoint

Checkpoint proposals lead with the decision, recommendation, alternatives,
risks, open questions, and evidence summary. Detailed JSON remains available as
an appendix. Respond plainly:

```text
Approve the product checkpoint.
```

or:

```text
Revise the solution: retain exports for 24 hours, not seven days.
```

Approved artifacts are immutable. A later intent change creates a linked
amendment, supersedes affected artifacts, and reopens the relevant gates.

### Follow progress and resume safely

Use the human-facing status command at any time:

```text
/harness:status
```

The default view shows:

- active change and branch;
- requested outcome, route, and mode;
- product and solution checkpoint progress;
- verified story count;
- current blocker and required human action;
- the next action recomputed from durable evidence.

For operational detail, ask for full status or run:

```sh
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-status.js" . --full
```

Resume after compaction, a closed terminal, or a stopped session with:

```text
/harness:run "Continue"
```

If several changes are active, identify one explicitly:

```text
/harness:run "Continue" --change PAYMENTS-EXPORT
```

Resume derives the next step from recorded gates, story ratchets, verification,
and readiness evidence. A cached narrative is never treated as authoritative.

### Greenfield and brownfield routes

Greenfield initiatives normally follow:

```text
source -> product checkpoint -> solution checkpoint -> story ratchets
       -> pre-PR verification -> independent branch review -> draft PR readiness
```

An existing repository adds the smallest sufficient discovery work:

```text
B0 baseline health -> B1 bounded code map -> B2 reuse-first change strategy
```

The harness should reuse a fresh, approved brownfield map when possible. It
does not broaden a one-story change into repository-wide discovery merely
because the surface is security-sensitive.

### What the harness creates

| Location | Purpose |
| --- | --- |
| `.claude/specs/source/` | Immutable captured inputs |
| `.claude/specs/intents/` | Governing intent for idea/feature/story/issue routes |
| `.claude/specs/epics/`, `stories/`, `dependencies/` | Approved delivery decomposition |
| `.claude/specs/design/`, `architecture/` | Design decisions and evolution rules |
| `.claude/specs/test-*` | Test data, cases, and plans |
| `.claude/specs/plans/`, `traceability/` | Executable story contracts and requirement/test links |
| `.claude/specs/evidence/`, `reviews/` | Real command evidence and independent verdicts |
| `.claude/state/stories/` | Mutable ratchet state; never evidence by itself |
| `.claude/specs/index.json` | Source, relationship, approval, and active-work ledger |

### Common operating examples

```text
# Small existing-system story
/harness:run "Implement requirements/US-142.md"

# Multi-story feature with normal checkpoints
/harness:run "Add account-level invoice exports"

# Full PRD but stop before implementation
/harness:run "Prepare requirements/payments-prd.md through tests; do not code"

# Existing-system refactor with no intended behaviour change
/harness:run "Refactor the invoice parser without changing behaviour"

# Verify manually edited code
/harness:run "Govern and verify the current diff" --from diff

# Continue an interrupted delivery
/harness:run "Continue"
```

### Troubleshooting

- **No named feature branch:** switch off `main`, `master`, or `develop` before
  specification or implementation writes.
- **PRD/BRD supplied only in chat:** save or identify the authoritative project
  file; conversation summaries are not accepted as those source types.
- **Checkpoint not ready:** correct the named missing or invalid constituent
  artifacts and regenerate the checkpoint. Do not approve gates individually
  merely to bypass the combined validation.
- **Unattended mode refuses to start:** approve the missing G4 execution
  contract or use checkpoint/guided mode.
- **Several active changes:** resume with `--change <id>`.
- **Stale sensor or verification evidence:** rerun the named command against the
  current workspace; timestamps without matching hashes do not establish
  freshness.
- **Required verification is unconfigured:** configure the real repository
  command in `.claude/verification.json`. Required placeholders fail closed.

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
`/harness:retro` to review repeated failures and
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
  templates/project/      # target scaffold
  docs/                   # operating model, implementation, release, roadmap
  release/                # synthetic matched release scorecard
```

Repository-owned tests live outside the shipped plugin: `tests/unit/` contains
the deterministic contract and negative-path suite, while `tests/e2e/` contains
the opt-in full-SDLC fixture and runner.

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

Run the deterministic suite with:

```sh
node --test tests/unit/*.test.js
```

For a manual-style black-box exercise of the full README journey—small PRD to a
simulated draft PR, followed by a second feature to another simulated draft
PR—use [`tests/e2e/`](tests/e2e/README.md). It invokes the real Claude CLI and is
therefore opt-in and quota-consuming.

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
human can authorize rollout. Prefer subtraction via `/harness:retro` when
controls stop paying rent.

See [the improvement plan](.claude/docs/v1-improvement-plan.md),
[production sensor-system design](.claude/docs/production-sensor-system.md),
[operating model](.claude/docs/harness-operating-model.md), and
[release guide](.claude/docs/release.md).

Production sensors are activated through plugin-level Claude Code hooks:
file-edit events schedule debounced checks, while Stop, TaskCompleted, and the
generator's SubagentStop fail closed on missing, stale, or blocking evidence.
Scripts stored under `.claude/scripts` are not considered active by themselves.
