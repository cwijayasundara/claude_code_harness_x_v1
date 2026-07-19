# Python language profile

Load this only for Python paths.

- Follow the repository's supported Python version, formatter, type-checker,
  packaging, and async conventions; do not introduce a parallel toolchain.
- Prefer explicit module boundaries, small typed public interfaces, clear
  ownership, and domain names over utility dumping grounds or inheritance for
  reuse alone.
- Keep I/O at ports/adapters and make time, randomness, network, persistence,
  LLM, and embedding dependencies injectable so behavior stays hermetic.
- Preserve exception causes. Model expected domain failures deliberately and
  do not catch broad exceptions without a boundary-level recovery policy.
- Test observable behavior. Use unit tests for pure rules, contract tests for
  adapters, and approved fixtures rather than patching private implementation.
- Measure before optimizing; use the approved performance budget and profile
  the named hot path rather than claiming generic optimality.
