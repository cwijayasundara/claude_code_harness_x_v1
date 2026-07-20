const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const test = require("node:test");
const { appendSensorHistory, assertEvidenceFresh, verifySensorHistory, watcherStatus } = require("../lib/sensor-operations");

function root() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "sensor-operations-"));
  execFileSync("git", ["init", "-q", project]);
  fs.mkdirSync(path.join(project, ".claude", "project"), { recursive: true });
  fs.writeFileSync(path.join(project, ".claude", "project", "sensor-operations.json"), JSON.stringify({ version: 1, sensor_timeout_ms: 1000, max_feedback_seconds: 10, freshness_minutes: { completion: 1, pre_pr: 1, ci: 1 }, watch_heartbeat_seconds: 1, bad_code_canary_max_age_hours: 1 }));
  return project;
}

test("sensor history is hash chained and detects tampering", () => {
  const project = root();
  appendSensorHistory(project, { timestamp: new Date().toISOString(), sensor_id: "lint", status: "pass" });
  appendSensorHistory(project, { timestamp: new Date().toISOString(), sensor_id: "test", status: "pass" });
  assert.equal(verifySensorHistory(project).valid, true);
  const file = path.join(project, ".claude", "specs", "evidence", "runtime", "sensor-history.jsonl");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"status":"pass"', '"status":"fail"'));
  assert.equal(verifySensorHistory(project).valid, false);
});

test("completion freshness rejects stale evidence", () => {
  const project = root();
  assert.throws(() => assertEvidenceFresh(project, { generated_at: "2020-01-01T00:00:00.000Z" }, "completion"), /freshness limit/);
});

test("watch status exposes stopped and stale watchers", () => {
  const project = root();
  const file = path.join(project, ".claude", "specs", "evidence", "runtime", "sensor-watch.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ state: "stopped", mode: "watch" }));
  assert.equal(watcherStatus(project).status, "not-running");
  fs.writeFileSync(file, JSON.stringify({ state: "running", mode: "watch", heartbeat_at: "2020-01-01T00:00:00.000Z", pid: process.pid }));
  assert.equal(watcherStatus(project).status, "stale");
});

test("deliberate bad-code canary proves representative detections", () => {
  const project = root();
  const script = path.resolve(__dirname, "..", "scripts", "harness-sensor-canary.js");
  const result = spawnSync(process.execPath, [script, project], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(project, ".claude", "specs", "evidence", "runtime", "sensor-canary.json"), "utf8"));
  assert.equal(report.status, "pass");
  assert.deepEqual(report.probes.map((probe) => probe.detected), [true, true, true]);
});
