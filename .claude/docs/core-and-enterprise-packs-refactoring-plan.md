# Core and enterprise packs refactoring plan

## Outcome

Refactor the harness into a small, stable core plus composable capability packs
without removing existing enterprise behavior. Existing installations continue
to behave as they do today through an `enterprise-v1` compatibility profile.
New installations select the smallest profile that supplies the controls their
repository needs.

This document is a plan only. It does not authorize implementation, change the
current runtime, or alter the current installation scaffold.

## Design principles

1. **Preserve capability.** Move enterprise controls behind pack boundaries;
   do not delete them merely to reduce the core.
2. **Mechanics in core, policy in packs.** The core owns discovery, lifecycle,
   contracts, execution, and reporting. Packs own optional workflow and
   governance decisions.
3. **Minimal by selection.** A repository pays the context, runtime, artifact,
   and maintenance cost only for enabled packs.
4. **Fail closed when enabled.** A required control remains blocking when its
   owning pack is active. Disabled packs contribute no hidden requirements.
5. **Progressive disclosure.** Load pack instructions and references only when
   the active task and configuration require them.
6. **Repository ownership.** Project configuration decides which packs are
   active. Upgrades remain additive and do not overwrite local guidance.
7. **Stable contracts.** Packs integrate through versioned extension points,
   not imports from private core modules.
8. **Evidence over claims.** Each migration step has compatibility, isolation,
   performance, and negative-path tests.

## Target architecture

```text
.claude/
├── core/
│   ├── intake/
│   ├── context/
│   ├── workflow/
│   ├── execution/
│   ├── review/
│   ├── sensors/
│   ├── verification/
│   └── packs/
├── packs/
│   ├── engineering-quality/
│   ├── enterprise-governance/
│   ├── evidence-assurance/
│   ├── production-operations/
│   ├── tracker-integration/
│   ├── cost-governance/
│   └── private-equity/
├── profiles/
│   ├── minimal.json
│   ├── standard.json
│   ├── enterprise.json
│   └── enterprise-v1.json
└── scripts/
    └── harness-pack.js
```

The physical layout is a target, not the first migration step. Introduce the
contracts and compatibility profile before moving files.

## Core responsibilities

The core should contain only capabilities required to host and execute a
harness consistently:

- work intake, classification, identifiers, and resumable state;
- bounded discovery and context selection;
- small-slice execution and red/green evidence;
- generator/reviewer separation;
- a normalized sensor contract and sensor runner;
- repository-native verification;
- pack discovery, dependency resolution, activation, and lifecycle;
- concise status and correction reporting;
- safe path handling, subprocess execution, and secret redaction.

The core must not encode a particular approval hierarchy, tracker, industry,
rollout model, model provider, or evidence-retention policy.

## Initial pack boundaries

| Pack | Existing capabilities to migrate |
| --- | --- |
| `engineering-quality` | Maintainability, modularity, architecture boundaries, dependency, regression, browser, and performance sensors |
| `enterprise-governance` | G0-G4 specifications, proposal sessions, backlog planning, design evolution, approval sequencing, and requirements traceability |
| `evidence-assurance` | Evidence hygiene, attestations, immutable ledgers, waivers, quarantines, freshness, and retention |
| `production-operations` | Pilots, lived and routing canaries, M7/P7 scorecards, release readiness, production feedback, and improvement ratchets |
| `tracker-integration` | Tracker MCP configuration, projections, provider adapters, and receipts |
| `cost-governance` | Model routing, spend ceilings, usage evidence, and economical-evaluator promotion |
| `private-equity` | Glossary, invariants, policies, lifecycle definitions, data classification, and domain sensors |

Language and framework profiles remain lightweight feed-forward and sensor
adapters. They should use the pack runtime but should not inherit enterprise
governance semantics.

## Pack contract

Each pack has a versioned `pack.json` manifest. The first contract should be
deliberately narrow:

```json
{
  "schema_version": 1,
  "id": "enterprise-governance",
  "version": "1.0.0",
  "requires": {
    "core": ">=2.0.0",
    "packs": []
  },
  "contributes": {
    "skills": ["skills/governance/SKILL.md"],
    "controls": ["controls.json"],
    "sensors": ["sensors.json"],
    "templates": ["templates"]
  }
}
```

Supported extension points should initially be limited to:

- `intake`: validate or enrich a work request;
- `plan`: require or produce additional planning artifacts;
- `before_story`: enforce prerequisites before implementation;
- `sensors`: register normalized deterministic or inferential checks;
- `review`: add independent review dimensions;
- `before_complete`: enforce completion gates;
- `status`: contribute a bounded status section.

Every contribution declares its owner, activation condition, correction path,
review date, and removal condition using the existing control-manifest
principles. Extension ordering must be deterministic. Cycles and incompatible
versions fail validation before any work begins.

## Configuration and profiles

Extend `.claude/harness.yaml` with explicit profile and pack selection:

```yaml
version: 2
profile: standard

packs:
  enterprise-governance:
    enabled: true
    approval_model: g0-g4
  evidence-assurance:
    enabled: true
    retention_days: 365
  tracker-integration:
    enabled: false
```

Profiles are tested presets, not separate implementations:

| Profile | Intended use | Included behavior |
| --- | --- | --- |
| `minimal` | Libraries, prototypes, and small teams | Intake, context, TDD, review, and repository verification |
| `standard` | Normal product repositories | Minimal plus engineering-quality controls and lightweight traceability |
| `enterprise` | Governed organizational delivery | Standard plus approvals, evidence assurance, operations, cost, and optional tracker integration |
| `enterprise-v1` | Existing installations during migration | Exact current behavior and defaults |

Repository overrides take precedence over profile defaults. The resolved pack
set and the reason each pack is active must be visible in status and evidence.

## Pack lifecycle

Add one maintainer-facing command with a small surface:

```text
harness-pack list
harness-pack explain <pack>
harness-pack add <pack> [--dry-run]
harness-pack remove <pack> [--dry-run]
harness-pack doctor
```

Initially, `add` and `remove` only activate or deactivate packs bundled with the
plugin. This avoids introducing remote-code installation while the contract is
still evolving. Installation must preview configuration and scaffold changes,
write only missing files, and record a reversible receipt.

External packs are a later, separately approved capability. They require pinned
versions, integrity hashes, provenance, compatibility checks, explicit hook
review, and a rollback path.

## Migration phases

### Phase 0: baseline and decision record

- Record the current file count, source lines, initialized scaffold size,
  context size, full-suite duration, focused-sensor duration, and canary
  duration.
- Capture current behavior as the `enterprise-v1` compatibility contract.
- Add an architecture decision record for mechanics-versus-policy boundaries.
- Define performance and compatibility budgets before implementation.

Exit criteria:

- Current tests and release checks pass unchanged.
- Baseline measurements are reproducible in CI.
- Owners approve the proposed core and pack boundary map.

### Phase 1: pack schema and resolver

- Implement manifest parsing, validation, dependency resolution, deterministic
  ordering, and configuration merging.
- Add `harness-pack list`, `explain`, and `doctor` without moving existing code.
- Represent all existing controls as contributions owned by a logical pack.
- Resolve `enterprise-v1` to the complete current control set.

Exit criteria:

- Invalid, cyclic, missing, and incompatible packs fail before execution.
- The resolved `enterprise-v1` control set matches the current manifest.
- Pack resolution adds negligible startup time and no model calls.

### Phase 2: activation isolation

- Route control, sensor, template, skill, and status discovery through the pack
  resolver.
- Add tests proving a disabled pack contributes no instructions, artifacts,
  sensors, hooks, status, or completion requirements.
- Preserve compatibility exports so existing scripts and tests continue to
  work while modules remain in their current locations.

Exit criteria:

- `enterprise-v1` remains behaviorally identical.
- Minimal-profile fixtures initialize and verify without enterprise artifacts.
- Required enabled controls continue to fail closed.

### Phase 3: extract engineering-quality

- Move optional architecture and maintainability sensors behind the first
  physical pack boundary.
- Keep the normalized sensor contract and runner in core.
- Verify changed-path scoping and focused execution remain fast.

Exit criteria:

- Sensor results are byte-for-byte or semantically equivalent under
  `enterprise-v1`.
- Core tests do not import private engineering-quality modules.
- Minimal projects run only their configured repository checks.

### Phase 4: extract enterprise governance and evidence assurance

- Move G0-G4, proposal, traceability, approval, waiver, attestation, and
  retention policies into their respective packs.
- Keep generic hashing, redaction, and safe evidence primitives in core only if
  more than one pack needs them.
- Convert cross-pack calls to explicit extension data or public contracts.

Exit criteria:

- Existing governed stories resume without state migration loss.
- Approval and evidence behavior under `enterprise-v1` is unchanged.
- Minimal and standard profiles have no implicit G0-G4 dependency.

### Phase 5: extract operations, tracker, cost, and domain packs

- Move canaries, pilots, scorecards, production feedback, tracker providers,
  cost routing, and private-equity controls.
- Ensure provider credentials and optional dependencies are checked only when
  the owning pack is active.
- Preserve enterprise release checks as an enterprise-profile composition.

Exit criteria:

- Enterprise canaries pass using composed packs.
- Non-enterprise profiles do not load provider or domain context.
- Pack-specific failure messages name the pack and correction path.

### Phase 6: new-installation experience

- Update initialization to choose `minimal`, `standard`, or `enterprise` and
  show the resulting controls before writing files.
- Keep existing installations pinned to `enterprise-v1` until explicitly
  migrated.
- Generate only files needed by the selected profile and enabled packs.
- Add profile migration previews and reversible receipts.

Exit criteria:

- Initialization remains additive and never overwrites project guidance.
- Every generated file has an active owner and lifecycle.
- A minimal scaffold is materially smaller than the current scaffold.

### Phase 7: physical cleanup and v2 release

- Move remaining modules into the target layout.
- Remove compatibility exports only after all callers use public contracts.
- Update documentation around the small public workflow and pack selection.
- Publish migration guidance and retain an `enterprise-v1` support window.

Exit criteria:

- Full profile matrix and upgrade tests pass.
- No pack imports a private module belonging to another pack.
- Release checks demonstrate compatibility, isolation, and performance budgets.

## Test strategy

Maintain three layers of tests:

1. **Core contract tests:** resolver, ordering, isolation, lifecycle, path safety,
   sensor normalization, and verification.
2. **Pack contract tests:** each pack's controls, negative paths, templates, and
   correction behavior independently.
3. **Profile composition tests:** minimal, standard, enterprise, and
   enterprise-v1 end-to-end fixtures.

Mandatory regression cases include:

- a disabled pack has zero runtime and context contribution;
- missing required pack dependencies fail before work starts;
- enabled required sensors fail closed when unavailable;
- profile overrides are deterministic and explainable;
- existing state resumes under `enterprise-v1`;
- removing a pack previews orphaned configuration and artifacts;
- pack upgrades preserve customized project files;
- compacted sessions retain active pack and control decisions;
- every profile completes its representative greenfield and brownfield canary.

## Performance and size budgets

Phase 0 should establish exact baselines. Initial target budgets are:

- preserve the current sub-five-second full unit suite where practical;
- pack resolution adds less than 50 ms on a warm local filesystem;
- disabled packs add no prompt context and execute no hooks or sensors;
- focused checks remain the default during story execution;
- `minimal` initialization contains only core files and selected technology
  adapters;
- `minimal` status and correction output fit in a single concise view.

Budgets may change only from measured evidence and an explicit decision, not to
make a failing migration pass.

## Compatibility and rollback

- Existing installations are detected by manifest version and mapped to
  `enterprise-v1` automatically.
- No migration silently disables an existing control.
- Each migration command supports `--dry-run` and records the previous resolved
  configuration.
- State and evidence formats remain readable for the declared support window.
- Physical moves retain temporary public compatibility exports.
- A repository can restore its previous profile and configuration from the
  migration receipt without deleting evidence.

## Documentation changes during implementation

Keep the root `CLAUDE.md` and README as maps. Put pack-specific operating detail
inside each pack. Document:

- how profiles differ;
- why each pack is active;
- how to add, remove, diagnose, and upgrade a pack;
- which controls are computational, inferential, or human;
- the owner and correction path for every blocking control;
- the compatibility policy for existing enterprise installations.

Update `design.html` only after the architecture contract is implemented and
verified; until then it continues to describe the current harness.

## Delivery discipline

Implement one phase at a time on a feature branch. For every phase:

1. write failing contract and isolation tests;
2. make the smallest implementation change;
3. run focused tests, then the full suite;
4. compare performance and context measurements with the baseline;
5. run independent specification and code-quality reviews;
6. demonstrate `enterprise-v1` compatibility;
7. obtain human approval before beginning the next phase.

Do not combine physical file movement, behavioral changes, configuration
migration, and documentation redesign in one change. Keeping those concerns
separate makes regressions attributable and rollback practical.

## Completion definition

The refactoring is complete when:

- the core contains only stable harness mechanics;
- optional policy is supplied exclusively by versioned packs;
- minimal, standard, and enterprise profiles are independently usable;
- existing repositories retain current behavior without forced migration;
- disabled packs have no hidden context, runtime, artifact, or gate cost;
- enterprise controls remain fail-closed and auditable when enabled;
- profile and pack selection is explainable from status output;
- the documented compatibility, performance, and size budgets pass in CI.
