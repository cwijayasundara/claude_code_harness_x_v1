const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");

const pluginRoot = path.resolve(__dirname, "..");
const initializer = path.join(pluginRoot, "scripts", "harness-init.js");
const doctor = path.join(pluginRoot, "scripts", "harness-doctor.js");

test("doctor passes when configured sensor prerequisites are available", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-doctor-"));
  execFileSync(process.execPath, [initializer, root], { cwd: pluginRoot, stdio: "ignore" });
  fs.writeFileSync(path.join(root, ".claude", "harness.yaml"), "technology_profiles:\n  - python-fastapi\ndomain_pack: private-equity\n");
  fs.writeFileSync(path.join(root, ".claude", "profiles", "python-fastapi", "sensors.yaml"), `
sensors:
  - id: node-check
    label: Node check
    command: node
    args: ["--version"]
    extensions: [".py"]
`);
  execFileSync(process.execPath, [doctor, root], { cwd: pluginRoot });
  const report = JSON.parse(fs.readFileSync(path.join(root, ".claude", "specs", "evidence", "runtime", "harness-doctor.json"), "utf8"));
  assert.equal(report.status, "pass");
  assert.equal(report.findings[0].sensor_id, "node-check");
});
