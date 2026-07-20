# Large-codebase navigation

Use these controls when the repository has many packages or a large source
tree. They keep instructions and file reads proportional to the active task.

1. Start Claude in the smallest package or subsystem that owns the change. Start
   at the repository root only for genuinely cross-cutting work.
2. Keep the root `CLAUDE.md` as a repository map. Put stack- and subsystem-specific
   conventions in a `CLAUDE.md` beside that subsystem, or in path-scoped rules.
3. Pass package or subsystem directories to brownfield `--path`; avoid using `.`
   merely as a convenience. The fallback mapper supports large scopes, but a
   bounded, provenance-labelled code-intelligence export or narrower scope is
   faster and produces a more focused navigation artifact.
4. Prefer a Claude Code LSP/code-intelligence plugin for definitions, references,
   callers, and type errors. Use text search only for a named question the index
   cannot answer.
5. Keep generated, build, and vendored trees out of context. The committed
   `.claude/settings.json` supplies conservative read-deny defaults; remove a
   rule deliberately if generated or vendored source is part of the task.
6. For isolated sessions, configure `worktree.sparsePaths` with `.claude` and the
   packages needed by the task. Paths are repository-specific, so the harness
   does not guess them. Add shared dependency directories needed by every sparse
   worktree and use `symlinkDirectories` for large reusable dependency trees.
7. Put package-only procedures in that package's `.claude/skills/`. Keep shared
   procedures at the root, with short descriptions, so discovery metadata does
   not grow into an instruction payload.

When a change crosses packages, name every affected package and public seam in
the story contract. Expand access and sparse paths intentionally before work;
do not broaden discovery to the whole repository.
