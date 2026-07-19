const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_POLICY = Object.freeze({
  schema_version: 1,
  minimum_pilots: { greenfield: 3, brownfield: 3 },
  minimum_observation_days: 14,
  thresholds: {
    minimum_first_pass_acceptance_rate: 0.8,
    maximum_mean_human_review_minutes: 30,
    maximum_escaped_defects_per_accepted_story: 0.1,
    minimum_sensor_precision: 0.8,
    minimum_sensor_correction_rate: 0.9,
    maximum_mean_provider_cost_per_accepted_story_usd: 5,
    minimum_brownfield_graph_useful_rate: 0.6,
  },
});

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function inside(root, suppliedPath) {
  const absolute = path.resolve(root, suppliedPath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Evidence path escapes the project: ${suppliedPath}`);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`Evidence file does not exist: ${suppliedPath}`);
  return { absolute, relative };
}

function finite(record, field, { integer = false } = {}) {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`Pilot ${field} must be a non-negative${integer ? " integer" : " number"}.`);
  }
}

function validatePolicy(policy) {
  for (const type of ["greenfield", "brownfield"]) {
    if (!Number.isInteger(policy.minimum_pilots?.[type]) || policy.minimum_pilots[type] < 1) throw new Error(`Pilot policy minimum_pilots.${type} must be a positive integer.`);
  }
  if (!Number.isInteger(policy.minimum_observation_days) || policy.minimum_observation_days < 1) throw new Error("Pilot policy minimum_observation_days must be a positive integer.");
  for (const name of Object.keys(DEFAULT_POLICY.thresholds)) {
    const value = policy.thresholds?.[name];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`Pilot policy threshold ${name} must be non-negative.`);
  }
  return policy;
}

function loadPolicy(root) {
  const file = path.join(path.resolve(root), ".claude", "pilot-policy.json");
  return validatePolicy(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : structuredClone(DEFAULT_POLICY));
}

function normalizeRecord(root, input) {
  const record = structuredClone(input);
  for (const field of ["pilot_id", "change_id", "reviewer", "completed_at"]) if (typeof record[field] !== "string" || !record[field]) throw new Error(`Pilot requires ${field}.`);
  if (!/^[A-Za-z0-9._-]+$/.test(record.pilot_id)) throw new Error("Pilot pilot_id may contain only letters, digits, dot, underscore, and hyphen.");
  if (!["greenfield", "brownfield"].includes(record.scenario_type)) throw new Error("Pilot scenario_type must be greenfield or brownfield.");
  if (!["accepted", "rejected"].includes(record.outcome)) throw new Error("Pilot outcome must be accepted or rejected.");
  if (typeof record.first_pass_accepted !== "boolean") throw new Error("Pilot first_pass_accepted must be boolean.");
  for (const field of ["story_count", "escaped_defects", "observation_days", "sensor_findings", "sensor_true_positives", "sensor_findings_corrected"]) finite(record, field, { integer: true });
  for (const field of ["human_review_minutes", "provider_cost_usd"]) finite(record, field);
  if (record.story_count < 1) throw new Error("Pilot story_count must be at least one.");
  if (record.sensor_true_positives > record.sensor_findings) throw new Error("Pilot sensor_true_positives cannot exceed sensor_findings.");
  if (record.sensor_findings_corrected > record.sensor_true_positives) throw new Error("Pilot sensor_findings_corrected cannot exceed sensor_true_positives.");
  if (record.scenario_type === "brownfield") {
    for (const field of ["graph_queries", "graph_useful_results"]) finite(record, field, { integer: true });
    if (record.graph_queries < 1 || record.graph_useful_results > record.graph_queries) throw new Error("Brownfield pilots require graph queries and useful results no greater than queries.");
  }
  if (!Array.isArray(record.evidence_refs) || record.evidence_refs.length === 0) throw new Error("Pilot requires at least one evidence_ref.");
  record.evidence_refs = record.evidence_refs.map((reference) => {
    if (typeof reference.label !== "string" || !reference.label || typeof reference.path !== "string") throw new Error("Each pilot evidence_ref requires label and path.");
    const evidence = inside(path.resolve(root), reference.path);
    return { label: reference.label, path: evidence.relative, sha256: sha256(evidence.absolute) };
  });
  const labels = new Set(record.evidence_refs.map((reference) => reference.label));
  const requiredEvidence = ["branch-readiness", "human-review", "defect-observation", "sensor-assessment", "provider-receipt"];
  if (record.scenario_type === "brownfield") requiredEvidence.push("graph-assessment");
  for (const label of requiredEvidence) if (!labels.has(label)) throw new Error(`Pilot requires an evidence_ref labelled ${label}.`);
  if (!Array.isArray(record.residual_risks)) throw new Error("Pilot residual_risks must be an array.");
  return { schema_version: 1, recorded_at: new Date().toISOString(), ...record };
}

function recordPilot(root, input) {
  const projectRoot = path.resolve(root);
  const normalized = normalizeRecord(projectRoot, input);
  const directory = path.join(projectRoot, ".claude", "specs", "evidence", "pilots");
  const file = path.join(directory, `${normalized.pilot_id}.json`);
  fs.mkdirSync(directory, { recursive: true });
  if (fs.existsSync(file)) throw new Error(`Pilot record is immutable and already exists: ${normalized.pilot_id}`);
  fs.writeFileSync(file, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return { record: normalized, file };
}

function loadPilots(root) {
  const projectRoot = path.resolve(root);
  const directory = path.join(projectRoot, ".claude", "specs", "evidence", "pilots");
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort().map((name) => {
    const record = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
    for (const reference of record.evidence_refs || []) {
      const evidence = inside(projectRoot, reference.path);
      if (sha256(evidence.absolute) !== reference.sha256) throw new Error(`Pilot evidence drift: ${record.pilot_id} ${reference.path}`);
    }
    return record;
  });
}

function ratio(numerator, denominator) { return denominator === 0 ? null : numerator / denominator; }
function mean(values) { return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length; }

function evaluatePilots(root) {
  const policy = loadPolicy(root);
  const pilots = loadPilots(root);
  const accepted = pilots.filter((record) => record.outcome === "accepted");
  const acceptedStories = accepted.reduce((sum, record) => sum + record.story_count, 0);
  const findings = pilots.reduce((sum, record) => sum + record.sensor_findings, 0);
  const truePositives = pilots.reduce((sum, record) => sum + record.sensor_true_positives, 0);
  const brownfield = pilots.filter((record) => record.scenario_type === "brownfield");
  const metrics = {
    pilot_counts: Object.fromEntries(["greenfield", "brownfield"].map((type) => [type, pilots.filter((record) => record.scenario_type === type).length])),
    first_pass_acceptance_rate: ratio(pilots.filter((record) => record.first_pass_accepted).length, pilots.length),
    mean_human_review_minutes: mean(pilots.map((record) => record.human_review_minutes)),
    escaped_defects_per_accepted_story: ratio(accepted.reduce((sum, record) => sum + record.escaped_defects, 0), acceptedStories),
    sensor_precision: ratio(truePositives, findings),
    sensor_correction_rate: ratio(pilots.reduce((sum, record) => sum + record.sensor_findings_corrected, 0), truePositives),
    mean_provider_cost_per_accepted_story_usd: ratio(accepted.reduce((sum, record) => sum + record.provider_cost_usd, 0), acceptedStories),
    brownfield_graph_useful_rate: ratio(brownfield.reduce((sum, record) => sum + record.graph_useful_results, 0), brownfield.reduce((sum, record) => sum + record.graph_queries, 0)),
  };
  const checks = [
    ...["greenfield", "brownfield"].map((type) => ({ id: `minimum_${type}_pilots`, pass: metrics.pilot_counts[type] >= policy.minimum_pilots[type], actual: metrics.pilot_counts[type], required: policy.minimum_pilots[type] })),
    { id: "observation_window", pass: pilots.length > 0 && pilots.every((record) => record.observation_days >= policy.minimum_observation_days), actual: pilots.length ? Math.min(...pilots.map((record) => record.observation_days)) : 0, required: policy.minimum_observation_days },
    { id: "first_pass_acceptance", pass: metrics.first_pass_acceptance_rate !== null && metrics.first_pass_acceptance_rate >= policy.thresholds.minimum_first_pass_acceptance_rate, actual: metrics.first_pass_acceptance_rate, required: policy.thresholds.minimum_first_pass_acceptance_rate },
    { id: "human_review", pass: metrics.mean_human_review_minutes !== null && metrics.mean_human_review_minutes <= policy.thresholds.maximum_mean_human_review_minutes, actual: metrics.mean_human_review_minutes, required: policy.thresholds.maximum_mean_human_review_minutes },
    { id: "escaped_defects", pass: metrics.escaped_defects_per_accepted_story !== null && metrics.escaped_defects_per_accepted_story <= policy.thresholds.maximum_escaped_defects_per_accepted_story, actual: metrics.escaped_defects_per_accepted_story, required: policy.thresholds.maximum_escaped_defects_per_accepted_story },
    { id: "sensor_precision", pass: metrics.sensor_precision !== null && metrics.sensor_precision >= policy.thresholds.minimum_sensor_precision, actual: metrics.sensor_precision, required: policy.thresholds.minimum_sensor_precision },
    { id: "sensor_correction", pass: metrics.sensor_correction_rate !== null && metrics.sensor_correction_rate >= policy.thresholds.minimum_sensor_correction_rate, actual: metrics.sensor_correction_rate, required: policy.thresholds.minimum_sensor_correction_rate },
    { id: "provider_cost", pass: metrics.mean_provider_cost_per_accepted_story_usd !== null && metrics.mean_provider_cost_per_accepted_story_usd <= policy.thresholds.maximum_mean_provider_cost_per_accepted_story_usd, actual: metrics.mean_provider_cost_per_accepted_story_usd, required: policy.thresholds.maximum_mean_provider_cost_per_accepted_story_usd },
    { id: "graph_value", pass: metrics.brownfield_graph_useful_rate !== null && metrics.brownfield_graph_useful_rate >= policy.thresholds.minimum_brownfield_graph_useful_rate, actual: metrics.brownfield_graph_useful_rate, required: policy.thresholds.minimum_brownfield_graph_useful_rate },
  ];
  const countChecksPass = checks.filter((check) => check.id.startsWith("minimum_") || check.id === "observation_window").every((check) => check.pass);
  const status = !countChecksPass ? "insufficient-evidence" : checks.every((check) => check.pass) ? "eligible-for-human-rollout-decision" : "hold";
  return { schema_version: 1, generated_at: new Date().toISOString(), status, decision_authority: "human", policy, metrics, checks };
}

function writeReport(root) {
  const report = evaluatePilots(root);
  const file = path.join(path.resolve(root), ".claude", "specs", "evidence", "pilot-readiness.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { report, file };
}

module.exports = { DEFAULT_POLICY, evaluatePilots, loadPilots, loadPolicy, normalizeRecord, recordPilot, writeReport };
