const test = require("node:test");
const assert = require("node:assert/strict");
const {
  g0Requirements,
  validateAnalysis,
  validateDirectBrd,
  validateReasonsCanvas,
} = require("../../.claude/lib/spdd-contract");

test("PRD G0 requires analysis and a REASONS Canvas", () => {
  assert.deepEqual(g0Requirements("prd"), ["source", "prd", "analysis", "reasons-canvas"]);
  assert.deepEqual(g0Requirements("brd"), ["source", "brd"]);
});

test("analysis requires grounded strategic dimensions", () => {
  const errors = validateAnalysis({ domain_concepts: [], strategic_direction: ["reuse"], risks: [], requirement_gaps: [] });
  assert.match(errors.join("\n"), /domain_concepts/);
  assert.match(errors.join("\n"), /risks/);
  assert.match(errors.join("\n"), /requirement_gaps/);
});

test("REASONS Canvas requires all seven sections and aligned sync state", () => {
  const errors = validateReasonsCanvas({
    requirements: ["R"], entities: ["E"], approach: ["A"], structure: ["S"],
    operations: ["O"], norms: ["N"], safeguards: [],
    sync: { status: "drifted", amendment_ids: [] },
  });
  assert.match(errors.join("\n"), /safeguards/);
  assert.match(errors.join("\n"), /status must be 'aligned'/);
});

test("direct BRD route requires rationale and sufficiency checks", () => {
  const errors = validateDirectBrd({ intake_path: "brd-direct", direct_brd_rationale: "", sufficiency_checks: [] });
  assert.match(errors.join("\n"), /direct_brd_rationale/);
  assert.match(errors.join("\n"), /sufficiency_checks/);
});
