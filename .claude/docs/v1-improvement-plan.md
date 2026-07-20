# V1 improvement plan — minimal expert-generalist harness

**Status:** living roadmap (revised 2026-07-20)
**Product:** Claude Code plugin under `.claude/`
**Doctrine:** humans steer intent; agents execute approved slices; the harness is an outer control layer, not another coding agent.

---

## 0. Why this rewrite

Two truths drive the plan:

1. **`claude_harness_eng_v5` became too large.** ~49 skills, ~10 agents, ~12+ hook surfaces, ~138 scripts (~19.5k LOC in scripts alone), and a growing gap ledger (G1–G36). Simplification proposals executed and **still grew** because every industry article was treated as a case to *add* a control, with no subtractive ratchet on the harness itself.
2. **`claude_code_harness_x_v1` is the right reaction**, but it is not yet the finished product. The lean tree is ~146 files / ~4.6k JS LOC, three public delivery skills, three agents, one safety hook, and a deterministic contract spine. That spine is **mostly real**. The remaining risk is that we re-grow v5 by filling every conceptual box before real pilots prove value.

This plan keeps the lean shape, hardens co-design and story execution, and forbids complexity that does not pay rent.

The proposed post-v1 extension for governed PRD-to-SPDD intake, backlog
estimation and clustering, requirements/test traceability, conditional browser
E2E, optional tracker projection, and optional draft-PR publication is recorded
in [the SDLC pipeline implementation plan](sdlc-pipeline-implementation-plan.md).
Those phases are proposals, not approved scope; each must earn adoption through
its own tests, control-budget review, and real-pilot decision.

---

## 1. Outcome

Build a **minimal Claude Code harness** that behaves like an **expert generalist engineer**:

| Layer | Responsibility |
| --- | --- |
| **Base craft** | TDD, debugging, cohesion, dependency direction, pragmatic SOLID/OO, DDD boundaries, refactoring, measured performance |
| **Language add-ons** | Path-scoped Python, TypeScript/React (thin guides + sensors) |
| **Framework add-ons** | Optional FastAPI, LangChain, LangGraph, Deep Agents, Google ADK — loaded only when signals match |
| **Outer control** | Spec packages, human gates, story ratchet, sensors, cost routing, draft-PR readiness |

Two loops only:

```text
1. Co-design loop   (human-gated; no product code)
2. Story ratchet    (agent executes; sensors + independent validator)
```

Out of scope forever for this product: dashboard, scheduler, fleet, automatic merge, deploy orchestrator, general workflow engine, Linear/Jira platform, multi-SKU packaging, and “gap G1–G36” ledgers.

---

## 2. Industry synthesis (what we keep)

### 2.1 Fowler — harness engineering + sensors + humans on the loop

- **Guides (feedforward)** + **sensors (feedback)** regulate maintainability, architecture fitness, and behaviour.
- Prefer **computational** sensors (tests, lint, types, boundaries) for every story; use **inferential** review only where semantics matter.
- Sensors must be **agent-consumable** (status, path, reason, correction).
- Humans improve the **harness**, not every line of code: escaped defect → smallest guide/sensor → measure → promote or remove.
- Behaviour is still the hard part: **approved tests + hermetic runs + local smoke** beat “AI tests are green.”

### 2.2 SPDD + “what is code” + DSLs

- Specs are **structured, versioned, linkable** artifacts (not chat transcripts).
- A thin **artifact DSL** (JSON schemas + traceability IDs) makes the agent legible and non-hallucinatory between BRD → story → test → design → code → evidence.
- The DSL is for **control and grounding**, not for inventing a new programming language.

### 2.3 OpenAI Codex harness (“humans steer, agents execute”)

- Progressive disclosure: short map (`CLAUDE.md` / `AGENTS.md`) → deeper `docs` / specs.
- Repository is system of record; what the agent cannot open does not exist.
- **Enforce architecture mechanically** (boundaries, sizes, contracts); leave local style free.
- Plans and evidence are first-class; garbage-collection of drift is continuous and small.
- Keep **blocking merge gates thin**; corrections are cheaper than waiting — **but** we still refuse merge/deploy automation and protected-branch writes.

### 2.4 Anthropic — long-running agents

- Initializer vs incremental worker pattern → our **G0–G4 co-design** then **one-story ratchet**.
- Feature list with pass flags → **story contracts + index.json**.
- Clean checkpoint each session (git + progress) → **feature branch + STORY_VERIFIED evidence**.
- Do not one-shot the product; do not declare victory early.

### 2.5 Stripe Minions

- Deterministic blueprint nodes + bounded agent loops.
- Path-scoped rules; **relevant local checks before CI**.
- Cap repair rounds (we keep **one automated repair**).

### 2.6 Devin / Cognition

Keep the product ideas; do **not** rebuild Devin:

| Devin practice | Lean harness mapping |
| --- | --- |
| Plan / collab before long autonomy | Human-gated co-design (G0–G4 / B0–B2) |
| Sandboxed tools + branch isolation | Feature branch only; plugin safety hook; worktree optional later |
| Self-verification + autofix | Sensors + one repair + independent evaluator |
| Browser / desktop E2E | Project-owned smoke journeys in `verification.json` (optional Playwright later) |
| Pre-agreed test plan reduces drift | Gate G2 approved before coding |
| **Fusion sidekick** | Sonnet generator + deterministic routing; strong Opus evaluator for risk/branch; no multi-model product fleet |
| Status / watch / timeline | `/harness-status` only |

Fusion insight to retain: **delegate bounded packets**, keep lead on plan/ambiguity/final review, measure **accepted story quality vs cost**, not $/token alone. A true parallel sidekick process is optional P6+ and must beat simple routing in pilots.

### 2.7 Graphify / CCE / Headroom

- Graphify/CCE = **retrieval adapters**, not a second runtime owned by the harness.
- Headroom-like compression applies only to **verbose tool output**, never to requirements, approvals, invariants, or expected results.
- Brownfield default: graph/map first; grep is fallback with a recorded gap.

---

## 3. Claude Code: use the platform, do not reimplement it

Official extension model ([features overview](https://code.claude.com/docs/en/features-overview)): CLAUDE.md, skills, subagents, hooks, MCP, plugins, code intelligence. Match **one concern to one primitive**.

| Concern | Primitive | Lean rule |
| --- | --- | --- |
| Always-on project map | Root `CLAUDE.md` + short target `CLAUDE.md` | ≤ ~80–120 lines; progressive disclosure only |
| Path-scoped conventions | `.claude/rules/` or profile guides | Load by path/signal, not every session |
| User-facing workflow | Skills with `disable-model-invocation: true` | Public: `/harness`, `/harness-status`, `/harness-retro` only |
| Internal procedure | Skills `user-invocable: false` or scripts | Co-design steps live *inside* `/harness`, not 20 slash commands |
| Isolated implement | Subagent `harness-generator` (Sonnet) | Fresh context; no self-advance of ratchet |
| Isolated validate | Subagent `harness-evaluator` (Opus, read-only) | Never sees generator narrative as authority |
| Cheap ordinary validate | `harness-evaluator-fast` (Haiku) | **Off** until matched pilots promote it |
| Hard enforcement | Hooks (command) | Only destructive-Git + (later) optional secret-on-write; never 13 hooks/edit |
| Verification gate | Deterministic scripts + Stop/`/goal` later | Prefer script evidence over “agent says pass” |
| External systems | MCP | Optional; project-owned; not core plugin |
| Large monorepo nav | Code intelligence / LSP plugins | Prefer over broad Grep |
| Parallel research | Built-in Explore / Plan | Use platform agents; do not ship a fourth research agent |
| Cost | Model fields + routing.json | Deterministic first; Sonnet implement; Opus risk/branch |
| Packaging | Plugin under `.claude/` | `claude --plugin-dir …/.claude` |

**Anti-patterns to refuse**

- Rebuilding Claude Code’s agent loop, permission system, or session store.
- Promoting every pipeline step to a user command (v5 failure mode).
- Hooks that re-lint the whole monorepo on every Edit.
- Inferential judges at six ceremony points.
- Shipping framework encyclopedias into every context.

---

## 4. Repository and target layout

### 4.1 Plugin repository (this repo)

```text
README.md                 # install + public surface
CLAUDE.md                 # progressive-disclosure map only
.claude/                  # entire plugin
  .claude-plugin/plugin.json
  skills/
  agents/
  hooks/
  scripts/                # thin CLIs
  lib/                    # contracts
  tests/
  templates/project/      # target scaffold
  docs/                   # operating model + this plan
```

### 4.2 Target project (after harness-init)

All harness-managed artifacts stay under the target’s `.claude/`. **No root `specs/`.**
(If a team wants a short root pointer, it may link to `.claude/specs/`; the system of record is always under `.claude/`.)

```text
CLAUDE.md                 # short map only
.claude/
  harness.yaml
  verification.json       # project-owned commands + doubles + budgets
  routing.json
  harness-manifest.json   # guide/sensor inventory + control budget
  project/                # architecture, boundaries, reference patterns
  profiles/               # language/framework guides + sensors
  domains/                # optional domain packs
  specs/                  # grounded delivery artifacts (below)
  state/                  # mutable ratchet/context; never proof
```

### 4.3 Spec packages (grounded, linked)

Every change gets a stable `change_id`. Packages are separate **and** linked through `index.json`:

```text
.claude/specs/
  index.json              # source → epic → story → test → design → code → evidence → review
  source/                 # immutable BRD/PRD snapshot + hash
  brd/  prd/
  epics/
  stories/
  dependencies/           # DAG + sequencing rationale
  test-data/
  test-cases/
  test-plans/
  design/                 # module/folder structure, components
  architecture/           # boundaries, ADRs, NFRs, performance budgets
  plans/                  # G4 story contracts
  evidence/
  reviews/
  brownfield/             # graph export, maps, strategy
  amendments/
```

Every artifact carries provenance:

```yaml
id:
source_ids: []
source_locations: []
derived_from: []
status: draft | approved | superseded
assumptions: []
open_questions: []
human_approver:
approved_at:
content_hash:
```

**Grounding rules**

- Original BRD/PRD (or content hash + durable reference) is immutable under `source/`.
- No silent promotion of assumptions to requirements.
- Missing info that changes behaviour/security/architecture → **stop and ask**.
- Approved artifacts are amended/superseded, never silently rewritten.
- Coding agent may not invent acceptance criteria after G2 approval.

---

## 5. Greenfield: co-design then ratchet

Co-design is **Superpowers-style**: agent drafts; human revises; explicit approval recorded. No product code before G4.

```text
G0 source + interpretation
 → G1 epics, stories, dependency DAG
 → G2 test strategy, cases, data (with doubles)
 → G3 architecture + design + folder structure + perf budgets
 → G4 executable story contracts
 → story ratchet (per story)
 → pre-PR local engineer simulation
 → independent branch review
 → draft PR only
```

### G0 — Safe workspace and intake

1. Feature branch required. **Refuse** writes of specs or product code on `main` / `master` / `develop`.
2. Capture BRD/PRD under `specs/source/` with hash.
3. Grounded summary: outcomes, actors, scope, constraints, rules, NFRs, gaps, contradictions.
4. Human approves interpretation.

### G1 — Epics, stories, dependencies

Agent proposes vertical stories with source-linked acceptance criteria, in/out scope, DAG, critical path, assumptions.
Human may split/merge/reorder/reject. **No design coding until approved.**

### G2 — Tests before code

For each story: acceptance examples, edge cases, unit/integration/contract/system coverage, synthetic data, expected results, boundary doubles (DB, HTTP, LLM, embeddings, queue, clock, FS, identity), failure/auth scenarios, performance budgets where relevant.
Human approves plans/cases/data. Expected results are **immutable** without amendment.

Terminology:

- **Hermetic system/regression** = all external boundaries doubled. Not proof of real integrations.
- **Local smoke** = start app with safe local adapters; exercise public API/CLI/UI/event seams.
- **PostgreSQL**: ephemeral Postgres (or contract tests) when Postgres semantics matter; in-memory only with explicit “Postgres semantics not under test” statement.

### G3 — Architecture and design co-design

Propose alternatives for context, domain model, folder/module structure, contracts, dependency direction, ports/adapters, errors/retries/idempotency, security, observability, deploy assumptions, performance budgets/hotspots, testability.
Human selects. Folder structure is an **approved design artifact**.

**Structural alternatives (required, stack-agnostic):** every architecture
artifact must present `clone-vertical`, `shared-modules`, and
`parameterized-spine`, then `selected_alternative_id` + `selection_rationale`,
plus `second_slice_reuse_policy` and `evolutionary_rules`. Technology choice
is subordinate to structural shape. Enforced by `lib/design-evolution.js` on
proposal/approve.

### G4 — Story contracts

Compact contract per story: sources, design refs, deps, allowed change scope, AC, test IDs, sensors, budgets, human decisions, **`implementation_posture`**, **`reuse_targets`**. Only dependency-ready stories enter the ratchet. Dependent stories cannot use `first-slice`; reuse/extract postures need targets; divergence needs justification.

### Story ratchet

```text
READY → RED_TEST → IMPLEMENT → STORY_REVIEW → FAST_SENSORS → STORY_VERIFIED
```

1. Re-read contract + referenced context only (budgeted pack).
2. Confirm deps + feature branch.
3. Smallest failing public-seam test; record red evidence.
4. Smallest passing change; stay in `allowed_change_scope`.
5. Refactor only while green.
6. Fresh-context read-only evaluator → `pass` | `revise` | `human-decision-required`.
7. One evidence-backed repair max; then human.
8. Fast sensors; checkpoint only coherent verified stories.
9. Prefer reuse of local canonical patterns; no speculative frameworks.

**Performance:** “optimal” is not a slogan. Use approved budgets (latency/CPU/allocations/query count as relevant), measure in pre-PR, reject silent regressions.

---

## 6. Brownfield: map before change

```text
B0 baseline health
 → B1 code graph + maps (bounded)
 → B2 reuse/change strategy + design amendment
 → G1–G4 (or thin story set)
 → same story ratchet
 → hermetic regression + smoke
 → draft PR
```

- **B0:** existing build/test/lint/type/security; do not blame the change for pre-existing red.
- **B1:** deterministic graph (AST/LSP + optional Graphify/CCE adapter export), module/API/test maps, hotspots, impact, canonical reuse candidates. **Open cited source before claiming.**
- **B2:** smallest seam, reuse first, duplication risk, characterization tests, compatibility, migration/rollback, regression scope. Generalize only with ≥2 real uses.

---

## 7. Sensors and local engineer simulation

### Cadence (minimal catalog)

| Cadence | Examples |
| --- | --- |
| **Story-fast** | format/lint, types, focused tests, secret scan, changed-path boundaries, fixture protection, story traceability |
| **Pre-PR** | full unit, hermetic integration, hermetic system regression, public-seam smoke success/failure, build, SAST/deps/secrets, contract drift, perf budgets, branch review |
| **Scheduled** | drift, dead code, dependency freshness, doc freshness — only if pilots show value |

Fowler’s maintainability sensors start with built-in **file-size** (blocking over
max lines) and **near-duplication** (default warn) via `lib/maintainability-sensors.js`
and `.claude/project/maintainability.json`. Heavier complexity/coverage sensors
stay profile-scoped, not a permanent global firehose.

### Pre-PR “human engineer locally”

1. Feature branch + known changed paths.
2. Install/build via project commands.
3. Start app with safe local config when smoke is declared.
4. Success + relevant failure journeys on public seams.
5. Pre-PR sensors + hermetic suites.
6. Performance vs budgets.
7. Independent branch reviewer.
8. One evidence report.
9. **Draft PR only** — never merge/deploy.

---

## 8. Cost and context control

| Work | Default |
| --- | --- |
| lint/type/test/graph extract | deterministic, no model |
| context packing / routing decision | deterministic scripts |
| ordinary implementation | Sonnet sidekick (`harness-generator`) |
| ordinary story validation | Haiku only after promotion; else Opus |
| security, privacy, domain, public contract, migration, architecture, performance, branch review | Opus (`harness-evaluator`) |

Rules:

- Pack **complete bounded packets**; do not thrash with tiny calls.
- Never compress: requirements, approvals, invariants, expected results.
- May excerpt: verbose logs/tool output with hash + line provenance.
- Record cost only from provider/session receipts; never invent tokens.
- Observed spend ceilings stop routing; do not claim provider enforcement unless true.

Optional later: true Fusion-style parallel sidekick with separate cached context. **Not required for v1.** Prove routing + budgets first.

---

## 9. Human-on-the-loop governance

Humans approve: interpretation, stories/deps, tests/data, architecture/design, domain rules, security/privacy/migration/perf policy, model-cost policy, amendments.

Agents: execute approved work, produce evidence, surface ambiguity, propose harness improvements via `/harness-retro`.

Harness improvement loop:

```text
recurring failure
  → propose smallest guide or sensor
  → human approves experiment
  → measure correction, precision, latency, review value, cost
  → promote, tune, or remove
```

**Control budget (anti-v5):** every new guide/sensor/skill/hook must either replace an existing control or carry a written `net_add_justification` in `harness-manifest.json`. `/harness-retro` may nominate zero-fire or high-noise controls for removal. No new public slash command without removing one or proving pilot demand.

---

## 10. Public surface (frozen)

| Command | Role |
| --- | --- |
| `/harness` | intake → co-design → ratchet → verify → draft PR readiness |
| `/harness-status` | phase, approvals, story state, next action |
| `/harness-retro` | harness improvement proposals (human-controlled) |

`harness-operations` remains maintainer-only (init, validate, sensors, upgrade, release).

---

## 11. Honest evaluation of the current codebase

### 11.1 What is aligned (keep)

| Area | Evidence |
| --- | --- |
| `.claude` plugin boundary | plugin.json, skills, agents, hooks under `.claude/` |
| Progressive disclosure | short root CLAUDE.md + README |
| Spec packages + gates | `lib/specifications.js`, `harness-specs.js`, template packages |
| Protected branch | feature-branch binding for specs/code |
| Brownfield map contract | `harness-brownfield.js` + adapter example |
| Story ratchet state machine | `lib/story-ratchet.js` + CLI |
| Generator / evaluator split | Sonnet implement, Opus read-only evaluate, fast evaluator gated |
| Verification contract | project `verification.json` + runner |
| Routing + context budgets | `routing-policy`, `context-budget`, receipts |
| Profiles | thin language/framework guides under templates |
| Tests | ~29 Node test files for contracts |
| Size | ~1/10 of v5 scripts surface |

### 11.2 Gaps vs this vision (fix next)

| Gap | Risk | Minimal fix |
| --- | --- | --- |
| **Co-design UX is CLI-ledger heavy** | Feels less like Superpowers interactive co-design | In `/harness`, present artifact **proposals as reviewable diffs/markdown**, then one `approve` per gate; optional AskUserQuestion for open questions |
| **Graphify/CCE/Headroom are adapters only** | Plan over-promises navigation | Ship thin import for Graphify-shaped JSON; document install-optional; never vendor graph engines |
| **Sensors catalog incomplete vs Fowler article** | Maintainability sensors may be stubs/profile-empty | Start with lint/type/test/boundary/secret; add complexity/duplication only when a pilot fails without them |
| **True local smoke / app drive** | Hermetic green ≠ “ran the app” | Require `verification.json` smoke commands; use Claude Code `/run`/`/verify` patterns where project has a run skill |
| **Performance discipline** | Not enforced as first-class | Budgets on G3 + pre-PR measurement mandatory when declared; default “no budget claimed” |
| **Expert-generalist base skill depth** | Engineering core may be thin relative to ambition | One skill with progressive references (TDD, refactoring, DDD ports), not seven micro-skills |
| **Control budget not enforced** | Path back to v5 | Manifest count + net-add justification in validate |
| **Live E2E pilot evidence** | P7 synthetic only | P8 real pilots before calling the product “done” |
| **DSL incomplete** | Hallucination risk between packages | Keep JSON schemas + index link checks; add markdown human views generated from JSON if needed |
| **Fusion-level multi-model** | Overbuild | Defer parallel sidekick; keep routing table |
| **Hooks too thin for secrets-on-write** | Secrets can land before review | Optional PreToolUse secret scan on Write/Edit content only — single hook, not a tower |
| **Agent frontmatter vs plugin limits** | Plugin agents ignore hooks/mcpServers/permissionMode | Keep enforcement in scripts + skill-scoped safety hook |

### 11.3 Relative to OpenAI Codex harness article

Aligned: progressive disclosure, repo as SoR, architecture fitness, plans, agent-legible feedback, humans on systems not lines.
Intentionally **not** aligned: zero human code policy, auto-merge, “minimal merge gates,” multi-hour unattended product ownership. We optimize for **human-gated product meaning** with **agent-executed stories**.

### 11.4 Relative to v5 `/auto` ratchet

Keep: story-group ratcheting, independent evaluator, TDD red/green, draft PR.
Drop: multi-lane command explosion, attestation/platform provisioning, PE vertical as core, telemetry stack as default, agent teams by default, 36-gap doctrine.

---

## 12. Implementation phases (minimal sequence)

Phases are **thin vertical slices**. Do not start the next phase until the previous has a canary or pilot note.

### M0 — Freeze the shape

- [x] Plugin root = `.claude/`
- [x] Public skills = 3 (+ operations)
- [x] Agents = 3
- [x] One destructive-Git hook
- [x] **Control budget** in `harness-manifest.json` + `validateControlManifest` (`max_active`, `baseline_ids`, net-add `net_add_justification` / `replaces`)
- [x] No new public slash command (proposal is a CLI under existing specs tool)

### M1 — Grounded co-design UX

- [x] Spec packages + sequential G0–G4 / B0–B2
- [x] `harness-specs.js proposal --change --gate [--write] [--markdown-only]` human-readable pack
- [x] **G3 design-session proposal UX** — narrative alternatives + selection + second-slice policy + human checklist before JSON appendix (`renderG3DesignSession`)
- [x] **G0/G1/G2/G4 (+ B0–B2) proposal sessions** — gate-specific narrative + checklist (`lib/proposal-sessions.js`)
- [x] **Upgrade merge** — `harness-upgrade.js --apply` creates missing files + merges maintainability baseline controls into existing manifests (`lib/harness-upgrade.js`)
- [x] Open questions and assumptions surfaced as attention (not silent)
- [x] Planning-only canary exercised (G0–G1 proposal → approve on feature branch)
- [x] Extend co-design through G4 in the lived canary (`harness-lived-canary.js`)

**Exit (met):** human can review grounded packs linked to source; G0–G4 proposal+approve is exercised in CI via the lived canary.

### M2 — Story ratchet that feels like an engineer

- [x] RED → implement → independent review → fast sensors → verify (state machine)
- [x] Generator/evaluator never self-advance state
- [x] One repair cap + scope guard on git paths
- [x] **Lived canary** runs real `node --test` for red and green evidence (`lib/story-evidence.js`, `lib/lived-canary.js`, `scripts/harness-lived-canary.js`)
- [x] **Multi-story evolution canary** story-1 `first-slice` → story-2 `reuse-existing`; dependent `first-slice` blocked (`runMultiStoryEvolutionCanary`, `scripts/harness-multi-story-canary.js`)
- [x] Wired into `harness-release-check.js`

**Exit (met):** one fixture story completes with **executed** test commands, not invented exit codes.

### M3 — Sensors + local simulation

- [x] Project `verification.json` required pre-pr kinds (contract)
- [x] Hermetic unit/integration/system + smoke + perf budgets
- [x] Normalized report + `agent_summary.corrections` for self-correction
- [x] Branch finalize → `ready-for-draft-pr` only
- [x] Pre-PR **fail-closed** when required kinds are unconfigured (`assertCadenceConfigured`)
- [x] Nested `node --test` isolation in verification runners
- [x] Lived canary runs real story-fast + pre-PR + readiness after TDD

**Exit (met):** pre-PR refuses unconfigured required checks; lived fixture reaches draft-PR readiness with executed commands.

### M4 — Brownfield map without owning Graphify

- [x] Bounded map CLI + provenance labels (`buildCodeMap`)
- [x] Optional adapter import with strict provenance (`validateAdapterExport` / Graphify-shaped JSON)
- [x] Reuse / canonical / duplication candidates + `proposeChangeStrategy`
- [x] B0–B2 gates in specifications
- [x] Lived brownfield canary: adapter map → reuse strategy → TDD reuse of existing helper → draft-PR readiness (`harness-brownfield-canary.js`)

**Exit (met):** canary fails if strategy omits required reuse; implementation must call existing `normalizeTitle` rather than re-copy trim logic.

### M5 — Expert-generalist profiles (thin)

- [x] One engineering-core skill with progressive `references/` (TDD, design, DDD, refactoring, performance)
- [x] Path/content-signal profile loader (`resolveProfiles`)
- [x] Frameworks require signals or configured hint; never extension-only
- [x] Framework fan-out capped (`max_framework_profiles`, default 2) with `dropped_frameworks`
- [x] `harness-profile-context.js` returns `engineering_core` + ordered guides
- [x] Template path_signals for FastAPI, React, LangGraph, LangChain, Deep Agents, Google ADK

**Exit (met):** plain language paths load language only; wrong framework stays out without signals/hint.

### M6 — Cost routing + context packs

- [x] Routing table (`routing.json`) + `decideRoute` / `harness-routing.js decide`
- [x] Protected context classes never compressed (`source-requirement`, approvals, invariants, expected tests)
- [x] Tool-output compression with hash + line provenance only
- [x] Provider receipts only (`recordUsage`); fabricated receipts rejected
- [x] Receipt-observed ceilings stop further model routing
- [x] Haiku evaluator off until human-enabled matched quality comparison
- [x] Strong risks + branch review never downgrade even after promotion
- [x] Lived routing canary (`harness-routing-canary.js`)

**Exit (met):** security/branch review always strong; economical path only for ordinary validation after promotion.

### M7 — Pilot, subtract, release

- [x] Matched synthetic canaries (lived, brownfield, routing, P7) in release-check
- [x] Pilot ledger + policy thresholds (`harness-pilot.js`, `pilot-policy.json`)
- [x] Measures: first-pass acceptance, human review minutes, escaped defects, sensor precision/correction, provider cost/story, brownfield graph usefulness
- [x] Subtractive proposals (`harness-subtract.js` / `proposeControlSubtractions`) — **never auto-applied**
- [x] M7 scorecard (`harness-m7-scorecard.js`) aggregates synthetic + pilot + subtraction
- [x] Statuses: `insufficient-evidence` | `hold` | `eligible-for-human-rollout-decision`
- [x] `decision_authority: human` always; harness never merges or self-promotes

**Exit (met for harness engineering):** synthetic path is release-gated; real pilot rollout is a separate human process. Product teams record ≥3 greenfield + ≥3 brownfield pilots before any human expansion decision.

---


## 13. Sequence diagram (operator view)

```text
                    HUMAN                         HARNESS / AGENT
                      |                                    |
                      |-- BRD/PRD ------------------------>|
                      |                                    |-- feature branch
                      |                                    |-- capture source hash
                      |<-- G0 interpretation --------------|
                      |-- approve G0 --------------------->|
                      |<-- G1 stories + DAG ---------------|
                      |-- approve G1 --------------------->|
                      |<-- G2 tests + data ----------------|
                      |-- approve G2 --------------------->|
                      |<-- G3 design + architecture -------|
                      |-- approve G3 --------------------->|
                      |<-- G4 contracts -------------------|
                      |-- approve G4 --------------------->|
                      |                                    |-- for each story:
                      |                                    |     red test → implement
                      |                                    |     evaluator → sensors
                      |                                    |-- pre-PR verify + branch review
                      |<-- draft PR readiness -------------|
                      |-- human merges (outside harness) --|
```

Brownfield inserts B0–B2 (and graph) **before** G1.

---

## 14. What “minimalistic” means operationally

1. **Three public skills.** Everything else is internal.
2. **Two loops.** Co-design and story ratchet.
3. **One ratchet state file per story.** No workflow server.
4. **One safety hook by default.** Add hooks only for proven irreversible harm.
5. **Deterministic first.** Models do not replace lint/test/graph extract.
6. **Profiles over plugins-of-plugins.** Framework knowledge is optional files, not new agents.
7. **Adapters over engines.** Graphify/CCE/Headroom remain external tools with import contracts.
8. **Control budget.** Adds require removals or written net-add justification.
9. **Pilot truth over synthetic green.** Release claims need human evidence.
10. **Claude Code does the agenting.** We supply contracts, guides, sensors, and gates.

---

## 15. References

### Industry

- [Harness engineering for coding agent users](https://martinfowler.com/articles/harness-engineering.html)
- [Maintainability sensors for coding agents](https://martinfowler.com/articles/sensors-for-coding-agents.html)
- [Humans and agents in software engineering loops](https://martinfowler.com/articles/exploring-gen-ai/humans-and-agents.html)
- [Structured-Prompt-Driven Development](https://martinfowler.com/articles/structured-prompt-driven/)
- [What is code?](https://martinfowler.com/articles/what-is-code.html)
- [DSLs enable reliable use of LLMs](https://martinfowler.com/articles/llm-and-dsls.html)
- [OpenAI harness engineering](https://openai.com/index/harness-engineering/)
- [Stripe Minions](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents)
- [Anthropic: effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Cognition: Devin Fusion](https://cognition.com/blog/devin-fusion)
- [Cognition: Devin 2.2 self-verification](https://cognition.com/blog/introducing-devin-2-2)
- [Headroom](https://github.com/cwijayasundara/headroom)
- [Code Context Engine](https://github.com/cwijayasundara/code-context-engine)
- [Graphify](https://github.com/Graphify-Labs/graphify)

### Claude Code platform

- [Overview](https://code.claude.com/docs/en/overview)
- [Extend Claude Code (features overview)](https://code.claude.com/docs/en/features-overview)
- [Skills](https://code.claude.com/docs/en/skills)
- [Subagents](https://code.claude.com/docs/en/sub-agents)
- [Hooks guide](https://code.claude.com/docs/en/hooks-guide)
- [Best practices](https://code.claude.com/docs/en/best-practices)
- [Memory / CLAUDE.md](https://code.claude.com/docs/en/memory)
- [Costs](https://code.claude.com/docs/en/costs)
- [Plugins](https://code.claude.com/docs/en/plugins)

### Internal lessons

- `claude_harness_eng_v5` docs: `HARNESS_SIMPLIFICATION_2026-07-17.md`, `SIMPLIFICATION_PROPOSAL.md` — **additive controls without a subtractive ratchet lose.**

---

## 16. Decision record (2026-07-19)

| Decision | Choice |
| --- | --- |
| Spec location | `.claude/specs/<package>/` only (not repo-root `/specs`) |
| Public surface | `/harness`, `/harness-status`, `/harness-retro` |
| Greenfield ceremony | Human-gated G0–G4 co-design before any coding |
| Brownfield first step | Bounded code graph/map + reuse strategy (B0–B2) |
| Coding unit | One story contract + TDD + independent validator |
| Repair | One automated repair; then human |
| Branching | Feature branch; never main/master/develop |
| Merge | Human only; harness stops at draft PR |
| Models | Deterministic → Sonnet implement → Opus risk/branch |
| Graph engines | Adapter import only |
| v5 code | Reference for ideas; do not port the platform |
| Success metric | First-pass accepted stories, low review toil, low sensor noise, controlled cost — not control count |

**Next concrete build step:** M0 control-budget validation + M1 co-design human-readable proposal pack, then a planning-only greenfield canary with a real BRD.
