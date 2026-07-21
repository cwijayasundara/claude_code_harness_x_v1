const test = require("node:test");
const assert = require("node:assert/strict");

const { parseHarnessConfig } = require("../../.claude/lib/harness-config");

test("parses active profiles and domain pack", () => {
  const config = parseHarnessConfig(`
technology_profiles:
  - python-fastapi
  - react-typescript
domain_pack: private-equity
review:
  max_automated_repair_attempts: 1
`);

  assert.deepEqual(config.technologyProfiles, ["python-fastapi", "react-typescript"]);
  assert.equal(config.domainPack, "private-equity");
  assert.equal(config.maxAutomatedRepairAttempts, 1);
});
