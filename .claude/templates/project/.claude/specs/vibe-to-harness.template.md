# Vibe → harness intake

Use this when work started **outside the loop** (vibe coding) and must re-enter
**on the loop** (`/harness`) before a PR or permanent product change.

## 1. Always-on sensors first (do not skip)

Even while still vibing, craft sensors apply. Run before intake:

```sh
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-sensors.js" . --changed <paths-or-.>
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-status.js" . --agent
```

Fix **fail** sensors (file-size, function-size, exception-handling, secrets,
boundaries) before claiming the spike is ready to graduate.

## 2. Capture a governing source (required)

Save this file (or a real PRD) under the repo, e.g. `requirements/vibe-change.md`:

```markdown
# Change: <title>

## Outcome
What working software should do (external quality).

## In scope
-

## Out of scope
-

## Paths touched during vibe
- 

## Known risks
security / data / public API / perf:

## Graduation reason
[ ] PR  [ ] second similar feature  [ ] production path  [ ] shared branch
```

## 3. Start harness delivery

```text
/lean-expert-generalist-harness:harness "graduate vibe spike: requirements/vibe-change.md"
```

Or:

```sh
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-specs.js" intake \
  --change <CHANGE-ID> --source requirements/vibe-change.md --kind prd --root .
```

Then co-design G0→G4 (or B0→B2 if cleaning existing code).

## 4. Choose the path

| Situation | Path |
| --- | --- |
| Greenfield spike with little existing code | G0–G4 |
| Dirty tree / clones / unknown seams | B0 baseline → B1 map → B2 reuse → G1–G4 |
| Only craft debt, no behaviour change | sensors + focused refactor stories (still G1–G4 thin) |

## 5. Definition of done (not vibe)

- Story contracts with `implementation_posture` / reuse
- RED/GREEN evidence from real commands
- Sensors pass (or waived with human record)
- Pre-PR verification fail-closed
- Draft PR only — human merges

## Craft defaults (enforced by sensors)

| Control | Default |
| --- | --- |
| Function size | ≤ 30 lines |
| File size | ≤ 300 lines |
| Exceptions | no bare/empty swallow |
| Logging | no silent catch; no product print/console.log |
| Performance | warn on nested loops / string+= in loops |
| Duplication | warn on near-clones |
