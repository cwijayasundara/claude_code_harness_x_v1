# Python/FastAPI profile

## Use

Use this profile only for Python/FastAPI code in this repository. Preserve the project's existing dependency direction and naming unless an approved ADR changes it.

## Implementation guidance

- Keep routers thin: parse/validate HTTP contracts, delegate, and return a response.
- Keep business rules in named domain/service abstractions, not route handlers.
- Keep persistence concerns behind the project's repository/data-access seam.
- Use explicit request/response schemas at API boundaries.
- Do not swallow exceptions. Translate expected domain errors deliberately and log unexpected failures with useful context.
- Add or update an API/contract test when a public contract changes.

## Test guidance

- Test behaviour through public seams.
- Use approved domain fixtures for business rules.
- Write a focused failing test before production-code changes where practical.
- Do not test private implementation details merely to increase coverage.

## Sensor commands

The P0 runner uses `ruff check`, `pyright`, and `pytest` when available. Adjust the project tool configuration rather than adding a parallel command path.
