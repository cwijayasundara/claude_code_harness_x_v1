# TDD (test-first)

Load only when implementing or fixing behaviour.

1. Write the smallest public-seam test that fails for the intended reason.
2. Run it; record red evidence (real command, exit code, observed failure).
3. Implement the smallest change that passes; keep all changes in scope.
4. Refactor only while the focused suite stays green.
5. Do not rewrite approved expected results without a specification amendment.

Exceptions (state them): pure docs, config renames with no behaviour, or
characterization tests that pin legacy behaviour before a brownfield edit.
