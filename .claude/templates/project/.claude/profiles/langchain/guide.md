# LangChain profile

Load only for paths that use LangChain and only when this profile is enabled.

- Keep domain behavior outside chains. Treat prompts, tools, retrievers, model
  settings, and output schemas as versioned executable contracts linked to the
  governing specification.
- Put provider/model calls behind a project port. Unit and hermetic system tests
  use deterministic fakes; separate adapter contract tests cover provider shape.
- Use structured outputs with validation where behavior depends on fields. Test
  malformed output, timeout, retry, tool failure, and token/context limits.
- Trace the smallest useful identifiers and timings without logging secrets,
  raw sensitive prompts, retrieved private data, or unrestricted model output.
- Prefer a simple function or explicit pipeline when durable state, branching,
  recovery, and resumability are not required.
