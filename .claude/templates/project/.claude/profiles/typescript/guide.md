# TypeScript language profile

Load this only for TypeScript/JavaScript paths.

- Preserve the repository's module, compiler, lint, formatting, and package
  conventions. Do not weaken strictness or add a second build path to bypass a
  diagnostic.
- Keep public types narrow and intentional. Validate untrusted runtime data at
  boundaries; static types do not validate HTTP, storage, event, or user input.
- Prefer cohesive modules and explicit dependency direction over global state,
  hidden side effects, copied transformations, or speculative generic types.
- Inject clock, randomness, network, storage, and provider clients for
  deterministic tests. Await promises deliberately and define cancellation,
  timeout, retry, and error ownership at the boundary that can act on them.
- Test observable contracts and behavior, including failure paths. Measure the
  named performance budget before optimizing bundles or runtime hot paths.
