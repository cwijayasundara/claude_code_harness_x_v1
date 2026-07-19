const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");

const pluginRoot = path.resolve(__dirname, "..");
const initializer = path.join(pluginRoot, "scripts", "harness-init.js");

function initialize(targetRoot) {
  return execFileSync(process.execPath, [initializer, targetRoot], {
    cwd: pluginRoot,
    encoding: "utf8",
  });
}

test("initializes a progressive-disclosure CLAUDE.md without overwriting it", () => {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-init-"));
  const guidePath = path.join(targetRoot, "CLAUDE.md");

  const firstRun = initialize(targetRoot);
  const generatedGuide = fs.readFileSync(guidePath, "utf8");

  assert.match(firstRun, /CREATE .*CLAUDE\.md/);
  assert.match(generatedGuide, /entry-point map, not the full operating manual/);
  assert.match(generatedGuide, /\.claude\/project\/architecture\.md/);
  const controlManifest = JSON.parse(fs.readFileSync(path.join(targetRoot, ".claude", "harness-manifest.json"), "utf8"));
  assert.equal(controlManifest.version, 1);
  assert.ok(controlManifest.controls.some((control) => control.id === "profile-verification"));
  assert.equal(controlManifest.control_budget.max_active, 14);
  assert.ok(controlManifest.control_budget.baseline_ids.includes("delivery-workflow"));
  assert.ok(controlManifest.control_budget.baseline_ids.includes("file-size"));
  assert.ok(controlManifest.control_budget.baseline_ids.includes("near-duplication"));
  assert.ok(fs.existsSync(path.join(targetRoot, ".claude", "project", "maintainability.json")));

  fs.writeFileSync(guidePath, "# Existing project guide\n");
  const secondRun = initialize(targetRoot);

  assert.match(secondRun, /SKIP .*CLAUDE\.md \(already exists\)/);
  assert.equal(fs.readFileSync(guidePath, "utf8"), "# Existing project guide\n");
});
