# Google ADK profile

Load only for paths using Google ADK and only when enabled.

- Choose the simplest agent/orchestration form that satisfies the approved
  state and delegation requirements. Keep domain decisions out of callbacks and
  orchestration plumbing.
- Define tools with narrow typed inputs, explicit side effects, least authority,
  timeouts, and actionable errors. Separate session state from durable business
  state and define ownership, retention, and privacy.
- Use callbacks for a named cross-cutting policy, not hidden business behavior.
  Test tool trajectories, state transitions, callback order, failure/retry, and
  delegation with deterministic model and external-boundary doubles.
- Preserve trace correlation while redacting prompts, secrets, and sensitive
  state. Human approval remains mandatory for external irreversible actions.
