const test = require("node:test");
const assert = require("node:assert/strict");
const { validateWaivers, applyWaiver } = require("../lib/sensor-waivers");

const waiver = {
  id: "temporary-python-test-gap",
  sensor_id: "python-tests",
  affected_paths: ["app/calls.py"],
  owner: "delivery-team",
  approved_by: "engineering-manager",
  reason: "Known environment migration issue.",
  expires_on: "2027-01-01",
};

test("applies only an active, exact-path waiver to an eligible sensor failure", () => {
  const result = applyWaiver({ sensor_id: "python-tests", status: "fail", affected_paths: ["app/calls.py"], reason: "Tests failed.", next_action: "Fix.", evidence: "pytest" }, { version: 1, waivers: [waiver] }, "2026-07-18");
  assert.equal(result.status, "warn");
  assert.equal(result.waiver_id, waiver.id);
  assert.match(result.reason, /engineering-manager/);
});

test("rejects protected or broad waivers and leaves protected failures blocking", () => {
  assert.match(validateWaivers({ version: 1, waivers: [{ ...waiver, sensor_id: "secret-scan", affected_paths: ["*"] }] }).join("\n"), /protected control/);
  const protectedResult = applyWaiver({ sensor_id: "secret-scan", status: "fail", affected_paths: ["app/calls.py"] }, { version: 1, waivers: [{ ...waiver, sensor_id: "secret-scan" }] }, "2026-07-18");
  assert.equal(protectedResult.status, "fail");
});
