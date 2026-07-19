---
description: Select the narrow technology-profile, domain-pack, architecture, reference-pattern, and test context required for a harness delivery task.
---

# Context selection

Before planning or changing code:

1. Read `.claude/harness.yaml` and run `harness-validate.js`.
2. Run `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-profile-context.js" --path
   <changed-path> [--path ...] [--hint <approved-configured-framework>] --root .`.
   Always keep the expert-generalist engineering core (returned as
   `engineering_core`). Load progressive core references only when needed.
   Then load exactly the returned project guides in order: **language first**,
   then only frameworks matched by content/path signals or an explicit
   configured `--hint`. Frameworks never load from file extension alone. Do not
   load every configured profile. If `dropped_frameworks` is non-empty, narrow
   paths or pass a hint instead of loading all frameworks.
3. Load `project/architecture.md`, `project/reference-patterns.md`, and only the
   selected profile sensors relevant to those paths.
4. For domain-sensitive work, load only the pertinent glossary terms, invariants, lifecycle, policy, fixtures, and review policy in the selected domain pack.
5. For brownfield work, use the approved B1 code map in
   `.claude/specs/brownfield/` as the navigation index. Prefer an available LSP,
   Graphify, or CCE bounded export; otherwise use the harness's deterministic
   static-source fallback. Every relationship must retain extracted/inferred
   provenance. Open the cited implementation and tests before relying on it.
6. Broaden scope or use text search only when the bounded map cannot answer a
   named question. Record the gap instead of pretending the graph is complete.

Do not treat a profile as a universal framework expert or a domain pack as permission to invent rules. Escalate changed invariants, lifecycle transitions, policies, data classifications, or material architecture decisions to their human owners.
