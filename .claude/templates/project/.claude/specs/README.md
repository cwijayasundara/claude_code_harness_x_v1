# Source-grounded delivery specifications

`index.json` is the traceability and approval ledger. Original BRD/PRD inputs
are captured immutably under `source/`; derived artifacts live in one focused
package and name their source IDs. The harness refuses specification writes on
`main`, `master`, and `develop`.

Use the plugin CLI:

```sh
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-specs.js" intake --change CHANGE-ID --source path/to/prd.md --kind prd --root .
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-specs.js" register --file path/to/draft.json --root .
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-specs.js" approve --change CHANGE-ID --gate G0 --approver "Human Name" --root .
node "$CLAUDE_PLUGIN_ROOT/scripts/harness-specs.js" validate --change CHANGE-ID --root .
```

G0 captures the safe branch and source; G1 approves epics, stories, and
dependencies; G2 approves test data, cases, and plan; G3 approves design,
architecture, folder structure, and performance budgets; G4 approves the
story execution plan. An approval is a recorded human decision, never an
agent-generated default.

Existing systems first use B0-B2: baseline health; a provenance-labelled code
map with impact/reuse analysis; then the smallest change strategy and design
amendment. LSP, Graphify, or CCE may provide a bounded adapter export. The
native static map is the dependency-free fallback, and inferred edges are not
treated as verified source facts.
