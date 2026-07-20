# Source-grounded delivery specifications

`index.json` is the traceability and approval ledger. Original idea, PRD, BRD,
feature, epic, story, issue, design, test, and diff inputs are captured
immutably under `source/`; derived artifacts live in one focused
package and name their source IDs. The harness refuses specification writes on
`main`, `master`, and `develop`.

Use the plugin CLI:

```sh
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-specs.js" intake --change CHANGE-ID --source path/to/prd.md --kind prd --root .
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-work.js" resume --root .
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-specs.js" register --file path/to/draft.json --root .
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-specs.js" approve --change CHANGE-ID --gate G0 --approver "Human Name" --root .
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-specs.js" validate --change CHANGE-ID --root .
```

After G1 approval, tracker publication is an optional, separate human decision.
The local specifications remain authoritative:

```sh
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-specs.js" tracker-export --change CHANGE-ID --provider generic --project PROJECT-KEY --root .
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-specs.js" tracker-approve --projection CHANGE-ID-generic-projection --approver "Human Name" --root .
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-specs.js" tracker-record --receipt .claude/work/tracker-receipt.json --id RECEIPT-ID --root .
```

`tracker-export` creates a reviewable draft and never contacts a provider.
Approval also does not authorize a live push. A project-owned adapter or MCP
integration may consume only the approved projection, must keep credentials out
of specifications and evidence, and must produce a receipt for `tracker-record`.
Unchanged local hashes are no-ops; detected remote divergence requires an
explicit human reconciliation decision and must never be overwritten silently.

Configure official MCP servers explicitly from the installed plugin:

```sh
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-tracker-mcp.js" configure --provider linear --root .
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-tracker-mcp.js" configure --provider jira --root .
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-tracker-mcp.js" configure --provider azure-devops --azure-org YOUR-ORG --root .
```

The configurator merges `.mcp.json` without replacing custom servers. Claude
Code will ask whether to trust project MCP configuration; use `/mcp` for OAuth.
Installing or authenticating a server does not authorize publishing work items.
Invoke the `harness-tracker-publish` skill only after an explicit user request.

For PRD intake, G0 requires a source-grounded `analysis` artifact and a
seven-section `reasons-canvas` derived from it. For an already sufficient BRD,
use the explicit `brd-direct` fields shown in `brd/direct-brd.example.json`;
other source kinds use the neutral governing-intent contract under `intents/`
and do not manufacture an upstream PRD or BRD. The G0 approval is the human decision accepting that route. G0 captures the
safe branch and structured interpretation; G1 approves epics, stories, and
dependencies, estimates, critical path, and allocation clusters; G2 approves test data, cases, and plan; G3 approves design,
architecture, folder structure, and performance budgets; G4 approves the
story execution plan. An approval is a recorded human decision, never an
agent-generated default.

G4 also requires one `traceability` artifact linking every contract source
requirement and acceptance criterion to an approved test case and automated,
manual, or approved-exclusion disposition. Draft-PR finalization reconciles
automated links against the real pre-PR report. Manual evidence must name its
human verifier and match the current workspace fingerprint; expired exclusions
and unverified links fail closed.

When approved intent changes, register the replacement prompt artifacts and a
`prompt-amendments` artifact, then run `harness-specs.js amend`. The amendment
supersedes the named prompt artifacts, reopens G0 and every downstream gate,
and blocks an active story ratchet until G0-G4 are explicitly reapproved.

Existing systems first use B0-B2: baseline health; a provenance-labelled code
map with impact/reuse analysis; then the smallest change strategy and design
amendment. LSP, Graphify, or CCE may provide a bounded adapter export. The
native static map is the dependency-free fallback, and inferred edges are not
treated as verified source facts.
