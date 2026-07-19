# Release guide

Run from the repository root:

```sh
node .claude/scripts/harness-release-check.js
```

The gate requires:

1. valid Claude Code plugin structure;
2. all deterministic contract and negative-path tests passing;
3. lived TDD + local-simulation canary (`harness-lived-canary.js`: G0–G4
3b. multi-story evolution canary (`harness-multi-story-canary.js`: story-1
   first-slice → story-2 reuse-existing; dependent first-slice blocked)
   proposals, real red/green tests, story-fast + pre-PR sensors, fail-closed
   unconfigured probe, and `ready-for-draft-pr`);
4. lived brownfield reuse canary (`harness-brownfield-canary.js`: B0–B2,
   Graphify-shaped adapter import, reuse strategy, real TDD, draft-PR readiness);
5. lived routing/context canary (`harness-routing-canary.js`: model routing,
   protected packs, provider receipts, spend ceilings, promotion gates);
6. matched synthetic greenfield and brownfield P7 canaries passing;
7. M7 scorecard generation (pilot status + subtraction proposals; human-owned);
8. control subtraction proposal write (never applied automatically);
9. the root containing only `.claude/`, `CLAUDE.md`, and `README.md`;
10. no references to removed legacy `.claude/artifacts` workflows; and
11. a committed P7 scorecard that states synthetic limitations.

Synthetic canaries prove control integration, not production quality. Before a
broader rollout, collect real-pilot human review time, escaped defects, sensor
precision/correction, provider cost per accepted story, and graph retrieval
value via `harness-pilot.js record` / `report`. Enable the economical evaluator
only through its matched-quality policy.

Release remains a human decision. The harness never merges, deploys, or
auto-retires controls.

## P8 real-pilot decision

Record at least three real greenfield and three real brownfield pilots with the
internal `harness-pilot.js record` command. Each record cites hash-checked
branch-readiness, human-review, defect-observation, sensor-assessment, and
provider-receipt evidence; brownfield records also cite graph-assessment
evidence. Generate `.claude/specs/evidence/pilot-readiness.json` with
`harness-pilot.js report`.

`eligible-for-human-rollout-decision` is not approval. A human remains the sole
rollout authority. A `hold` result requires tuning or subtraction and a new,
separately identified pilot; existing evidence is never edited.
