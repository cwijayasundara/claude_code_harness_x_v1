const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");

const pluginRoot = path.resolve(__dirname, "..");
const initializer = path.join(pluginRoot, "scripts", "harness-init.js");
const watcher = path.join(pluginRoot, "scripts", "harness-sensor-watch.js");

test("sensor watch once runs the project-wide sensor scope and writes a session receipt", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-sensor-watch-"));
  execFileSync(process.execPath, [initializer, root], { cwd: pluginRoot, stdio: "ignore" });
  fs.writeFileSync(path.join(root, ".claude", "harness.yaml"), "technology_profiles:\n  - python-fastapi\ndomain_pack: private-equity\n");
  fs.writeFileSync(path.join(root, ".claude", "profiles", "python-fastapi", "sensors.yaml"), "sensors:\n  - id: watch-smoke\n    label: Watch smoke\n    command: node\n    args: [\"-e\", \"process.exit(0)\"]\n    extensions: [\".py\"]\n");
  fs.mkdirSync(path.join(root, "app"));
  // Craft-clean body (print/console.log would warn logging-discipline).
  fs.writeFileSync(path.join(root, "app", "main.py"), "def main() -> str:\n    return \"ok\"\n");

  const output = execFileSync(process.execPath, [watcher, root, "--once"], { cwd: pluginRoot, encoding: "utf8" });
  assert.match(output, /CHECK project-wide/);
  assert.match(output, /STATUS pass/);
  assert.match(output, /Function size/);
  assert.match(output, /Exception handling/);
  const receipt = JSON.parse(fs.readFileSync(path.join(root, ".claude", "specs", "evidence", "runtime", "sensor-watch.json"), "utf8"));
  assert.equal(receipt.mode, "once");
  assert.equal(receipt.runs, 1);
  assert.equal(receipt.last_status, "pass");
});
