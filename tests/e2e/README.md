# Full SDLC E2E

This is an opt-in black-box test of the README workflow. It creates a fresh
copy of `project/` under `.work/`, initializes the harness, and runs the real
`/harness:run` skill through:

1. a small PRD, human checkpoint simulations, implementation, verification,
   and a local simulated draft PR;
2. a human-owned merge simulation followed by a brownfield feature, the same
   checkpoints, implementation, verification, and a second simulated draft PR.

The test never contacts GitHub. A local bare Git remote stores
`refs/pull/1/head` and `refs/pull/2/head`, while `.work/pulls/*.json` records the
PR metadata. This tests the PR boundary without granting network mutation,
merge, or deployment authority to the harness.

## Run

Prerequisites are Node 20+, Git, an authenticated Claude CLI, and enough model
quota for two complete changes. From this directory:

```sh
npm run test:contract
RUN_HARNESS_E2E=1 npm test
```

Optional controls:

```sh
HARNESS_E2E_MODEL=sonnet HARNESS_E2E_TURN_BUDGET=8 RUN_HARNESS_E2E=1 npm test
```

Outputs remain in `.work/` for inspection: the target repository, Claude turn
logs, simulated PR metadata, bare remote, and final `report.json`. Clean them
with `npm run clean`.

Each Claude phase prints `START`, `DONE`, elapsed seconds, and whether remaining
turns were skipped because draft-PR readiness was already recorded. A turn
timeout terminates the complete Claude/evaluator process group rather than
leaving descendant processes holding the runner open. The disposable project
uses bypass permissions because non-interactive `acceptEdits` blocks harness
evidence writes under `.claude/`; global installers, network CLIs, Claude-side
commits, and Claude-side pushes remain explicitly disallowed.

The fixture replaces the template's network-resolved Semgrep `auto` rules with
a tiny repository-owned static security command. This keeps the sensor contract
real while avoiding registry lookup, certificate-store, and global Python-tool
latency that is unrelated to the harness workflow under test.

This is intentionally not part of the default unit suite: it is slow,
model-dependent, consumes quota, and exercises explicit human-approval prompts.
