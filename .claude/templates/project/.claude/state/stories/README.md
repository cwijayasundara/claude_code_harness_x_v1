# Story ratchet state

The harness writes one resumable JSON state file per active story. Do not edit
these files manually or treat them as delivery evidence. Advance them only with
`harness-ratchet.js`; the cited immutable specifications, command evidence,
validator verdict, sensor report, and Git diff remain the sources of truth.

Normal flow:

```text
READY -> RED_TEST -> IMPLEMENT -> STORY_REVIEW -> FAST_SENSORS -> STORY_VERIFIED
```

`HUMAN_DECISION_REQUIRED` stops automation. A `revise` verdict permits at most
the configured bounded repair count before another fresh evaluator pass.
