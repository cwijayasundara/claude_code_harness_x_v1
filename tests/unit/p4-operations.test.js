const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const test = require("node:test");
const { attest, verifyAttestation } = require("../../.claude/lib/evidence-attestation");
const { recordProductionFeedback, summarizeProductionFeedback } = require("../../.claude/lib/production-feedback");
const { analyzeFlakiness, appendSensorHistory, compactHistory, verifySensorHistory } = require("../../.claude/lib/sensor-operations");
const { applyQuarantine, validateQuarantines } = require("../../.claude/lib/sensor-quarantine");

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p4-operations-"));
  execFileSync("git", ["init", "-q", root]);
  fs.mkdirSync(path.join(root, ".claude", "project"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "project", "sensor-operations.json"), JSON.stringify({ version: 1, sensor_timeout_ms: 1000, max_feedback_seconds: 10, freshness_minutes: { completion: 5, pre_pr: 5, ci: 5 }, watch_heartbeat_seconds: 5, bad_code_canary_max_age_hours: 1, flakiness: { window_runs: 6, minimum_samples: 6, maximum_transition_rate: 0.4 }, retention: { maximum_history_entries: 100, minimum_days: 1 }, attestation: { required_in_ci: false, public_key_path: null } }));
  return root;
}

test("flakiness is measured but quarantine requires explicit unexpired human approval", () => {
  const root = project();
  for (let index = 0; index < 6; index += 1) appendSensorHistory(root, { timestamp: new Date().toISOString(), sensor_id: "lint", status: index % 2 ? "fail" : "pass" });
  assert.equal(analyzeFlakiness(root).quarantine_candidates[0].sensor_id, "lint");
  const document = { version: 1, quarantines: [{ id: "lint-flake", sensor_id: "lint", owner: "team", approved_by: "human", reason: "Known nondeterministic upstream tool.", expires_on: "2099-01-01", minimum_samples: 6 }] };
  assert.deepEqual(validateQuarantines(document), []);
  const result = applyQuarantine({ sensor_id: "lint", status: "fail", reason: "failed", next_action: "fix" }, document, 6);
  assert.equal(result.status, "warn");
  assert.equal(result.quarantine_id, "lint-flake");
  assert.ok(validateQuarantines({ version: 1, quarantines: [{ ...document.quarantines[0], sensor_id: "secret-scan" }] }).length);
});

test("history retention archives old evidence and preserves a valid live chain", () => {
  const root = project();
  for (let index = 0; index < 101; index += 1) appendSensorHistory(root, { timestamp: "2020-01-01T00:00:00.000Z", sensor_id: "lint", status: "pass", index });
  const compacted = compactHistory(root);
  assert.equal(compacted.compacted, true);
  assert.equal(compacted.archived_entries, 1);
  assert.ok(fs.existsSync(compacted.archive));
  assert.equal(verifySensorHistory(root).valid, true);
});

test("Ed25519 attestation detects changed sensor evidence", () => {
  const root = project();
  const runtime = path.join(root, ".claude", "specs", "evidence", "runtime");
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(path.join(runtime, "sensor-report.json"), "{}\n");
  appendSensorHistory(root, { timestamp: new Date().toISOString(), sensor_id: "lint", status: "pass" });
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const privatePath = path.join(root, "private.pem"); const publicPath = path.join(root, "public.pem");
  fs.writeFileSync(privatePath, privateKey.export({ type: "pkcs8", format: "pem" }));
  fs.writeFileSync(publicPath, publicKey.export({ type: "spki", format: "pem" }));
  attest(root, privatePath);
  assert.equal(verifyAttestation(root, "public.pem").valid, true);
  fs.writeFileSync(path.join(runtime, "sensor-report.json"), "changed\n");
  assert.equal(verifyAttestation(root, "public.pem").valid, false);
});

test("production feedback is immutable, evidence-backed, and summarized", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "incident.json"), "{}\n");
  const input = { feedback_id: "prod-1", change_id: "C-1", observed_at: new Date().toISOString(), owner: "service", type: "false-green", summary: "Sensors passed before an escaped defect.", measurements: { escaped_defects: 1 }, evidence_refs: [{ label: "incident", path: "incident.json" }] };
  recordProductionFeedback(root, input);
  assert.equal(summarizeProductionFeedback(root).by_type["false-green"], 1);
  assert.throws(() => recordProductionFeedback(root, input), /immutable/);
});

test("managed Git hooks install without overwriting external hooks", () => {
  const root = project();
  const script = path.resolve(__dirname, "../../.claude/scripts/harness-git-hooks.js");
  execFileSync(process.execPath, [script, "install", "--root", root]);
  const hooks = path.join(root, ".git", "hooks");
  assert.match(fs.readFileSync(path.join(hooks, "pre-commit"), "utf8"), /managed-by-lean-expert-generalist-harness/);
  fs.writeFileSync(path.join(hooks, "pre-push"), "#!/bin/sh\nexternal\n");
  const result = spawnSync(process.execPath, [script, "install", "--root", root], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to overwrite/);
});
