# Harness workflow UX design and implementation log

This is the durable decision and implementation record for making `/harness`
the single friendly entry point for the software-delivery lifecycle. Keep it
current as behaviour changes; do not treat chat history as the specification.

## Intended user experience

The public surface remains deliberately small:

```text
/lean-expert-generalist-harness:harness [request]
/lean-expert-generalist-harness:harness-status
/lean-expert-generalist-harness:harness-retro
```

`/harness` accepts an idea, PRD, BRD, feature, epic, story, issue, design, test
set, or existing diff. It classifies the entry point, desired stopping point,
interaction mode, repository posture, and delivery lane. Users describe the
outcome; internal commands and G0-G4/B0-B2 mechanics remain implementation
details.

Examples:

```text
/harness "Deliver requirements/payments-prd.md"
/harness "Implement requirements/US-142.md"
/harness "Add invoice export"
/harness "Fix issue #381"
/harness "Design invoice export but do not write code"
/harness "Create tests for US-142"
/harness "Continue"
```

Optional overrides are `--from`, `--through`, `--mode`, `--change`,
`--new-system`, and `--existing-system`. Natural language remains primary.

## Workflow envelope

Each change may add the following compatible metadata to its existing
`.claude/specs/index.json` record:

```json
{
  "workflow": {
    "entry_kind": "story",
    "target": "draft-pr",
    "interaction_mode": "checkpoint",
    "repository_posture": "brownfield",
    "delivery_lane": "bounded-change",
    "classification_confidence": "high",
    "classification_rationale": [],
    "current_checkpoint": "product",
    "state": "awaiting-human",
    "next_action": "Review the product checkpoint",
    "created_at": "ISO-8601",
    "updated_at": "ISO-8601"
  }
}
```

This is additive to schema version 1. A schema-version migration is not needed
until an incompatible representation is required.

## Entry kinds and source grounding

- Existing PRD intake retains SPDD analysis plus the REASONS Canvas.
- Existing direct-BRD intake retains its reviewed sufficiency route.
- `idea`, `feature`, `epic`, `story`, `issue`, `design`, `tests`, and `diff`
  use a neutral `intents` artifact rather than manufacturing a fictional PRD
  or BRD.
- Every derived artifact remains grounded in an immutable captured source.
- Conversation-only input must first be written to a durable project file.

## Delivery lanes

| Lane | Purpose |
|---|---|
| `documentation` | Produce an intermediate SDLC artifact without code |
| `tiny-change` | Small, low-scope edit with focused verification |
| `bounded-change` | One story or bug through the story ratchet |
| `refactor` | Behaviour-preserving structural change |
| `feature` | Several related stories |
| `initiative` | PRD, new subsystem, or large programme |
| `discovery` | Brownfield B0-B2 only |
| `re-entry` | Govern and verify existing untracked edits |

Risk changes review and evidence depth; it does not by itself inflate the lane.

## Human interaction

- `guided`: detailed human decisions throughout co-design.
- `checkpoint`: consolidated product, solution, and readiness decisions.
- `unattended`: execution only inside an already human-approved G4 contract.

G0-G4 remain authoritative. Consolidated checkpoint approval may only record
human approval when every constituent gate is independently ready; it must be
atomic and must never allow the agent to approve its own proposal.

## Resume and status

`/harness "continue"` resolves active work on the current branch, recomputes
the next action from durable gates, story ratchets, verification, and readiness
evidence, and resumes. Stored `next_action` text is a cache, not authority.

Default status leads with change, outcome, route, mode, progress, blocker, next
action, and required human action. Operational detail remains available in the
full status view, and concise sensor correction remains available to agents.

## Implementation record

### 2026-07-20 — initial design

- Decision: retain one public delivery command rather than copying the older
  harness's `/build`, `/feature`, `/change`, `/auto`, and `/gate` surface.
- Decision: model entry point, stopping point, interaction mode, repository
  posture, and lane independently.
- Decision: preserve all deterministic gates, independent evaluation, sensors,
  and draft-PR-only authority.
- Decision: implement compatibility-first, beginning with expanded durable
  intake, deterministic route derivation, workflow persistence, resume, and
  concise status before consolidated checkpoint approval.
- Finding: current `specifications.intake` accepts only `prd` and `brd`; G0
  requirements default every non-PRD source to BRD. A neutral intent route is
  required before story/feature/issue intake is safe.

### 2026-07-20 — first implementation slice

- Added expanded immutable intake for every supported entry kind.
- Added the validated neutral `intents/governing-intent` contract while
  preserving PRD SPDD/REASONS and direct-BRD validation unchanged.
- Added deterministic request classification, lane derivation, workflow
  persistence, active-work selection, and evidence-derived resume guidance.
- Added an internal `harness-work.js` adapter; it is not a new public command.
- Changed default status to a delivery dashboard when active work exists;
  `--full` preserves the operational report and `--agent` preserves concise
  sensor correction.
- Added combined product (G0+G1) and solution (G2+G3+G4) proposal packs plus
  rollback-safe checkpoint approval. Individual gates remain authoritative.
- Updated the public skill, README, generated user guide, specification guide,
  and governing-intent template.

## Verification log

Record focused and full-suite commands and results here as implementation
proceeds.

- `node --test .claude/tests/work-intake.test.js .claude/tests/work-state.test.js .claude/tests/specifications.test.js` — 23 passed, 0 failed before status/checkpoint work.
- `node --test .claude/tests/*.test.js` — 218 passed, 0 failed after intake, workflow state, resume, status, skill, and documentation work.
- `node --test .claude/tests/specifications.test.js .claude/tests/work-intake.test.js .claude/tests/work-state.test.js .claude/tests/status-health.test.js` — 29 passed, 0 failed after combined checkpoint support.
- `node --test .claude/tests/*.test.js` — final suite: 220 passed, 0 failed.
- `node .claude/scripts/harness-release-check.js .claude` — passed plugin validation, all 220 tests, lived TDD, multi-story evolution, brownfield reuse, routing/context, matched P7, M7 scorecard, and subtraction checks. The generated timestamp-only scorecard rewrite was intentionally discarded.
