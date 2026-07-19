# Design judgment (pragmatic SOLID / OO)

Load for non-trivial structure, seams, or dependency decisions.

- **Dependency direction:** policy and infrastructure depend on domain/application,
  not the reverse. Use a port only where substitution or an external boundary
  exists—not an interface for every class.
- **Cohesion:** one coherent reason to change per module. Prefer composition and
  explicit constructors over inheritance trees and service locators.
- **Contracts:** small, stable public seams; fail fast at boundaries; keep
  invariants close to the data that owns them.
- **Reuse first:** call an existing helper before inventing a parallel one.
  Generalize only when at least two real uses share stable behaviour.
- **Structural shape before technology:** at design time, contrast clone-vertical,
  shared-modules, and parameterized-spine. Do not jump to a framework runtime
  to paper over missing seams. The second similar capability reuses approved
  seams or opens a design amendment—never a silent vertical clone.
