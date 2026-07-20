---
description: Run a risk-triggered semantic modularity review with two fresh, independent harness-evaluator contexts and merge their versioned evidence.
disable-model-invocation: true
---

# Independent modularity review

The target request is:

```text
$ARGUMENTS
```

Use this workflow only in a project with an installed harness. The main agent
orchestrates evidence but never supplies a verdict.

1. Run `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-modularity.js" .` and read the
   generated `review-packet.json`. If `REQUIRED false`, report that fact and stop.
2. Invoke `harness-evaluator` in a fresh context with only the review packet and
   its `grounding_refs`. Require the packet's version-1 modularity schema. Save
   the exact JSON as `.claude/specs/reviews/modularity-<packet-id>-1.json`.
3. Invoke a second `harness-evaluator` in another fresh context. Do not expose
   the first review, its findings, or its verdict. Save its exact JSON as
   `.claude/specs/reviews/modularity-<packet-id>-2.json`.
4. Confirm the reviews have distinct `reviewer_id` and
   `independent_context_id`, then run:

   `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-modularity.js" . --review <review-1> --review <review-2>`

5. A `human-decision-required` result stops automation. Present the grounded
   finding, both design options, and the exact fingerprint to a human. Never
   invent or record a decision on their behalf.

Do not let the generator perform either review, reuse a context, repair code
between the independent passes, or paraphrase evaluator JSON into evidence.
