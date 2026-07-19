const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("matched greenfield and brownfield canaries traverse the supported release path", () => {
  const pluginRoot = path.resolve(__dirname, "..");
  const result = spawnSync(process.execPath, [path.join(pluginRoot, "scripts", "harness-p7-canary.js")], { encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "pass");
  assert.deepEqual(report.scenarios.map((item) => [item.type, item.story_state, item.pre_pr_status]), [
    ["greenfield", "STORY_VERIFIED", "pass"],
    ["brownfield", "STORY_VERIFIED", "pass"],
  ]);
  assert.ok(report.scenarios[1].graph.impact_candidates > 0);
  assert.equal(report.controlled_measures.injected_sensor_detection_rate, 1);
  assert.equal(report.controlled_measures.sensor_correction_pass_rate, 1);
  assert.ok(report.real_pilot_measures_required.includes("escaped_defects"));
});
