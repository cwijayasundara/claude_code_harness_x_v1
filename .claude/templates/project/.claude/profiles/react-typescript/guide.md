# React/TypeScript profile

## Use

Use this profile only for React/TypeScript code in this repository. Follow the existing feature ownership and state-management pattern before introducing a new abstraction.

## Implementation guidance

- Prefer a feature-local component/hook/API seam over cross-feature coupling.
- Keep data fetching, domain transformation, and presentation responsibilities explicit.
- Preserve accessibility: labelled controls, keyboard paths, loading/error states, and semantic HTML.
- Reuse approved shared components and hooks instead of copying a similar screen.
- Treat API contract changes as coordinated frontend/backend changes with tests.

## Test guidance

- Test user-observable behaviour rather than implementation details.
- Cover loading, error, and key domain states.
- Add Playwright only for stable, high-value journeys; do not create broad browser suites by default.

## Sensor commands

The P0 runner invokes `npm run typecheck`, `npm run lint`, and `npm test -- --run` when this profile is active and a package manifest exists. Configure these scripts in the project.
