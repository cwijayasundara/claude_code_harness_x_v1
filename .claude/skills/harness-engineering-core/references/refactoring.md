# Refactoring

Load when restructuring without changing intended behaviour.

1. Keep tests green (or pin behaviour with characterization tests first).
2. One refactoring intent per step: rename, extract, move, or simplify.
3. Separate refactor commits/evidence from behaviour-change commits/evidence.
4. Remove duplication only after shared behaviour is proven in more than one use.
5. Do not “clean up” unrelated modules while delivering a story.
