# Measured performance

Load when NFRs, budgets, or hotspots are in scope.

- Optimize only a **measured** bottleneck against an **approved** budget.
- Prefer algorithm, I/O batching, allocation reduction, and correct caching over
  micro-optimizations that obscure intent.
- Never trade correctness or clarity for an unmeasured gain.
- Record before/after measurements in evidence; regressions fail pre-PR budgets.
