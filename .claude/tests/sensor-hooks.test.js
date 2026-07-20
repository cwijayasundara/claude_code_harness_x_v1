const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const test = require("node:test");

const pluginRoot = path.resolve(__dirname, "..");
const hook = path.join(pluginRoot, "hooks", "sensor-lifecycle.js");
const initializer = path.join(pluginRoot, "scripts", "harness-init.js");

function invoke(command, input, ...args) {
  return spawnSync(process.execPath, [hook, command, ...args], { input: JSON.stringify(input), encoding: "utf8", timeout: 30000 });
}
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sensor-hook-"));
  execFileSync(process.execPath, [initializer, root], { cwd: pluginRoot, stdio: "ignore" });
  fs.writeFileSync(path.join(root, ".claude", "harness.yaml"), "technology_profiles:\n  - python-fastapi\ndomain_pack: private-equity\n");
  fs.writeFileSync(path.join(root, ".claude", "profiles", "python-fastapi", "sensors.yaml"), "sensors:\n  - id: hook-smoke\n    label: Hook smoke\n    command: node\n    args: [\"-e\", \"process.exit(0)\"]\n    extensions: [\".py\"]\n");
  fs.writeFileSync(path.join(root, ".claude", "project", "boundaries.json"), JSON.stringify({ version: 1, rules: [{ id: "app-no-forbidden", from: "app/", forbidden: ["forbidden/"], extensions: [".py"], reason: "Fixture." }] }));
  fs.writeFileSync(path.join(root, ".claude", "project", "dependency-sensors.json"), JSON.stringify({ version: 1, approved_roots: ["app"] }));
  fs.writeFileSync(path.join(root, ".claude", "project", "regression-sensors.json"), JSON.stringify({ version: 1, test_integrity: { enabled: false } }));
  fs.mkdirSync(path.join(root, "app"));
  fs.writeFileSync(path.join(root, "app", "main.py"), "def main() -> str:\n    return 'ok'\n");
  return root;
}

test("plugin registers edit scheduling and fail-closed completion hooks", () => {
  const document = JSON.parse(fs.readFileSync(path.join(pluginRoot, "hooks", "hooks.json"), "utf8"));
  assert.equal(document.hooks.PostToolUse[0].matcher, "Edit|Write|NotebookEdit");
  assert.equal(document.hooks.PostToolUse[0].hooks[0].async, true);
  assert.deepEqual(document.hooks.Stop[0].hooks[0].args.slice(-2), ["gate", "completion"]);
  assert.ok(document.hooks.TaskCompleted);
  assert.equal(document.hooks.SubagentStop[0].matcher, "^lean-expert-generalist-harness:harness-generator$");
});

test("hooks are inert outside an installed harness", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sensor-hook-inert-"));
  assert.equal(invoke("gate", { cwd: root, hook_event_name: "Stop" }, "completion").status, 0);
});

test("PostToolUse schedules changed-path sensors and writes fresh evidence", () => {
  const root = project();
  const result = invoke("post-tool", { cwd: root, hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: path.join(root, "app", "main.py") } });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(root, ".claude", "specs", "evidence", "runtime", "sensor-report.json"), "utf8"));
  assert.equal(report.changed_paths.includes("app/main.py"), true);
});

test("Stop hook translates a blocking sensor result to Claude Code exit 2", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "app", "main.py"), "API_KEY = 'AKIAIOSFODNN7EXAMPLE'\n");
  const first = invoke("gate", { cwd: root, hook_event_name: "Stop", stop_hook_active: false }, "completion");
  assert.equal(first.status, 2);
  assert.match(first.stderr, /blocked completion/);
  assert.match(first.stderr, /secret-scan/);
  const repeated = invoke("gate", { cwd: root, hook_event_name: "Stop", stop_hook_active: true }, "completion");
  assert.equal(repeated.status, 2);
  assert.match(repeated.stderr, /Do not claim completion/);
});
