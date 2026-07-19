const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");

const pluginRoot = path.resolve(__dirname, "..");
const initializer = path.join(pluginRoot, "scripts", "harness-init.js");
const runner = path.join(pluginRoot, "scripts", "harness-sensors.js");

test("CI mode turns an unavailable configured sensor into a failing gate with normalized evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sensor-runner-"));
  execFileSync(process.execPath, [initializer, root], { cwd: pluginRoot, stdio: "ignore" });
  fs.mkdirSync(path.join(root, "app"));
  fs.writeFileSync(path.join(root, "app", "main.py"), "print('ok')\n");
  fs.writeFileSync(path.join(root, ".claude", "profiles", "python-fastapi", "sensors.yaml"), `
sensors:
  - id: unavailable-check
    label: Unavailable check
    command: definitely-not-installed
    args: []
    extensions: [".py"]
`);

  assert.throws(() => execFileSync(process.execPath, [runner, root, "--changed", "app/main.py", "--fail-on-warn"], {
    cwd: pluginRoot,
    encoding: "utf8",
  }), (error) => error.status === 1);

  const report = JSON.parse(fs.readFileSync(path.join(root, ".claude", "specs", "evidence", "runtime", "sensor-report.json"), "utf8"));
  assert.equal(report.status, "warn");
  assert.equal(report.sensors[0].status, "warn");
  assert.equal(report.sensors[0].sensor_id, "unavailable-check");
  assert.equal(report.sensors[0].affected_paths[0], "app/main.py");
  assert.match(fs.readFileSync(path.join(root, ".claude", "specs", "evidence", "runtime", "sensor-history.jsonl"), "utf8"), /unavailable-check/);
});
