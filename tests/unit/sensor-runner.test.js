const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");

const pluginRoot = path.resolve(__dirname, "../../.claude");
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
  const architecture = report.sensors.find((sensor) => sensor.sensor_id === "architecture-boundaries");
  assert.equal(architecture.status, "warn");
  assert.equal(architecture.disposition, "blocking");
  assert.equal(report.blocking_status, "fail");
  assert.ok(report.workspace.sha256);
  assert.match(fs.readFileSync(path.join(root, ".claude", "specs", "evidence", "runtime", "sensor-history.jsonl"), "utf8"), /unavailable-check/);
});

test("advisory maintainability warnings do not fail the policy gate", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sensor-policy-"));
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Harness Test"]);
  execFileSync(process.execPath, [initializer, root], { cwd: pluginRoot, stdio: "ignore" });
  fs.writeFileSync(path.join(root, ".claude", "harness.yaml"), "technology_profiles:\n  - python-fastapi\ndomain_pack: private-equity\n");
  fs.writeFileSync(path.join(root, ".claude", "profiles", "python-fastapi", "sensors.yaml"), `
sensors:
  - id: fixture-check
    label: Fixture check
    command: node
    args: ["-e", "process.exit(0)"]
    extensions: [".py"]
`);
  fs.writeFileSync(path.join(root, ".claude", "project", "boundaries.json"), JSON.stringify({
    version: 1,
    rules: [{ id: "app-no-forbidden", from: "app/", forbidden: ["forbidden/"], extensions: [".py"], reason: "Fixture boundary." }],
  }));
  fs.writeFileSync(path.join(root, ".claude", "project", "dependency-sensors.json"), JSON.stringify({ version: 1, approved_roots: ["app"] }));
  fs.mkdirSync(path.join(root, "app"));
  fs.writeFileSync(path.join(root, "app", "main.py"), "def main():\n    print('debug')\n");
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "gitleaks"), "#!/bin/sh\nexit 0\n");
  fs.chmodSync(path.join(bin, "gitleaks"), 0o755);
  fs.mkdirSync(path.join(root, "coverage"));
  fs.mkdirSync(path.join(root, "reports", "mutation"), { recursive: true });
  fs.writeFileSync(path.join(root, "coverage", "coverage-summary.json"), JSON.stringify({ total: { lines: { total: 10, covered: 10, pct: 100 }, branches: { total: 2, covered: 2, pct: 100 } }, "app/main.py": { lines: { total: 2, covered: 2, pct: 100 }, branches: { total: 0, covered: 0, pct: 100 } } }));
  fs.writeFileSync(path.join(root, "reports", "mutation", "mutation.json"), JSON.stringify({ files: { "app/main.py": { mutants: [{ status: "Killed" }] } } }));
  fs.writeFileSync(path.join(root, ".claude", "project", "regression-sensors.json"), JSON.stringify({ version: 1, coverage: { enabled: true }, mutation: { enabled: true } }));

  execFileSync(process.execPath, [runner, root, "--changed", "app/main.py"], {
    cwd: pluginRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });
  const report = JSON.parse(fs.readFileSync(path.join(root, ".claude", "specs", "evidence", "runtime", "sensor-report.json"), "utf8"));
  const logging = report.sensors.find((sensor) => sensor.sensor_id === "logging-discipline");
  assert.equal(logging.status, "warn");
  assert.equal(logging.disposition, "advisory");
  assert.equal(report.status, "warn");
  assert.equal(report.blocking_status, "pass");
  assert.equal(report.sensors.find((sensor) => sensor.sensor_id === "coverage-effectiveness").status, "pass");
  assert.equal(report.sensors.find((sensor) => sensor.sensor_id === "mutation-effectiveness").metrics.changed_survivors, 0);
});
