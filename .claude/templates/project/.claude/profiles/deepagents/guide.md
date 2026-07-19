# Deep Agents profile

Load only for paths using Deep Agents and only when enabled.

- Give the agent the smallest tool and filesystem authority needed for the
  approved task. Treat subagent delegation, memory, planning, and tool use as
  observable behavior with bounded budgets and explicit stop conditions.
- Keep durable domain policy outside agent prompts. Version prompts, tool
  schemas, middleware, and model settings and ground them in specifications.
- Test tool trajectories, denial/error paths, resumability, context isolation,
  and unsafe-action rejection with deterministic model/tool doubles.
- Require human decisions for expanded authority, irreversible external action,
  sensitive data exposure, or changed business policy.
