const test = require("node:test");
const assert = require("node:assert/strict");

const { createSensorResult, reportStatus } = require("../lib/sensor-contract");

test("creates a complete sensor result using the standard contract", () => {
  assert.deepEqual(createSensorResult({
    status: "fail",
    affectedPaths: ["app/calls.py"],
    reason: "Unit tests failed.",
    nextAction: "Repair the failing test or implementation.",
    evidence: "pytest tests/test_calls.py (exit 1)",
  }), {
    status: "fail",
    affected_paths: ["app/calls.py"],
    reason: "Unit tests failed.",
    next_action: "Repair the failing test or implementation.",
    evidence: "pytest tests/test_calls.py (exit 1)",
  });
});

test("rejects incomplete sensor results and derives the overall status", () => {
  assert.throws(() => createSensorResult({ status: "skip", affectedPaths: ["."], reason: "n/a", nextAction: "n/a", evidence: "n/a" }), /status/);
  assert.equal(reportStatus([{ status: "pass" }, { status: "warn" }]), "warn");
  assert.equal(reportStatus([{ status: "pass" }, { status: "fail" }]), "fail");
});
