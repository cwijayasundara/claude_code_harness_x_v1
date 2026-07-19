# LangGraph profile

Load only for paths that use LangGraph and only when enabled.

- Define typed state with explicit ownership and reducers. Nodes perform one
  named transition; routing conditions remain deterministic where possible.
- Design checkpoint, replay, idempotency, interruption, and resume semantics
  before long-running execution. Never assume a node runs exactly once.
- Put tools and external calls behind ports with timeouts and bounded retries.
  Test every edge, terminal state, interruption, failed tool, and resume path
  using deterministic model/tool doubles.
- Keep business rules outside graph plumbing. Use a graph only when branching,
  durable state, or recovery is a real requirement.
