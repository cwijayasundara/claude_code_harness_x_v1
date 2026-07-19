const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");

const pluginRoot = path.resolve(__dirname, "..");
const initializer = path.join(pluginRoot, "scripts", "harness-init.js");
const status = path.join(pluginRoot, "scripts", "harness-status.js");

test("status reports installation and operational-health signals", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-status-"));
  execFileSync(process.execPath, [initializer, root], { cwd: pluginRoot, stdio: "ignore" });
  fs.mkdirSync(path.join(root, ".claude", "specs", "evidence", "runtime"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "specs", "evidence", "runtime", "sensor-report.json"), JSON.stringify({ status: "pass", generated_at: "2026-07-18T00:00:00.000Z" }));
  fs.writeFileSync(path.join(root, ".claude", "specs", "evidence", "runtime", "harness-doctor.json"), JSON.stringify({ status: "pass" }));
  const output = execFileSync(process.execPath, [status, root], { cwd: pluginRoot, encoding: "utf8" });
  assert.match(output, /Installed harness: 0\.2\.0/);
  assert.match(output, /Latest sensors: pass/);
  assert.match(output, /Environment doctor: pass/);
  assert.match(output, /Real-pilot readiness/);
  assert.match(output, /Status: insufficient-evidence; rollout authority: human/);
});

test("agent status gives concise correction guidance and a sensor trend", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-agent-status-"));
  execFileSync(process.execPath, [initializer, root], { cwd: pluginRoot, stdio: "ignore" });
  const evidence = path.join(root, ".claude", "specs", "evidence", "runtime");
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, "sensor-report.json"), JSON.stringify({
    status: "fail",
    generated_at: "2026-07-18T00:00:00.000Z",
    sensors: [{
      sensor_id: "secret-scan",
      status: "fail",
      affected_paths: ["app/config.py"],
      reason: "Potential committed secret found.",
      next_action: "Remove the secret.",
    }],
  }));
  fs.writeFileSync(path.join(evidence, "sensor-history.jsonl"), [
    JSON.stringify({ sensor_id: "secret-scan", status: "pass" }),
    JSON.stringify({ sensor_id: "secret-scan", status: "fail" }),
  ].join("\n") + "\n");

  const output = execFileSync(process.execPath, [status, root, "--agent"], { cwd: pluginRoot, encoding: "utf8" });
  assert.match(output, /SENSOR STATUS: fail/);
  assert.match(output, /FAIL secret-scan \[worse\]/);
  assert.match(output, /PATHS: app\/config.py/);
  assert.match(output, /Remove and rotate the exposed credential/);
});
