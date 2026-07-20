---
description: Select the narrow technology-profile, domain-pack, architecture, reference-pattern, and test context required for a harness delivery task.
---

# Context selection

Before planning or changing code:

1. Read `.claude/harness.yaml` and run `harness-validate.js`.
2. Run `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-guides.js" --root . --path
   <changed-path> [--need <capability>]`. Load required results and report a
   selected optional capability when `available` is false. Pass
   `--available-capability lsp|codemod|project-bootstrap|knowledge-mcp|api-docs` only
   after confirming the integration is usable in the current agent.
3. Run `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-profile-context.js" --path
   <changed-path> [--path ...] [--hint <approved-configured-framework>] --root .`.
   Always keep the expert-generalist engineering core (returned as
   `engineering_core`). Load progressive core references only when needed.
   Then load exactly the returned project guides in order: **language first**,
   then only frameworks matched by content/path signals or an explicit
   configured `--hint`. Frameworks never load from file extension alone. Do not
   load every configured profile. If `dropped_frameworks` is non-empty, narrow
   paths or pass a hint instead of loading all frameworks.
4. Load `project/architecture.md`, `project/reference-patterns.md`, and only the
   selected profile sensors relevant to those paths.
5. For domain-sensitive work, load only the pertinent glossary terms, invariants, lifecycle, policy, fixtures, and review policy in the selected domain pack.
6. For brownfield work, use the approved B1 code map in
   `.claude/specs/brownfield/` as the navigation index. Prefer an available LSP,
   Graphify, or CCE bounded export; otherwise use the harness's deterministic
   static-source fallback. Every relationship must retain extracted/inferred
   provenance. Open the cited implementation and tests before relying on it.
   In a monorepo or large tree, read `.claude/project/large-codebase.md`, scope
   `--path` to packages/subsystems, and prefer code intelligence over a fallback
   scan. Large scopes are supported, but narrower scopes reduce inventory time
   and keep the resulting graph and model context focused.
7. Broaden scope or use text search only when the bounded map cannot answer a
   named question. Record the gap instead of pretending the graph is complete.

Do not treat a profile as a universal framework expert or a domain pack as permission to invent rules. Escalate changed invariants, lifecycle transitions, policies, data classifications, or material architecture decisions to their human owners.
