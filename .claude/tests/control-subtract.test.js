const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { proposeControlSubtractions } = require("../lib/control-subtract");

function control(overrides = {}) {
  return {
    id: "unit-sensor",
    kind: "sensor",
    direction: "feedback",
    execution_type: "computational",
    regulates: ["maintainability"],
    axis: "maintainability",
    cadence: "session",
    severity: "blocking",
    status: "active",
    scope: "tests",
    owner: "team",
    introduced_for: "missed tests",
    cost: "fast",
    review_date: "2030-01-01",
    removal_criteria: "replaced",
    execution: "runner",
    self_correction: "fix tests",
    ...overrides,
  };
}

test("proposes review when review_date is past", () => {
  const report = proposeControlSubtractions({
    version: 1,
    control_budget: { max_active: 5, baseline_ids: ["unit-sensor"] },
    controls: [control({ review_date: "2020-01-01" })],
  }, { asOf: "2026-07-19" });
  assert.ok(report.proposals.some((item) => item.action === "review-or-retire"));
  assert.equal(report.applies_automatically, false);
  assert.equal(report.decision_authority, "human");
});

test("uses sensor-outcomes ledger for zero-fire nomination", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "control-subtract-"));
  fs.mkdirSync(path.join(root, ".claude", "state"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".claude", "state", "sensor-outcomes.jsonl"),
    `${JSON.stringify({ sensor_id: "other", outcome: "true-positive" })}\n`
  );
  const report = proposeControlSubtractions({
    version: 1,
    control_budget: { max_active: 5, baseline_ids: ["unit-sensor"] },
    controls: [control()],
  }, { root, asOf: "2026-07-19" });
  assert.ok(report.sensor_outcomes_available);
  assert.ok(report.proposals.some((item) => item.control_id === "unit-sensor" && item.action === "measure-or-retire"));
});

test("never auto-applies and flags near-budget pressure", () => {
  const report = proposeControlSubtractions({
    version: 1,
    control_budget: { max_active: 2, baseline_ids: ["a", "b"] },
    controls: [
      control({ id: "a" }),
      control({ id: "b" }),
    ],
  });
  assert.equal(report.applies_automatically, false);
  assert.ok(report.proposals.some((item) => item.action === "prefer-subtraction"));
});
