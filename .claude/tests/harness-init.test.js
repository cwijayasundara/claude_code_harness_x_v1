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
  assert.match(generatedGuide, /When compacting, preserve active change\/story IDs/);
  assert.match(generatedGuide, /separate Git worktree/);
  const controlManifest = JSON.parse(fs.readFileSync(path.join(targetRoot, ".claude", "harness-manifest.json"), "utf8"));
  assert.equal(controlManifest.version, 1);
  assert.ok(controlManifest.controls.some((control) => control.id === "profile-verification"));
  assert.equal(controlManifest.control_budget.max_active, 19);
  assert.ok(controlManifest.control_budget.baseline_ids.includes("delivery-workflow"));
  assert.ok(controlManifest.control_budget.baseline_ids.includes("file-size"));
  assert.ok(controlManifest.control_budget.baseline_ids.includes("function-size"));
  assert.ok(controlManifest.control_budget.baseline_ids.includes("exception-handling"));
  assert.ok(controlManifest.control_budget.baseline_ids.includes("near-duplication"));
  assert.ok(controlManifest.controls.some((control) => control.id === "regression-effectiveness" && control.status === "active"));
  assert.ok(fs.existsSync(path.join(targetRoot, ".claude", "project", "maintainability.json")));
  assert.ok(fs.existsSync(path.join(targetRoot, ".claude", "project", "regression-sensors.json")));
  assert.ok(fs.existsSync(path.join(targetRoot, ".claude", "project", "large-codebase.md")));
  const settings = JSON.parse(fs.readFileSync(path.join(targetRoot, ".claude", "settings.json"), "utf8"));
  assert.ok(settings.permissions.deny.includes("Read(./**/generated/**)"));
  assert.equal(settings.model, "sonnet");
  assert.equal(settings.effortLevel, "medium");
  assert.equal(settings.autoCompactEnabled, true);
  assert.equal(settings.env.MAX_THINKING_TOKENS, "8000");
  assert.equal(settings.teammateDefaultModel, "sonnet");
  assert.equal(settings.workflowSizeGuideline, "small");
  assert.match(settings.statusLine.command, /harness-cost-statusline\.js/);
  assert.ok(fs.existsSync(path.join(targetRoot, ".claude", "scripts", "harness-cost-statusline.js")));
  assert.ok(fs.existsSync(path.join(targetRoot, ".claude", "specs", "vibe-to-harness.template.md")));

  fs.writeFileSync(guidePath, "# Existing project guide\n");
  const secondRun = initialize(targetRoot);

  assert.match(secondRun, /SKIP .*CLAUDE\.md \(already exists\)/);
  assert.equal(fs.readFileSync(guidePath, "utf8"), "# Existing project guide\n");
});
