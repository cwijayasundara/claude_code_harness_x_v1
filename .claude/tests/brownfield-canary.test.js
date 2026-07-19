const assert = require("node:assert/strict");
const test = require("node:test");
const { runBrownfieldCanary } = require("../lib/brownfield-canary");

test("brownfield canary maps with adapter, requires reuse, and reaches draft-PR readiness", () => {
  const report = runBrownfieldCanary();
  assert.equal(report.status, "pass");
  assert.equal(report.story_state, "STORY_VERIFIED");
  assert.ok(report.gates.includes("B0"));
  assert.ok(report.gates.includes("B1"));
  assert.ok(report.gates.includes("B2"));
  assert.equal(report.adapter_provider, "graphify");
  assert.ok(report.reuse_targets.includes("normalizeTitle"));
  assert.equal(report.implementation_reused_normalize, true);
  assert.ok(report.red_exit_code > 0);
  assert.equal(report.green_exit_code, 0);
  assert.equal(report.pre_pr_status, "pass");
  assert.equal(report.readiness_status, "ready-for-draft-pr");
  assert.match(report.evidence.adapter, /adapter-export\.json$/);
  assert.match(report.evidence.strategy, /strategy\.json$/);
});
