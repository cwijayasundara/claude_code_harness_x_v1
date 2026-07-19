# Coding craft (always on)

Stack-neutral feedforward rules. Computational sensors in
`.claude/project/maintainability.json` enforce the same thresholds whether the
session is **vibe** (outside the loop) or **`/harness`** (on the loop).

## Size

| Rule | Default |
| --- | --- |
| Function / method body | ≤ **30** lines (warn 25) |
| Source file | ≤ **300** lines (warn 250) |

Prefer extract method / module over “just one more branch.”

## Exception handling

- Catch **specific** failures; avoid bare `except:` / empty `catch {}`.
- On catch: **log with context**, then **rethrow**, translate to a domain error, or return a typed failure — never `pass` / empty body.
- Do not use exceptions for normal control flow.

## Logging (debug + production support)

- Use a **leveled structured logger** (info/warn/error) with correlation ids where the stack has them.
- Failure paths must leave an ops-visible signal (error log or metric).
- Avoid `print` / `console.log` in product modules; keep debug noise out of production paths.

## Performance

- Avoid nested full-collection scans (O(n²)) without a measured need.
- Avoid string `+=` inside hot loops; join or buffer.
- Hot paths: measure against approved G3 performance budgets; do not claim “optimized” without numbers.

## After every batch of edits (any mode)

```sh
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-sensors.js" . --changed <path>
# or continuous:
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-sensor-watch.js" .
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-status.js" . --agent
```

Sensors always include: secrets, boundaries, file-size, function-size,
exception-handling, logging-discipline, performance-heuristics, near-duplication,
plus profile/domain sensors when configured.
