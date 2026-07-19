---
description: Apply the lean expert-generalist engineering disciplines—scoping, TDD, clean code, debugging, verification, and review—to a bounded software change.
---

# Expert-generalist engineering core

Use this skill for implementation, bug fixing, refactoring, or review work under
the harness. It is **stack- and domain-neutral**. Language and framework guidance
comes only from path-signal profile selection—not from this skill.

## Standing rules

1. Scope the smallest observable behaviour, public seam, affected paths, and
   acceptance criterion. Find an existing canonical pattern before designing another.
2. For a feature, bug, or logic change, use red-green-refactor. State a justified
   exception when test-first is impractical.
3. For a defect, reproduce and minimise it before changing code. Form a
   falsifiable root-cause hypothesis; do not stack speculative fixes.
4. Keep code cohesive and names aligned with project/domain vocabulary. Prefer a
   small interface with clear ownership over copied flows or speculative abstractions.
5. **Coding craft (always):** functions ≤ 30 lines, files ≤ 300 lines; no empty/bare
   exception swallow; structured logging on failure paths; avoid nested full scans
   and string `+=` in loops. See [references/coding-craft.md](references/coding-craft.md).
6. Run deterministic sensors **after every meaningful edit batch** — vibe session or
   `/harness` alike: `harness-sensors.js` then `harness-status.js . --agent`. Sensors
   do not wait for G4; they regulate maintainability regardless of co-design state.
7. Run the narrowest reliable deterministic checks first, then selected
   profile/domain checks. Record fresh evidence and residual risks.

## Progressive references (load only when relevant)

| Topic | Open when… | File |
| --- | --- | --- |
| Coding craft | any implement/edit (vibe or harness) | [references/coding-craft.md](references/coding-craft.md) |
| TDD | implementing or fixing behaviour | [references/tdd.md](references/tdd.md) |
| Design / ports | structure or dependency direction matters | [references/design.md](references/design.md) |
| DDD | approved domain language or invariants apply | [references/ddd.md](references/ddd.md) |
| Refactoring | restructuring without behaviour change | [references/refactoring.md](references/refactoring.md) |
| Performance | budgets, hotspots, or NFR work | [references/performance.md](references/performance.md) |

Do not load every reference by default. Do not load technology or domain packs
here—invoke `harness-context-selection` / `harness-profile-context.js` for those.
