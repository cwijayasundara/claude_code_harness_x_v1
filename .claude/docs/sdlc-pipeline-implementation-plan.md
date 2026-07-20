# SDLC pipeline implementation plan

**Status:** implementation started  
**Created:** 2026-07-20  
**Owner:** harness maintainers  
**Decision required:** approve each phase independently before implementation

## Implementation progress

| Increment | Status | Evidence |
| --- | --- | --- |
| A1 SPDD schemas, target examples, and G0 proposal rendering | implemented 2026-07-20 | `lib/spdd-contract.js`, specification/proposal tests, initialized-target templates |
| A2 strict PRD/direct-BRD G0 routes | implemented 2026-07-20 | PRD requires analysis + derived REASONS Canvas; direct BRD requires rationale + sufficiency checks; lived greenfield/brownfield canaries pass |
| A3 prompt-amendment and gate-reopen synchronization loop | implemented 2026-07-20 | approved amendment supersedes prompt artifacts, preserves gate history, reopens G0–G4, and pauses active stories until reapproval |
| B1 estimation and dependency DAG | implemented 2026-07-20 | coarse size/point policy, confidence/basis, canonical DAG, cycle and cross-epic checks, ready set, weighted critical path |
| B2 allocation clusters and G4 consistency | implemented 2026-07-20 | complete non-overlapping clusters, point reconciliation, cross-cluster dependencies, and story-contract/DAG matching |
| C1 requirements/test traceability | implemented 2026-07-20 | G4 rejects orphan requirements, ACs, tests, stories, and malformed dispositions |
| C2 branch reconciliation | implemented 2026-07-20 | automated mappings require passing pre-PR checks; manual evidence is human-named, hash-backed, and workspace-bound; exclusions expire |
| D1 conditional browser E2E contract | implemented 2026-07-20 | explicit feature surfaces; UI stories require configured hermetic browser check and browser trace mapping; non-UI stories remain unaffected |
| D2 Playwright/default profile and equivalent-runner policy | implemented 2026-07-20 | React profile defaults to Playwright; alternatives require rationale; core executes project-owned commands without installing tooling |
| Phases E–F | pending | implement only after the preceding phase is reviewed |

## 1. Purpose

Extend the lean harness so a business-authored PRD can move through a governed,
source-grounded delivery pipeline:

```text
PRD
 -> SPDD analysis + REASONS Canvas / engineered BRD
 -> human approval
 -> epics, stories, estimates, dependency DAG, allocation clusters
 -> acceptance examples and test strategy
 -> architecture and design (brownfield-aware when applicable)
 -> executable test plan, cases, and data
 -> approved story contracts
 -> per-story TDD ratchet
 -> full local verification and requirements reconciliation
 -> optional draft PR creation
```

This plan extends the existing specification, ratchet, and verification spine.
It must not add a dashboard, scheduler, tracker platform, deployment engine,
automatic merge, or a second workflow runtime.

## 2. Design principles

1. `.claude/specs/` remains the system of record. External trackers are
   optional projections and never silently overwrite approved local artifacts.
2. Humans approve business meaning, structured prompts, architecture, tests,
   material risk, and publication to external systems.
3. Approved artifacts are immutable. Corrections create amendments or
   superseding versions and reopen affected gates.
4. Every derived claim traces to a captured source location. An unresolved
   ambiguity that changes observable behaviour stops progression.
5. Add deterministic validation to existing modules before adding a new
   agent, skill, hook, or public command.
6. “Fully tested” means every in-scope requirement and acceptance criterion has
   explicit verification disposition; it is not a claim that unknown defects
   are impossible.
7. New controls require manifest ownership, correction guidance, review date,
   removal criteria, and available control-budget headroom.

## 3. Target lifecycle and gates

Preserve the public `/harness` workflow and existing gate identifiers. Refine
their contracts as follows.

| Gate | Required decision and artifacts |
| --- | --- |
| G0 | Captured PRD or BRD; for PRD intake, approved SPDD analysis and REASONS Canvas/engineered BRD; scope, assumptions, contradictions, and open questions |
| G1 | Epics, INVEST-sized stories, business-language ACs, estimates, validated dependency DAG, critical path, and proposed allocation clusters |
| G2 | Acceptance examples, risk-based test strategy, preliminary test cases, boundary inventory, and required test levels |
| G3 | Human pair-design session: alternatives, selected architecture, code-fit evidence, seams, NFR budgets, and brownfield amendment where applicable |
| G4 | Final executable test cases/data/plan plus per-story contracts, execution order, traceability, and implementation posture |

G2 remains before G3 so observable behaviour constrains design. Detailed
integration, system, browser, and test-data decisions are finalized at G4 after
the architecture is approved. This avoids renumbering existing gates while
closing the current sequencing ambiguity.

Brownfield work continues through B0–B2 before G1–G4:

```text
B0 baseline -> B1 bounded code map -> B2 reuse-first strategy/amendment
```

## 4. Phase A — governed SPDD intake

### Outcome

A PRD cannot pass G0 until it has an approved, versioned structured prompt that
captures the engineering interpretation without losing business provenance.
A directly supplied BRD may use a documented `brd-direct` path.

### Artifact packages

Add:

```text
.claude/specs/analysis/
.claude/specs/reasons-canvas/
.claude/specs/prompt-amendments/
```

The REASONS Canvas schema requires:

- `requirements`: outcomes, actors, scope, DoD, source locations;
- `entities`: domain terms, entities, relationships, invariants;
- `approach`: proposed strategy, alternatives, and trade-offs;
- `structure`: system placement, components, boundaries, dependencies;
- `operations`: concrete, ordered, testable delivery operations;
- `norms`: project engineering conventions and observability expectations;
- `safeguards`: security, privacy, performance, compatibility, and prohibited
  behaviour;
- `sync`: governed code/spec synchronization status and cited amendments.

### Enforcement

- Extend `lib/specifications.js` package and G0 validation.
- PRD intake requires one approved `analysis` and one approved
  `reasons-canvas` artifact derived from the captured PRD.
- BRD intake requires either an approved canvas or an explicit, human-approved
  `brd-direct` decision explaining why the supplied BRD is already sufficient.
- A code-side correction that changes intent requires a prompt amendment before
  implementation can resume.
- Proposal rendering shows the seven REASONS sections and unresolved conflicts,
  not only raw JSON.

### Tests and completion criteria

- Negative tests: PRD cannot pass G0 without analysis/canvas; missing REASONS
  sections fail; unknown source locations fail; unapproved direct-BRD bypass
  fails; approved prompt mutation is detected.
- Lived canary: PRD -> analysis -> canvas -> human G0 -> amendment -> reopened
  approval.
- No new public command and no dependency on the external OpenSPDD CLI in the
  core. An optional import adapter may be considered separately.

## 5. Phase B — backlog planning, estimation, and allocation

### Outcome

G1 produces a schedulable, traceable backlog rather than package-presence-only
evidence.

### Story estimation

Require each story to declare:

```json
{
  "size": "low | medium | high",
  "story_points": 1,
  "estimate_confidence": "low | medium | high",
  "estimate_basis": ["source-grounded reason"]
}
```

Default policy:

- low: 1–3 points;
- medium: 5 points;
- high: 8–13 points;
- above 13 points: split or record an explicit human exception.

Size is effort/complexity, not business priority. Risk and uncertainty remain
separate fields.

### Dependency DAG

Require a canonical dependency artifact containing nodes and directed edges.
Validate:

- all nodes name approved stories from the same change;
- no self-edge, duplicate edge, or cycle;
- dependency direction agrees with every G4 `dependency_story_ids` field;
- every cross-epic dependency has rationale;
- critical path and dependency-ready sets are deterministically derived.

### Allocation clusters

Add an `allocations` package or an `allocation-clusters` artifact type under
`plans/`. A cluster records story IDs, total points, dependencies on other
clusters, shared seams, required skills, rationale, and optional assignee.

The deterministic proposal should favor dependency-connected vertical slices,
cohesive code ownership, bounded total points, and minimal cross-engineer
handoffs. It proposes allocations; a human assigns engineers.

### Tests and completion criteria

- Schema and negative-path tests for invalid points, oversize stories, cycles,
  unknown nodes, contract/DAG disagreement, and overlapping cluster ownership.
- Multi-story canary includes at least two parallel clusters and one blocking
  edge, then proves only dependency-ready stories can start.
- G1 proposal renders points, confidence, critical path, and clusters in a
  human-readable summary.

## 6. Phase C — requirements and test traceability

### Outcome

Draft-PR readiness proves that every approved in-scope requirement and AC has a
verification disposition and fresh result.

### Traceability model

Add typed relationships:

```text
source requirement -> BRD/REASONS rule -> epic -> story -> AC
 -> test case -> verification check -> evidence result
```

Each AC must resolve to one or more test cases. Each test case declares its
level (`unit`, `integration`, `contract`, `system`, `browser-e2e`, `manual`),
expected result, data IDs, boundary IDs, and risk tags.

Allow only these verification dispositions:

- `automated-pass` with fresh immutable evidence;
- `manual-pass` with named human and evidence;
- `approved-exclusion` with owner, reason, expiry/review date, and affected
  risk;
- `unverified`, which blocks finalization.

### Test completeness review

G2/G4 proposals must explicitly consider, where relevant:

- happy paths, invalid input, boundaries, authorization, and failure recovery;
- compatibility, migration, rollback, idempotency, concurrency, and retries;
- security, privacy, accessibility, observability, and performance budgets;
- contract behaviour for every external boundary;
- production-only residual risks that hermetic tests cannot prove.

### Enforcement and tests

- Add a deterministic traceability validator, preferably in
  `lib/specifications.js` or one focused `lib/requirements-traceability.js`.
- Integrate its result into G4 approval and branch finalization.
- Negative tests cover orphan requirements, orphan ACs, stale results, expired
  exclusions, and falsely claimed manual evidence.
- Branch readiness includes a compact coverage matrix and residual-risk list.

## 7. Phase D — conditional browser E2E verification

### Outcome

A story that changes a user-facing UI backed by an API cannot reach draft-PR
readiness without configured and passing browser journeys.

### Contract changes

Add `browser-e2e` to verification kinds. Story/design artifacts declare
`feature_surfaces` from `ui`, `api`, `cli`, `event`, and `worker`. The rule is:

```text
ui + api -> browser-e2e required
ui only  -> browser-e2e required unless a human-approved reason says the
            public seam is exercised by another equivalent browser harness
```

Do not hard-code Playwright into the core runner. The project command may use
Playwright or an approved equivalent; React/TypeScript templates should default
to Playwright guidance.

Required journeys include at least one approved success and relevant failure
path, with authentication/authorization and accessibility-critical interaction
coverage when applicable. All external services still use declared safe local
doubles or emulators.

### Tests and completion criteria

- Verification-plan tests prove browser checks become required from feature
  surfaces and fail closed when absent or unconfigured.
- A UI/API canary runs a real small browser test if the release environment can
  support it; otherwise the limitation remains explicit and the feature is not
  promoted to a blocking default.
- Existing non-UI targets migrate without acquiring irrelevant browser checks.

## 8. Phase E — optional tracker projection

**Status (2026-07-20): E1 implemented; E2 MCP integration implemented, pilot
validation pending.** The harness now creates and validates a
provider-neutral projection from hash-verified approved G1 artifacts, requires a
separate human approval, provides idempotency/divergence decisions and fake-adapter
execution contracts, and archives immutable reconciliation receipts. Projects can
opt into official Linear, Atlassian Jira, and Microsoft Azure DevOps MCP servers;
the publication skill constrains their write tools to an approved projection and
explicit human confirmation. Credentials remain outside the repository. Real
authenticated pilot validation and provider-specific field mapping remain pending.

### Outcome

Approved epics, stories, points, dependencies, and clusters can be reviewed and
then published idempotently to Linear, Jira, or Azure DevOps without making the
tracker authoritative.

### Boundary

Implement a provider-neutral export document first:

```text
specs/index + approved G1 artifacts -> projection plan -> human approval
 -> provider adapter -> reconciliation receipt
```

The core owns projection schema and validation only. Provider operations use an
optional MCP server or project-owned CLI adapter. Do not put credentials in
specifications or evidence.

Each receipt stores provider, project identifier, local artifact ID/hash,
remote ID/URL, operation, timestamp, result, and a redacted provider response
hash. Repeated runs must update only when the approved local hash changes.
Remote divergence produces a reconciliation report and human decision; it never
silently overwrites either side.

### Tests and completion criteria

- Contract tests use fake adapters for create, update, retry, partial failure,
  idempotency, and remote divergence.
- Publication is always an explicit action and never part of G1 approval.
- Ship no provider adapter until a real pilot identifies its first target and
  validates credential/permission handling.

## 9. Phase F — optional draft PR publication

### Outcome

After `ready-for-draft-pr`, an explicit human-authorized action can push the
bound feature branch and create a draft PR.

### Preconditions

- branch-readiness evidence is fresh and workspace-bound;
- all approved stories are `STORY_VERIFIED`;
- pre-PR verification and independent branch review pass;
- target remote, base branch, and changed paths are shown to the human;
- no unresolved human decision or unverified traceability item exists.

The PR body links governing source IDs, approved BRD/canvas, epics/stories,
architecture, tests, verification evidence, residual risks, and tracker links
when available. Creation never authorizes merge or deployment.

Prefer an existing GitHub capability or project-owned provider CLI. Keep PR
publication outside the deterministic readiness calculation.

### Tests and completion criteria

- Dry-run rendering and fake-provider contract tests precede any live pilot.
- Stale readiness, wrong branch, uncommitted out-of-scope changes, failed push,
  duplicate PR, and provider rejection are safe non-success outcomes.
- The first live use requires an explicit maintainer decision and records a
  redacted publication receipt.

## 10. Migration and compatibility

1. Introduce schema versions for new artifact contracts.
2. `harness-upgrade --apply` adds missing templates/configuration only and
   never rewrites approved target artifacts.
3. Existing PRD changes already past G0 remain readable. New strict G0 rules
   apply to newly created changes unless a maintainer explicitly opts a target
   into migration validation.
4. G2/G4 refinement must preserve existing gate IDs and ratchet state files.
5. New verification kinds are conditional; non-UI projects remain valid.
6. Tracker and PR provider capabilities stay disabled until explicitly
   configured.

## 11. Delivery order and dependencies

```text
Phase A SPDD intake
  -> Phase B backlog/DAG/clusters
      -> Phase C traceability
          -> Phase D browser E2E
          -> Phase F draft PR publication

Phase E tracker projection depends on Phase B but can otherwise ship separately.
```

Recommended increments:

1. A1 schemas and proposal rendering; A2 G0 enforcement and amendment loop.
2. B1 estimation/DAG validation; B2 cluster proposal and G4 consistency.
3. C1 traceability graph; C2 branch-finalization coverage matrix.
4. D1 conditional verification contract; D2 profile template and lived canary.
5. E1 neutral export; E2 one pilot-selected provider adapter.
6. F1 dry-run PR packet; F2 explicit provider-backed draft creation.

Each increment must include negative-path tests, focused tests, full release
check, upgrade behavior, documentation, and an updated synthetic canary where
the control crosses lifecycle stages.

## 12. Measures and rollout decisions

Before making a new control blocking across projects, compare real pilots on:

- requirements/AC traceability gaps caught before PR;
- first-pass story and branch-review acceptance;
- human review time and correction count;
- escaped requirement defects;
- test flakiness and browser-test latency;
- planning time, cluster reassignment, and dependency-related blocking;
- tracker reconciliation failures;
- provider cost per accepted story.

Every phase ends in one of `adopt`, `revise`, `hold`, or `remove`, decided by a
human. Synthetic tests prove contract integration, not delivery effectiveness.

## 13. Explicit non-goals

- generating the original business PRD without BA/domain-owner involvement;
- automatic story assignment, sprint planning, or capacity management;
- making Jira, Linear, Azure DevOps, or GitHub the specification authority;
- automatic approval, merge, deployment, or production rollout;
- claiming exhaustive correctness from test counts or model review;
- requiring SPDD or browser tooling through a network dependency in core tests;
- expanding the public skill surface for each pipeline stage.
