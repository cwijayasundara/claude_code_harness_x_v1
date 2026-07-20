const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { appendEvent } = require("./improvement-ratchet");
const { loadOperationsPolicy } = require("./sensor-operations");

const TYPES = new Set(["escaped-defect", "security-incident", "performance-regression", "false-green"]);
function hash(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function inside(root, relative) {
  const absolute = path.resolve(root, relative); const resolved = path.relative(root, absolute);
  if (!resolved || resolved.startsWith("..") || path.isAbsolute(resolved) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`Invalid production evidence path: ${relative}`);
  return { absolute, relative: resolved };
}
function recordProductionFeedback(root, input) {
  const projectRoot = path.resolve(root);
  for (const field of ["feedback_id", "change_id", "observed_at", "owner", "summary"]) if (typeof input[field] !== "string" || !input[field]) throw new Error(`Production feedback requires ${field}.`);
  if (!/^[A-Za-z0-9._-]+$/.test(input.feedback_id)) throw new Error("feedback_id contains unsupported characters.");
  if (!TYPES.has(input.type)) throw new Error("Production feedback type is invalid.");
  if (!Array.isArray(input.evidence_refs) || !input.evidence_refs.length) throw new Error("Production feedback requires evidence_refs.");
  const references = input.evidence_refs.map((reference) => {
    if (typeof reference.label !== "string" || !reference.label) throw new Error("Production evidence label is required.");
    const file = inside(projectRoot, reference.path);
    return { label: reference.label, path: file.relative, sha256: hash(file.absolute) };
  });
  const record = { schema_version: 1, recorded_at: new Date().toISOString(), ...input, evidence_refs: references };
  const directory = path.join(projectRoot, ".claude", "specs", "evidence", "production");
  const output = path.join(directory, `${record.feedback_id}.json`);
  fs.mkdirSync(directory, { recursive: true });
  if (fs.existsSync(output)) throw new Error(`Production feedback is immutable and already exists: ${record.feedback_id}`);
  fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  appendEvent(projectRoot, { event_key: `production:${record.feedback_id}`, change_id: record.change_id, stage: "OPERATIONS", type: record.type, classification: `operations.${record.type}`, severity: record.type === "false-green" || record.type === "security-incident" ? "blocking" : "high", measurements: input.measurements || {}, summary: record.summary, evidence_refs: [{ label: "production-feedback", path: path.relative(projectRoot, output) }] });
  return { record, output };
}
function summarizeProductionFeedback(root) {
  const directory = path.join(path.resolve(root), ".claude", "specs", "evidence", "production");
  const records = fs.existsSync(directory) ? fs.readdirSync(directory).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"))) : [];
  const delivered = records.reduce((sum, record) => sum + (record.measurements?.delivered_changes || 0), 0);
  const falseGreens = records.reduce((sum, record) => sum + (record.measurements?.false_greens || (record.type === "false-green" ? 1 : 0)), 0);
  const expectedRuns = records.reduce((sum, record) => sum + (record.measurements?.sensor_expected_runs || 0), 0);
  const availableRuns = records.reduce((sum, record) => sum + (record.measurements?.sensor_available_runs || 0), 0);
  return { total: records.length, by_type: Object.fromEntries([...TYPES].map((type) => [type, records.filter((record) => record.type === type).length])), false_green_rate: delivered ? falseGreens / delivered : null, sensor_availability: expectedRuns ? availableRuns / expectedRuns : null };
}
function evaluateProductionSlos(root) {
  const metrics = summarizeProductionFeedback(root); const { policy } = loadOperationsPolicy(root);
  const checks = [
    { id: "false-green-rate", actual: metrics.false_green_rate, required: policy.production_slos.maximum_false_green_rate, pass: metrics.false_green_rate !== null && metrics.false_green_rate <= policy.production_slos.maximum_false_green_rate },
    { id: "sensor-availability", actual: metrics.sensor_availability, required: policy.production_slos.minimum_sensor_availability, pass: metrics.sensor_availability !== null && metrics.sensor_availability >= policy.production_slos.minimum_sensor_availability },
  ];
  return { status: checks.some((check) => check.actual === null) ? "insufficient-evidence" : checks.every((check) => check.pass) ? "pass" : "hold", decision_authority: "human", metrics, checks };
}
module.exports = { evaluateProductionSlos, recordProductionFeedback, summarizeProductionFeedback };
