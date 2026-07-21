const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseSensorProfile, validateSensorProfile, validateDomainSensorProfile, isApplicable } = require("../../.claude/lib/sensor-profile");

const profile = parseSensorProfile(`
sensors:
  - id: python-tests
    label: Python tests
    command: pytest
    args: ["."]
    extensions: [".py"]
`);

test("parses and validates the constrained profile sensor format", () => {
  assert.deepEqual(profile.sensors[0], {
    id: "python-tests",
    label: "Python tests",
    command: "pytest",
    args: ["."],
    extensions: [".py"],
  });
  assert.deepEqual(validateSensorProfile(profile, "python-fastapi"), []);
});

test("rejects incomplete profile sensors and scopes them by extension", () => {
  assert.match(validateSensorProfile({ sensors: [{ id: "bad" }] }, "bad").join("\n"), /command is required/);
  assert.equal(isApplicable(profile.sensors[0], ["app/main.py"]), true);
  assert.equal(isApplicable(profile.sensors[0], ["frontend/App.tsx"]), false);
});

test("requires domain sensors to cite approved invariant ids", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domain-sensor-"));
  const invariantsPath = path.join(root, "invariants.yaml");
  fs.writeFileSync(invariantsPath, "- id: call-limit\n  statement: Calls remain within the commitment.\n");
  const domainProfile = { sensors: [{ ...profile.sensors[0], invariants: ["unknown-rule"] }] };
  assert.match(validateDomainSensorProfile(domainProfile, "private-equity", invariantsPath).join("\n"), /unknown invariant/);
  domainProfile.sensors[0].invariants = ["call-limit"];
  assert.deepEqual(validateDomainSensorProfile(domainProfile, "private-equity", invariantsPath), []);
});
