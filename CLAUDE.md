# Lean Expert-Generalist Harness

This repository is a Claude Code plugin. Its purpose is to turn a bounded
request into a small, tested, reviewable draft PR while keeping project-specific
knowledge in the target repository.

## Start here

- Read [README.md](README.md) for the supported workflow and public commands.
- Read [.claude/docs/implementation.md](.claude/docs/implementation.md) before changing
  harness scripts or hooks.
- Run the relevant Node test file(s) after a change; the full unit suite is
  `node --test tests/unit/*.test.js`. The model-driven README journey is the
  opt-in package under `tests/e2e/`.

## Navigate by task

| If you are changing… | Read next |
| --- | --- |
| Harness delivery behavior | [.claude/skills/run/SKILL.md](.claude/skills/run/SKILL.md) |
| How task context is selected | [.claude/skills/harness-context-selection/SKILL.md](.claude/skills/harness-context-selection/SKILL.md) |
| Generator or evaluator roles | [.claude/agents/](.claude/agents/) |
| Improvement roadmap | [.claude/docs/v1-improvement-plan.md](.claude/docs/v1-improvement-plan.md) |
| Artifact, sensor, or repair utilities | the matching `.claude/lib/` module and its test in `tests/unit/` |
| Product architecture and improvement decisions | [.claude/docs/v1-improvement-plan.md](.claude/docs/v1-improvement-plan.md) and the relevant module/test |
| What a target project receives | [.claude/templates/project/](.claude/templates/project/) |

## Working rules

- Keep this file a map, not an encyclopedia. Put durable detail next to the
  code or artifact it governs and link to it here when it becomes a common
  entry point.
- Preserve the small public command surface and the thin-harness boundary.
- Prefer deterministic, dependency-free Node.js controls. Add a guide, sensor,
  hook, or artifact only for a demonstrated recurring failure, with a lifecycle.
- Do not overwrite target-project guidance: `harness-init` creates only missing
  files.
- Keep context proportional to the task; inspect the smallest relevant paths
  and canonical local pattern before making a change.
- When compacting, preserve the active change/story IDs, approved decisions,
  modified paths, verification commands and results, and unresolved decisions.
- Run concurrent editing sessions in separate Git worktrees so changes cannot
  collide.

## Target-project guidance

`harness-init` copies [the target-project CLAUDE.md template](.claude/templates/project/CLAUDE.md)
when the target does not already have one. That template is the target
repository's progressive-disclosure entry point; project architecture, patterns,
profiles, domain packs, artifacts, and evidence remain below `.claude/`.
