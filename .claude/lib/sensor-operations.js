const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { workspaceFingerprint } = require("./sensor-scope");

const DEFAULT_POLICY = Object.freeze({
  version: 1,
  sensor_timeout_ms: 120000,
  max_feedback_seconds: 180,
  freshness_minutes: { completion: 30, pre_pr: 20, ci: 20 },
  watch_heartbeat_seconds: 60,
  bad_code_canary_max_age_hours: 168,
  flakiness: { window_runs: 20, minimum_samples: 6, maximum_transition_rate: 0.4 },
  retention: { maximum_history_entries: 10000, minimum_days: 30 },
  attestation: { required_in_ci: false, public_key_path: null },
  production_slos: { maximum_false_green_rate: 0.01, minimum_sensor_availability: 0.99 },
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function digest(value) { return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function historyPath(root) { return path.join(path.resolve(root), ".claude", "specs", "evidence", "runtime", "sensor-history.jsonl"); }

function loadOperationsPolicy(root) {
  const filePath = path.join(path.resolve(root), ".claude", "project", "sensor-operations.json");
  const policy = fs.existsSync(filePath) ? { ...DEFAULT_POLICY, ...JSON.parse(fs.readFileSync(filePath, "utf8")) } : structuredClone(DEFAULT_POLICY);
  policy.freshness_minutes = { ...DEFAULT_POLICY.freshness_minutes, ...(policy.freshness_minutes || {}) };
  policy.flakiness = { ...DEFAULT_POLICY.flakiness, ...(policy.flakiness || {}) };
  policy.retention = { ...DEFAULT_POLICY.retention, ...(policy.retention || {}) };
  policy.attestation = { ...DEFAULT_POLICY.attestation, ...(policy.attestation || {}) };
  policy.production_slos = { ...DEFAULT_POLICY.production_slos, ...(policy.production_slos || {}) };
  if (policy.version !== 1) throw new Error(`${filePath} must declare version 1.`);
  for (const field of ["sensor_timeout_ms", "max_feedback_seconds", "watch_heartbeat_seconds", "bad_code_canary_max_age_hours"]) if (!Number.isInteger(policy[field]) || policy[field] < 1) throw new Error(`${filePath} ${field} must be a positive integer.`);
  for (const [cadence, value] of Object.entries(policy.freshness_minutes)) if (!Number.isInteger(value) || value < 1) throw new Error(`${filePath} freshness_minutes.${cadence} must be a positive integer.`);
  if (!Number.isInteger(policy.flakiness.window_runs) || policy.flakiness.window_runs < 3 || !Number.isInteger(policy.flakiness.minimum_samples) || policy.flakiness.minimum_samples < 3 || policy.flakiness.minimum_samples > policy.flakiness.window_runs) throw new Error(`${filePath} flakiness sample window is invalid.`);
  if (typeof policy.flakiness.maximum_transition_rate !== "number" || policy.flakiness.maximum_transition_rate < 0 || policy.flakiness.maximum_transition_rate > 1) throw new Error(`${filePath} flakiness.maximum_transition_rate must be from 0 to 1.`);
  if (!Number.isInteger(policy.retention.maximum_history_entries) || policy.retention.maximum_history_entries < 100 || !Number.isInteger(policy.retention.minimum_days) || policy.retention.minimum_days < 1) throw new Error(`${filePath} retention policy is invalid.`);
  if (typeof policy.attestation.required_in_ci !== "boolean" || !(policy.attestation.public_key_path === null || typeof policy.attestation.public_key_path === "string")) throw new Error(`${filePath} attestation policy is invalid.`);
  for (const [name, value] of Object.entries(policy.production_slos)) if (typeof value !== "number" || value < 0 || value > 1) throw new Error(`${filePath} production_slos.${name} must be from 0 to 1.`);
  return { filePath, policy };
}

function readHistory(root) {
  const file = historyPath(root);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function appendSensorHistory(root, entry) {
  const file = historyPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const previous = readHistory(root).at(-1);
  const body = { schema_version: 1, ...entry, previous_sha256: previous?.entry_sha256 || null };
  const complete = { ...body, entry_sha256: digest(body) };
  fs.appendFileSync(file, `${JSON.stringify(complete)}\n`, "utf8");
  return complete;
}

function verifySensorHistory(root) {
  const entries = readHistory(root);
  let previous = null;
  let legacyEntries = 0;
  let chainStarted = false;
  for (const [index, entry] of entries.entries()) {
    if (!entry.entry_sha256 && !chainStarted) { legacyEntries += 1; continue; }
    chainStarted = true;
    const { entry_sha256, ...body } = entry;
    if (body.previous_sha256 !== previous || entry_sha256 !== digest(body)) return { valid: false, entries: entries.length, broken_at: index };
    previous = entry_sha256;
  }
  return { valid: true, entries: entries.length, legacy_entries: legacyEntries, head_sha256: previous };
}

function operationalStatus(root, cadence = "completion", now = Date.now()) {
  const projectRoot = path.resolve(root);
  const { policy } = loadOperationsPolicy(projectRoot);
  if (!Object.hasOwn(policy.freshness_minutes, cadence)) throw new Error(`Unknown sensor freshness cadence: ${cadence}`);
  const reportPath = path.join(projectRoot, ".claude", "specs", "evidence", "runtime", "sensor-report.json");
  const reasons = [];
  let report = null;
  if (!fs.existsSync(reportPath)) reasons.push("sensor report is missing");
  else {
    report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const ageMs = now - Date.parse(report.generated_at || 0);
    if (!Number.isFinite(ageMs) || ageMs < -5000 || ageMs > policy.freshness_minutes[cadence] * 60000) reasons.push(`sensor report exceeds ${policy.freshness_minutes[cadence]} minute ${cadence} freshness`);
    if (report.workspace?.sha256 !== workspaceFingerprint(projectRoot).sha256) reasons.push("sensor report targets a different workspace state");
    if (report.blocking_status !== "pass") reasons.push("blocking sensor status is not pass");
    if ((report.runtime_ms || 0) > policy.max_feedback_seconds * 1000) reasons.push(`feedback exceeded ${policy.max_feedback_seconds} second SLO`);
  }
  const history = verifySensorHistory(projectRoot);
  if (!history.valid) reasons.push(`sensor history hash chain is invalid at entry ${history.broken_at}`);
  if (cadence === "ci") {
    const canaryPath = path.join(projectRoot, ".claude", "specs", "evidence", "runtime", "sensor-canary.json");
    if (!fs.existsSync(canaryPath)) reasons.push("deliberate bad-code canary evidence is missing");
    else {
      const canary = JSON.parse(fs.readFileSync(canaryPath, "utf8"));
      const age = now - Date.parse(canary.generated_at || 0);
      if (canary.status !== "pass") reasons.push("deliberate bad-code canary did not pass");
      if (!Number.isFinite(age) || age < 0 || age > policy.bad_code_canary_max_age_hours * 3600000) reasons.push("deliberate bad-code canary evidence is stale");
    }
  }
  return { status: reasons.length ? "fail" : "pass", cadence, reasons, policy, report, history };
}

function assertEvidenceFresh(root, report, cadence = "completion", now = Date.now()) {
  const { policy } = loadOperationsPolicy(root);
  const maximum = policy.freshness_minutes[cadence];
  if (!maximum) throw new Error(`Unknown sensor freshness cadence: ${cadence}`);
  const age = now - Date.parse(report?.generated_at || 0);
  if (!Number.isFinite(age) || age < -5000 || age > maximum * 60000) throw new Error(`Evidence exceeds the ${maximum} minute ${cadence} freshness limit.`);
  if (report.workspace?.sha256 && report.workspace.sha256 !== workspaceFingerprint(root).sha256) throw new Error("Evidence targets a different workspace state.");
  return true;
}

function watcherStatus(root, now = Date.now()) {
  const { policy } = loadOperationsPolicy(root);
  const file = path.join(path.resolve(root), ".claude", "specs", "evidence", "runtime", "sensor-watch.json");
  if (!fs.existsSync(file)) return { status: "not-running", reason: "watch receipt is missing" };
  const receipt = JSON.parse(fs.readFileSync(file, "utf8"));
  if (receipt.state !== "running" || receipt.mode === "once") return { status: "not-running", reason: `watch state is ${receipt.state || "unknown"}`, receipt };
  const age = now - Date.parse(receipt.heartbeat_at || 0);
  if (!Number.isFinite(age) || age < 0 || age > policy.watch_heartbeat_seconds * 1000) return { status: "stale", reason: "watch heartbeat is stale", receipt };
  try { process.kill(receipt.pid, 0); } catch { return { status: "crashed", reason: "recorded watch process is unavailable", receipt }; }
  return { status: "running", reason: `healthy ${receipt.backend || "unknown"} watcher`, receipt };
}

function analyzeFlakiness(root) {
  const { policy } = loadOperationsPolicy(root);
  const grouped = new Map();
  for (const entry of readHistory(root)) {
    if (!entry.sensor_id || !entry.status) continue;
    const values = grouped.get(entry.sensor_id) || [];
    values.push(entry);
    grouped.set(entry.sensor_id, values);
  }
  const sensors = [...grouped.entries()].map(([sensorId, all]) => {
    const samples = all.slice(-policy.flakiness.window_runs);
    let transitions = 0;
    for (let index = 1; index < samples.length; index += 1) if (samples[index].status !== samples[index - 1].status) transitions += 1;
    const transitionRate = samples.length < 2 ? 0 : transitions / (samples.length - 1);
    return { sensor_id: sensorId, samples: samples.length, transitions, transition_rate: transitionRate, flaky: samples.length >= policy.flakiness.minimum_samples && transitionRate > policy.flakiness.maximum_transition_rate };
  });
  return { schema_version: 1, generated_at: new Date().toISOString(), sensors, quarantine_candidates: sensors.filter((sensor) => sensor.flaky), applies_automatically: false, decision_authority: "human" };
}

function compactHistory(root, now = Date.now()) {
  const { policy } = loadOperationsPolicy(root);
  const entries = readHistory(root);
  const excess = entries.length - policy.retention.maximum_history_entries;
  if (excess <= 0) return { compacted: false, archived_entries: 0, retained_entries: entries.length };
  const cutoff = now - policy.retention.minimum_days * 86400000;
  let archiveCount = 0;
  while (archiveCount < excess && Date.parse(entries[archiveCount]?.timestamp || 0) <= cutoff) archiveCount += 1;
  if (!archiveCount) return { compacted: false, archived_entries: 0, retained_entries: entries.length, reason: "excess entries are inside minimum retention window" };
  const archived = entries.slice(0, archiveCount);
  const retained = entries.slice(archiveCount);
  const archiveBody = archived.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  const archiveSha = crypto.createHash("sha256").update(archiveBody).digest("hex");
  const directory = path.join(path.resolve(root), ".claude", "specs", "evidence", "runtime", "history-archive");
  fs.mkdirSync(directory, { recursive: true });
  const archive = path.join(directory, `${new Date(now).toISOString().replace(/[:.]/g, "-")}-${archiveSha.slice(0, 12)}.jsonl.gz`);
  fs.writeFileSync(archive, zlib.gzipSync(archiveBody));
  let previous = null;
  const rechained = retained.map((entry, index) => {
    const { entry_sha256: _oldHash, previous_sha256: _oldPrevious, ...data } = entry;
    const body = { ...data, ...(index === 0 ? { archive_sha256: archiveSha } : {}), previous_sha256: previous };
    const complete = { ...body, entry_sha256: digest(body) };
    previous = complete.entry_sha256;
    return complete;
  });
  fs.writeFileSync(historyPath(root), rechained.map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");
  return { compacted: true, archived_entries: archived.length, retained_entries: rechained.length, archive, archive_sha256: archiveSha };
}

module.exports = { DEFAULT_POLICY, analyzeFlakiness, appendSensorHistory, assertEvidenceFresh, compactHistory, loadOperationsPolicy, operationalStatus, readHistory, verifySensorHistory, watcherStatus };
