const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const CLASSIFICATIONS = new Set([
  "unclassified",
  "requirements.ambiguous-outcome", "requirements.missing-edge-case",
  "planning.missing-dependency", "planning.wrong-scope",
  "design.missing-failure-mode", "design.boundary-violation",
  "implementation.pattern-missed", "implementation.unnecessary-complexity",
  "verification.missing-test", "verification.weak-oracle",
  "verification.sensor-false-positive", "verification.sensor-false-negative",
  "operations.escaped-defect", "operations.performance-regression",
  "operations.user-journey-failure", "operations.security-incident",
  "operations.false-green", "economics.excessive-cost",
]);
const CANDIDATE_STATES = new Set([
  "OBSERVED", "CORROBORATED", "PROPOSED", "EXPERIMENT_APPROVED",
  "EXPERIMENTING", "ELIGIBLE", "PROMOTED", "REJECTED", "SUPERSEDED",
  "EXPIRED", "ROLLED_BACK", "HUMAN_DECISION_REQUIRED",
]);
const TERMINAL_CANDIDATE_STATES = new Set(["REJECTED", "SUPERSEDED", "EXPIRED", "ROLLED_BACK"]);
const ALLOWED_TRANSITIONS = Object.freeze({
  OBSERVED: new Set(["CORROBORATED", "REJECTED", "SUPERSEDED", "EXPIRED"]),
  CORROBORATED: new Set(["PROPOSED", "REJECTED", "SUPERSEDED", "EXPIRED"]),
  PROPOSED: new Set(["EXPERIMENT_APPROVED", "REJECTED", "SUPERSEDED", "EXPIRED", "HUMAN_DECISION_REQUIRED"]),
  EXPERIMENT_APPROVED: new Set(["EXPERIMENTING", "ELIGIBLE", "REJECTED", "EXPIRED", "HUMAN_DECISION_REQUIRED"]),
  EXPERIMENTING: new Set(["ELIGIBLE", "REJECTED", "EXPIRED", "HUMAN_DECISION_REQUIRED"]),
  ELIGIBLE: new Set(["PROMOTED", "REJECTED", "EXPIRED", "HUMAN_DECISION_REQUIRED"]),
  PROMOTED: new Set(["ROLLED_BACK", "HUMAN_DECISION_REQUIRED"]),
  HUMAN_DECISION_REQUIRED: new Set(["PROPOSED", "EXPERIMENT_APPROVED", "EXPERIMENTING", "ELIGIBLE", "REJECTED", "EXPIRED"]),
});
const PROTECTED_GUARDRAILS = [
  "escaped_defects", "first_pass_acceptance_rate", "human_review_minutes",
  "provider_cost_per_accepted_story_usd", "active_control_count",
];

function safeId(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function sha256Bytes(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function fingerprint(value) { return sha256Bytes(JSON.stringify(stable(value))); }

function evidenceReference(root, reference) {
  if (!reference || typeof reference.path !== "string") throw new Error("Learning evidence reference requires path.");
  const projectRoot = path.resolve(root);
  const absolute = path.resolve(projectRoot, reference.path);
  const relative = path.relative(projectRoot, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Learning evidence path escapes the project: ${reference.path}`);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`Learning evidence does not exist: ${reference.path}`);
  const actual = sha256Bytes(fs.readFileSync(absolute));
  if (reference.sha256 && reference.sha256 !== actual) throw new Error(`Learning evidence hash does not match: ${reference.path}`);
  return { label: reference.label || "evidence", path: relative, sha256: actual };
}

function validateMeasurements(measurements = {}) {
  if (!measurements || typeof measurements !== "object" || Array.isArray(measurements)) throw new Error("Learning event measurements must be an object.");
  for (const [name, value] of Object.entries(measurements)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`Learning measurement '${name}' must be a non-negative number.`);
  }
  return measurements;
}

function eventsDirectory(root) { return path.join(path.resolve(root), ".claude", "learning", "events"); }

function loadEvents(root) {
  const directory = eventsDirectory(root);
  if (!fs.existsSync(directory)) return [];
  const events = [];
  for (const name of fs.readdirSync(directory).filter((item) => /^\d{4}-\d{2}\.jsonl$/.test(item)).sort()) {
    const file = path.join(directory, name);
    fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).forEach((line, index) => {
      let event;
      try { event = JSON.parse(line); } catch { throw new Error(`Invalid learning event at ${name}:${index + 1}.`); }
      if (event.event_id !== fingerprint({ ...event, event_id: undefined })) throw new Error(`Learning event integrity failure at ${name}:${index + 1}.`);
      for (const reference of event.evidence_refs || []) evidenceReference(root, reference);
      events.push(event);
    });
  }
  return events;
}

function appendEvent(root, input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Learning event must be an object.");
  for (const field of ["type", "stage"]) if (typeof input[field] !== "string" || !input[field]) throw new Error(`Learning event requires ${field}.`);
  if (!CLASSIFICATIONS.has(input.classification || "unclassified")) throw new Error(`Unknown learning classification '${input.classification}'.`);
  if (input.severity && !["info", "advisory", "blocking", "high"].includes(input.severity)) throw new Error("Learning event severity is invalid.");
  if (input.change_id) safeId(input.change_id, "Change id");
  if (input.story_id) safeId(input.story_id, "Story id");
  const occurredAt = options.now || input.occurred_at || new Date().toISOString();
  if (Number.isNaN(Date.parse(occurredAt))) throw new Error("Learning event occurred_at is invalid.");
  const evidenceRefs = (input.evidence_refs || []).map((reference) => evidenceReference(root, reference));
  const eventKey = input.event_key || fingerprint({
    type: input.type, stage: input.stage, classification: input.classification || "unclassified",
    change_id: input.change_id || null, story_id: input.story_id || null,
    evidence_refs: evidenceRefs.map((item) => ({ path: item.path, sha256: item.sha256 })),
  });
  const existing = loadEvents(root).find((event) => event.event_key === eventKey);
  if (existing) return { event: existing, duplicate: true, file: null };
  const eventWithoutId = {
    schema_version: 1, event_key: eventKey, occurred_at: occurredAt,
    harness_version: input.harness_version || null,
    change_id: input.change_id || null, story_id: input.story_id || null,
    stage: input.stage, type: input.type,
    classification: input.classification || "unclassified",
    severity: input.severity || "advisory",
    control_ids: Array.isArray(input.control_ids) ? [...new Set(input.control_ids)] : [],
    repair: input.repair || null,
    measurements: validateMeasurements(input.measurements || {}),
    evidence_refs: evidenceRefs,
    summary: typeof input.summary === "string" ? input.summary : "",
  };
  const event = { ...eventWithoutId, event_id: fingerprint({ ...eventWithoutId, event_id: undefined }) };
  const month = occurredAt.slice(0, 7);
  const file = path.join(eventsDirectory(root), `${month}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, "utf8");
  return { event, duplicate: false, file };
}

function buildPatterns(events, policy = {}) {
  const minimumStories = policy.minimum_independent_stories || 3;
  const minimumChanges = policy.minimum_independent_changes || 2;
  const groups = new Map();
  for (const event of events) {
    if (event.classification === "unclassified") continue;
    const group = groups.get(event.classification) || { classification: event.classification, event_ids: [], story_ids: new Set(), change_ids: new Set(), severities: new Set(), control_ids: new Set() };
    group.event_ids.push(event.event_id);
    if (event.story_id) group.story_ids.add(event.story_id);
    if (event.change_id) group.change_ids.add(event.change_id);
    group.severities.add(event.severity);
    for (const control of event.control_ids || []) group.control_ids.add(control);
    groups.set(event.classification, group);
  }
  return [...groups.values()].map((group) => {
    const exceptional = group.severities.has("high") && ["operations.escaped-defect", "design.boundary-violation"].includes(group.classification);
    const corroborated = exceptional || (group.story_ids.size >= minimumStories && group.change_ids.size >= minimumChanges);
    return {
      pattern_id: `pattern-${fingerprint(group.classification).slice(0, 12)}`,
      classification: group.classification, status: corroborated ? "CORROBORATED" : "OBSERVED",
      event_ids: group.event_ids, story_ids: [...group.story_ids].sort(), change_ids: [...group.change_ids].sort(),
      control_ids: [...group.control_ids].sort(), event_count: group.event_ids.length,
      corroboration: { exceptional, minimum_independent_stories: minimumStories, minimum_independent_changes: minimumChanges },
    };
  }).sort((a, b) => a.classification.localeCompare(b.classification));
}

function writePatterns(root, policy) {
  const report = { schema_version: 1, generated_at: new Date().toISOString(), patterns: buildPatterns(loadEvents(root), policy) };
  const file = path.join(path.resolve(root), ".claude", "state", "learning-patterns.json");
  writeJson(file, report);
  return { report, file };
}

function candidatePath(root, candidateId) {
  return path.join(path.resolve(root), ".claude", "specs", "improvements", `${safeId(candidateId, "Candidate id")}.json`);
}
function loadCandidate(root, candidateId) {
  const file = candidatePath(root, candidateId);
  if (!fs.existsSync(file)) throw new Error(`Unknown improvement candidate '${candidateId}'.`);
  return { candidate: readJson(file), file };
}

function createCandidate(root, input) {
  const id = safeId(input.candidate_id, "Candidate id");
  const file = candidatePath(root, id);
  if (fs.existsSync(file)) throw new Error(`Improvement candidate '${id}' already exists.`);
  if (!CLASSIFICATIONS.has(input.classification) || input.classification === "unclassified") throw new Error("Candidate requires a known, specific classification.");
  const events = loadEvents(root);
  const selected = events.filter((event) => (input.evidence_event_ids || []).includes(event.event_id));
  if (!input.evidence_event_ids?.length || selected.length !== input.evidence_event_ids.length) throw new Error("Candidate evidence_event_ids must reference recorded learning events.");
  if (selected.some((event) => event.classification !== input.classification)) throw new Error("Candidate events must match its classification.");
  const pattern = buildPatterns(selected).find((item) => item.classification === input.classification);
  if (!pattern || pattern.status !== "CORROBORATED") throw new Error("Candidate evidence is not corroborated by independent stories/changes or a protected high-severity event.");
  if (!input.diagnosis?.observed_problem || !input.diagnosis?.suspected_upstream_stage || typeof input.diagnosis.confidence !== "number" || input.diagnosis.confidence < 0 || input.diagnosis.confidence > 1 || !Array.isArray(input.diagnosis.alternative_explanations)) throw new Error("Candidate requires a bounded diagnosis with confidence and alternative explanations.");
  if (!input.proposed_change?.type || !["retire", "demote", "replace", "net-add"].includes(input.proposed_change.type) || !input.proposed_change.target || !input.proposed_change.summary) throw new Error("Candidate proposed_change is invalid.");
  if (!input.hypothesis?.metric || !["increase", "decrease"].includes(input.hypothesis.expected_direction) || typeof input.hypothesis.minimum_improvement !== "number" || input.hypothesis.minimum_improvement < 0) throw new Error("Candidate hypothesis is invalid.");
  const candidate = {
    schema_version: 1, candidate_id: id, state: "PROPOSED", created_at: new Date().toISOString(),
    classification: input.classification, evidence_event_ids: [...new Set(input.evidence_event_ids)],
    diagnosis: input.diagnosis, proposed_change: input.proposed_change, hypothesis: input.hypothesis,
    guardrails: [...new Set([...(input.guardrails || []), ...PROTECTED_GUARDRAILS])],
    decision_authority: "human", transitions: [],
  };
  writeJson(file, candidate);
  return { candidate, file };
}

function transitionCandidate(root, candidateId, to, reason, authority) {
  if (!CANDIDATE_STATES.has(to)) throw new Error(`Invalid candidate state '${to}'.`);
  const loaded = loadCandidate(root, candidateId);
  if (TERMINAL_CANDIDATE_STATES.has(loaded.candidate.state)) throw new Error(`Candidate '${candidateId}' is terminal.`);
  if (!ALLOWED_TRANSITIONS[loaded.candidate.state]?.has(to)) throw new Error(`Candidate transition ${loaded.candidate.state} -> ${to} is not allowed.`);
  if (typeof reason !== "string" || !reason.trim()) throw new Error("Candidate transition requires a reason.");
  if (["EXPERIMENT_APPROVED", "PROMOTED", "ROLLED_BACK"].includes(to) && (!authority || authority.type !== "human" || !authority.id)) throw new Error(`${to} requires explicit human authority.`);
  loaded.candidate.transitions.push({ from: loaded.candidate.state, to, at: new Date().toISOString(), reason, authority: authority || null });
  loaded.candidate.state = to;
  writeJson(loaded.file, loaded.candidate);
  return loaded;
}

function experimentPath(root, experimentId) {
  return path.join(path.resolve(root), ".claude", "specs", "improvements", "experiments", safeId(experimentId, "Experiment id"), "definition.json");
}

function approveExperiment(root, input) {
  const id = safeId(input.experiment_id, "Experiment id");
  const file = experimentPath(root, id);
  if (fs.existsSync(file)) throw new Error(`Experiment '${id}' already exists.`);
  const loaded = loadCandidate(root, input.candidate_id);
  if (loaded.candidate.state !== "PROPOSED") throw new Error("Only a proposed candidate may enter an experiment.");
  if (!input.approved_by) throw new Error("Experiment approval requires approved_by.");
  const hashPattern = /^[a-f0-9]{64}$/i;
  if (!hashPattern.test(input.baseline_harness_sha256 || "") || !hashPattern.test(input.treatment_harness_sha256 || "") || input.baseline_harness_sha256 === input.treatment_harness_sha256) throw new Error("Experiment requires distinct SHA-256 baseline and treatment harness hashes.");
  if (!Number.isInteger(input.minimum_sample_size) || input.minimum_sample_size < 1) throw new Error("Experiment minimum_sample_size must be a positive integer.");
  if (input.maximum_cost_usd !== undefined && (typeof input.maximum_cost_usd !== "number" || !Number.isFinite(input.maximum_cost_usd) || input.maximum_cost_usd < 0)) throw new Error("Experiment maximum_cost_usd must be a non-negative number.");
  if (input.expires_at && Number.isNaN(Date.parse(input.expires_at))) throw new Error("Experiment expires_at is invalid.");
  const definition = {
    schema_version: 1, experiment_id: id, candidate_id: input.candidate_id,
    state: "APPROVED", approved_at: new Date().toISOString(), approved_by: input.approved_by,
    baseline_harness_sha256: input.baseline_harness_sha256, treatment_harness_sha256: input.treatment_harness_sha256,
    eligible_cohort: input.eligible_cohort || {}, minimum_sample_size: input.minimum_sample_size,
    primary_metric: loaded.candidate.hypothesis, guardrails: loaded.candidate.guardrails,
    maximum_cost_usd: input.maximum_cost_usd ?? null, expires_at: input.expires_at || null,
    decision_authority: "human",
  };
  writeJson(file, definition);
  transitionCandidate(root, input.candidate_id, "EXPERIMENT_APPROVED", `Approved experiment ${id}.`, { type: "human", id: input.approved_by });
  return { experiment: definition, file };
}

function metricValue(result, name) {
  const value = result.metrics?.[name];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`Experiment result requires non-negative metric '${name}'.`);
  return value;
}

function evaluateExperiment(root, experimentId, baseline, treatment) {
  const file = experimentPath(root, experimentId);
  if (!fs.existsSync(file)) throw new Error(`Unknown experiment '${experimentId}'.`);
  const experiment = readJson(file);
  for (const result of [baseline, treatment]) if (!Number.isInteger(result.sample_size) || result.sample_size < 0 || !result.metrics) throw new Error("Experiment results require sample_size and metrics.");
  const metric = experiment.primary_metric.metric;
  const before = metricValue(baseline, metric); const after = metricValue(treatment, metric);
  const direction = experiment.primary_metric.expected_direction;
  const improvement = direction === "decrease" ? before - after : after - before;
  const required = experiment.primary_metric.minimum_improvement;
  const checks = [{ id: "minimum_sample", pass: baseline.sample_size >= experiment.minimum_sample_size && treatment.sample_size >= experiment.minimum_sample_size, actual: Math.min(baseline.sample_size, treatment.sample_size), required: experiment.minimum_sample_size }, { id: "primary_metric", pass: improvement >= required, actual: improvement, required }];
  for (const name of experiment.guardrails) {
    const baselineValue = metricValue(baseline, name); const treatmentValue = metricValue(treatment, name);
    const lowerIsBetter = !["first_pass_acceptance_rate"].includes(name);
    checks.push({ id: `guardrail.${name}`, pass: lowerIsBetter ? treatmentValue <= baselineValue : treatmentValue >= baselineValue, actual: treatmentValue, required: baselineValue });
  }
  if (experiment.maximum_cost_usd !== null) {
    if (typeof treatment.cost_usd !== "number" || !Number.isFinite(treatment.cost_usd) || treatment.cost_usd < 0) throw new Error("Treatment result requires non-negative cost_usd for the approved cost guardrail.");
    checks.push({ id: "maximum_cost", pass: treatment.cost_usd <= experiment.maximum_cost_usd, actual: treatment.cost_usd, required: experiment.maximum_cost_usd });
  }
  const enough = checks.find((item) => item.id === "minimum_sample").pass;
  const primary = checks.find((item) => item.id === "primary_metric").pass;
  const guards = checks.filter((item) => item.id.startsWith("guardrail.") || item.id === "maximum_cost").every((item) => item.pass);
  const status = !enough ? "INSUFFICIENT_EVIDENCE" : !guards ? "REJECT" : primary ? "ELIGIBLE_FOR_HUMAN_PROMOTION" : "TUNE_AND_RETEST";
  const decision = { schema_version: 1, generated_at: new Date().toISOString(), experiment_id: experimentId, candidate_id: experiment.candidate_id, status, decision_authority: "human", applies_automatically: false, checks, baseline, treatment };
  const decisionFile = path.join(path.dirname(file), "decision.json");
  writeJson(decisionFile, decision);
  const loaded = loadCandidate(root, experiment.candidate_id);
  if (status === "ELIGIBLE_FOR_HUMAN_PROMOTION" && loaded.candidate.state !== "ELIGIBLE") transitionCandidate(root, experiment.candidate_id, "ELIGIBLE", `Experiment ${experimentId} met its approved metrics and guardrails.`);
  else if (status === "REJECT" && loaded.candidate.state !== "REJECTED") transitionCandidate(root, experiment.candidate_id, "REJECTED", `Experiment ${experimentId} violated a protected guardrail.`);
  return { decision, file: decisionFile };
}

function learningStatus(root) {
  const patterns = buildPatterns(loadEvents(root));
  const directory = path.join(path.resolve(root), ".claude", "specs", "improvements");
  const candidates = fs.existsSync(directory) ? fs.readdirSync(directory).filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(directory, name))) : [];
  return { schema_version: 1, generated_at: new Date().toISOString(), event_count: loadEvents(root).length, patterns, candidates: candidates.map((item) => ({ candidate_id: item.candidate_id, state: item.state, classification: item.classification })), decision_authority: "human" };
}

module.exports = {
  CLASSIFICATIONS, PROTECTED_GUARDRAILS, appendEvent, approveExperiment, buildPatterns,
  createCandidate, evaluateExperiment, learningStatus, loadCandidate, loadEvents,
  transitionCandidate, writePatterns,
};
