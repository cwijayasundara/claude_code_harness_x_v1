const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { currentBranch } = require("./specifications");
const { assertStoryContractEvolution } = require("./design-evolution");
const { appendEvent, CLASSIFICATIONS } = require("./improvement-ratchet");

const STATES = ["READY", "RED_TEST", "IMPLEMENT", "STORY_REVIEW", "FAST_SENSORS", "STORY_VERIFIED", "HUMAN_DECISION_REQUIRED"];
const CONTRACT_ARRAYS = [
  "source_requirements", "approved_design_refs", "dependency_story_ids",
  "allowed_change_scope", "acceptance_criteria", "test_case_ids", "test_data_ids",
  "required_sensors", "performance_budgets", "routing_risks", "human_decisions",
  "reuse_targets",
];

function safeId(value, label) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value || "")) throw new Error(`${label} is invalid.`);
}

function statePath(root, storyId) {
  safeId(storyId, "Story id");
  return path.join(path.resolve(root), ".claude", "state", "stories", `${storyId}.json`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadIndex(root) {
  const file = path.join(path.resolve(root), ".claude", "specs", "index.json");
  if (!fs.existsSync(file)) throw new Error("Missing .claude/specs/index.json.");
  return readJson(file);
}

function artifact(root, record) {
  if (!record?.path) throw new Error("Specification record has no artifact path.");
  const file = path.join(path.resolve(root), record.path);
  if (record.sha256) {
    const actual = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (actual !== record.sha256) throw new Error(`Approved artifact '${record.id}' no longer matches its registered hash.`);
  }
  return readJson(file);
}

function validateContract(contract, storyId, context = {}) {
  const errors = [];
  if (contract.story_id !== storyId) errors.push(`story_id must be '${storyId}'.`);
  for (const field of CONTRACT_ARRAYS) if (!Array.isArray(contract[field])) errors.push(`${field} must be an array.`);
  for (const field of ["source_requirements", "approved_design_refs", "allowed_change_scope", "acceptance_criteria", "test_case_ids", "required_sensors"]) {
    if (Array.isArray(contract[field]) && contract[field].length === 0) errors.push(`${field} must not be empty.`);
  }
  const allowedRisks = new Set(["architecture", "domain", "security", "privacy", "public-contract", "migration", "performance"]);
  if (Array.isArray(contract.routing_risks)) for (const risk of contract.routing_risks) if (!allowedRisks.has(risk)) errors.push(`routing_risks contains unknown risk '${risk}'.`);
  errors.push(...assertStoryContractEvolution(contract, context));
  return errors;
}

function loadState(root, storyId) {
  const file = statePath(root, storyId);
  if (!fs.existsSync(file)) throw new Error(`Story '${storyId}' has not entered the ratchet.`);
  const state = readJson(file);
  if (!STATES.includes(state.state)) throw new Error(`Story '${storyId}' has invalid state '${state.state}'.`);
  return { state, file };
}

function appendTransition(state, to, evidence) {
  const at = new Date().toISOString();
  state.transitions.push({ from: state.state, to, at, evidence });
  state.state = to;
  state.updated_at = at;
}

function assertBoundBranch(root, state) {
  const branch = currentBranch(root);
  if (branch !== state.branch) throw new Error(`Story '${state.story_id}' is bound to branch '${state.branch}', not '${branch}'.`);
}

function assertFresh(evidence, state, label) {
  if (Date.parse(evidence.modified_at) + 1000 < Date.parse(state.updated_at)) throw new Error(`${label} evidence predates the current ratchet state.`);
}

function start(root, { changeId, storyId }) {
  safeId(changeId, "Change id");
  safeId(storyId, "Story id");
  const branch = currentBranch(root);
  const index = loadIndex(root);
  const change = index.changes?.[changeId];
  if (!change?.gates?.G4 || change.gates.G4.status !== "approved") throw new Error(`Change '${changeId}' requires approved G4.`);
  if (change.branch !== branch) throw new Error(`Change '${changeId}' is bound to branch '${change.branch}'.`);
  const storyRecord = index.artifacts.find((item) => item.id === storyId && item.package === "stories" && item.status === "approved");
  if (!storyRecord) throw new Error(`Story '${storyId}' must be an approved stories artifact.`);
  const planRecords = index.artifacts.filter((item) => item.change_id === changeId && item.package === "plans" && item.status === "approved");
  const planRecord = planRecords.find((item) => {
    try { return artifact(root, item).content?.story_id === storyId; } catch { return false; }
  });
  if (!planRecord) throw new Error(`Story '${storyId}' requires an approved G4 story contract in plans/.`);
  const contract = artifact(root, planRecord).content;
  const siblingStoryCount = index.artifacts.filter(
    (item) => item.change_id === changeId && item.package === "stories" && item.status !== "superseded"
  ).length;
  const contractErrors = validateContract(contract, storyId, { siblingStoryCount });
  if (contractErrors.length) throw new Error(contractErrors.join(" "));
  const requiredRefs = [
    ["approved_design_refs", new Set(["design", "architecture", "amendments"])],
    ["test_case_ids", new Set(["test-cases"])],
    ["test_data_ids", new Set(["test-data"])],
  ];
  for (const [field, packages] of requiredRefs) for (const id of contract[field]) {
    if (!index.artifacts.some((item) => item.id === id && item.status === "approved" && packages.has(item.package))) {
      throw new Error(`Contract reference '${id}' in ${field} is not an approved ${[...packages].join("/")} artifact.`);
    }
  }
  for (const dependency of contract.dependency_story_ids) {
    const dependencyFile = statePath(root, dependency);
    if (!fs.existsSync(dependencyFile) || readJson(dependencyFile).state !== "STORY_VERIFIED") throw new Error(`Dependency story '${dependency}' is not STORY_VERIFIED.`);
  }
  const file = statePath(root, storyId);
  if (fs.existsSync(file)) throw new Error(`Story '${storyId}' already has ratchet state.`);
  const now = new Date().toISOString();
  const state = {
    schema_version: 1, change_id: changeId, story_id: storyId, contract_id: planRecord.id,
    branch, state: "READY", started_at: now, updated_at: now, transitions: [],
    evidence: {}, repair_attempts: 0,
  };
  writeJson(file, state);
  return { state, file, contract };
}

function evidenceFile(root, file) {
  const projectRoot = path.resolve(root);
  const absolute = path.resolve(projectRoot, file);
  const relative = path.relative(projectRoot, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Evidence file must be inside the target project.");
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`Evidence file not found: ${file}`);
  const bytes = fs.readFileSync(absolute);
  return { data: JSON.parse(bytes.toString("utf8")), path: relative, modified_at: fs.statSync(absolute).mtime.toISOString(), sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}

function assertEvidenceUnchanged(root, evidence, label) {
  const file = path.join(path.resolve(root), evidence.path);
  if (!fs.existsSync(file)) throw new Error(`${label} evidence is missing: ${evidence.path}.`);
  const actual = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (actual !== evidence.sha256) throw new Error(`${label} evidence changed after it was recorded.`);
}

function approvedContract(root, state) {
  const index = loadIndex(root);
  const record = index.artifacts.find((item) => item.id === state.contract_id && item.status === "approved");
  if (!record) throw new Error(`Approved contract '${state.contract_id}' is unavailable.`);
  return artifact(root, record).content;
}

function withinScope(candidate, scopes) {
  const normalized = candidate.replace(/^\.\//, "");
  return scopes.some((scope) => {
    const clean = scope.replace(/^\.\//, "").replace(/\/$/, "");
    return clean === "." || normalized === clean || normalized.startsWith(`${clean}/`);
  });
}

function productChanges(root) {
  const result = spawnSync("git", ["-C", path.resolve(root), "status", "--porcelain=v1", "--untracked-files=all"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Unable to inspect Git changes.");
  return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).split(" -> ").at(-1))
    .filter((file) => file && file !== "CLAUDE.md" && !file.startsWith(".claude/"));
}

function requireState(actual, expected) {
  if (!expected.includes(actual)) throw new Error(`Transition requires state ${expected.join(" or ")}; current state is ${actual}.`);
}

function recordRed(root, storyId, file) {
  const loaded = loadState(root, storyId);
  assertBoundBranch(root, loaded.state);
  requireState(loaded.state.state, ["READY"]);
  const evidence = evidenceFile(root, file);
  assertFresh(evidence, loaded.state, "RED_TEST");
  const data = evidence.data;
  if (typeof data.command !== "string" || !data.command || !Number.isInteger(data.exit_code) || data.exit_code === 0) throw new Error("RED_TEST evidence requires a command and non-zero integer exit_code.");
  if (!data.expected_failure || !data.observed_failure || !Array.isArray(data.test_paths) || data.test_paths.length === 0) throw new Error("RED_TEST evidence requires expected_failure, observed_failure, and test_paths.");
  const contract = approvedContract(root, loaded.state);
  for (const testPath of data.test_paths) if (!withinScope(testPath, contract.allowed_change_scope)) throw new Error(`Red test path '${testPath}' is outside allowed_change_scope.`);
  loaded.state.evidence.red_test = evidence;
  appendTransition(loaded.state, "RED_TEST", evidence.path);
  writeJson(loaded.file, loaded.state);
  return loaded.state;
}

function recordImplementation(root, storyId, file) {
  const loaded = loadState(root, storyId);
  assertBoundBranch(root, loaded.state);
  requireState(loaded.state.state, ["RED_TEST", "IMPLEMENT"]);
  const evidence = evidenceFile(root, file);
  assertFresh(evidence, loaded.state, "IMPLEMENT");
  const data = evidence.data;
  if (typeof data.command !== "string" || !data.command || data.exit_code !== 0) throw new Error("IMPLEMENT evidence requires a passing command with exit_code 0.");
  if (!Array.isArray(data.changed_paths) || data.changed_paths.length === 0 || !Array.isArray(data.test_paths) || data.test_paths.length === 0) throw new Error("IMPLEMENT evidence requires changed_paths and test_paths.");
  const contract = approvedContract(root, loaded.state);
  const declared = new Set([...data.changed_paths, ...data.test_paths]);
  for (const changed of declared) if (!withinScope(changed, contract.allowed_change_scope)) throw new Error(`Changed path '${changed}' is outside allowed_change_scope.`);
  for (const actual of productChanges(root)) if (!withinScope(actual, contract.allowed_change_scope)) throw new Error(`Git change '${actual}' is outside allowed_change_scope.`);
  loaded.state.evidence.implementation = evidence;
  appendTransition(loaded.state, "IMPLEMENT", evidence.path);
  writeJson(loaded.file, loaded.state);
  return loaded.state;
}

function recordReview(root, storyId, file) {
  const loaded = loadState(root, storyId);
  assertBoundBranch(root, loaded.state);
  requireState(loaded.state.state, ["IMPLEMENT"]);
  const evidence = evidenceFile(root, file);
  assertFresh(evidence, loaded.state, "Validator");
  const verdict = evidence.data;
  if (!["pass", "revise", "human-decision-required"].includes(verdict.verdict)) throw new Error("Validator verdict must be pass, revise, or human-decision-required.");
  for (const field of ["blocking_findings", "non_blocking_findings", "missing_or_stale_evidence", "required_human_decisions", "reviewed_paths", "evidence_refs"]) {
    if (!Array.isArray(verdict[field])) throw new Error(`Validator verdict requires ${field} array.`);
  }
  for (const finding of verdict.blocking_findings) {
    for (const field of ["affected_path", "requirement_or_rule", "evidence", "required_action"]) if (!finding?.[field]) throw new Error(`Blocking validator finding requires ${field}.`);
  }
  if (verdict.verdict === "pass" && (verdict.blocking_findings.length || verdict.required_human_decisions.length)) throw new Error("A pass verdict cannot contain blocking findings or required human decisions.");
  loaded.state.evidence.validator = evidence;
  if (verdict.verdict === "pass") appendTransition(loaded.state, "STORY_REVIEW", evidence.path);
  else if (verdict.verdict === "revise") {
    loaded.state.repair_required = true;
    loaded.state.updated_at = new Date().toISOString();
  } else appendTransition(loaded.state, "HUMAN_DECISION_REQUIRED", evidence.path);
  writeJson(loaded.file, loaded.state);
  if (verdict.verdict !== "pass") {
    const findings = verdict.blocking_findings.length ? verdict.blocking_findings : [{ evidence: verdict.required_human_decisions.join("; ") }];
    for (const finding of findings) {
      const classification = CLASSIFICATIONS.has(finding.classification) ? finding.classification : "unclassified";
      appendEvent(root, {
        event_key: crypto.createHash("sha256").update(`${evidence.sha256}:${classification}:${finding.affected_path || "decision"}`).digest("hex"),
        change_id: loaded.state.change_id, story_id: loaded.state.story_id,
        stage: "STORY_REVIEW", type: verdict.verdict === "revise" ? "validator-finding" : "human-decision-required",
        classification, severity: verdict.verdict === "revise" ? "blocking" : "high",
        repair: { required: verdict.verdict === "revise", succeeded: false },
        summary: finding.evidence || finding.required_action || "Review did not pass.",
        evidence_refs: [{ label: "validator-review", path: evidence.path, sha256: evidence.sha256 }],
      });
    }
  }
  return loaded.state;
}

function startRepair(root, storyId, failure, maxAttempts = 1) {
  const loaded = loadState(root, storyId);
  assertBoundBranch(root, loaded.state);
  requireState(loaded.state.state, ["IMPLEMENT"]);
  if (!loaded.state.repair_required) throw new Error("No revise verdict requires repair.");
  if (!failure?.trim()) throw new Error("Repair failure summary is required.");
  if (loaded.state.repair_attempts >= maxAttempts) throw new Error(`Repair limit reached for ${storyId} (${maxAttempts}).`);
  loaded.state.repair_attempts += 1;
  loaded.state.active_repair = { attempt: loaded.state.repair_attempts, failure, started_at: new Date().toISOString() };
  loaded.state.repair_required = false;
  writeJson(loaded.file, loaded.state);
  return loaded.state;
}

function finishRepair(root, storyId, { outcome, evidence }) {
  const loaded = loadState(root, storyId);
  assertBoundBranch(root, loaded.state);
  if (!loaded.state.active_repair) throw new Error("No active repair attempt.");
  if (!["passed", "failed", "escalated"].includes(outcome)) throw new Error("Repair outcome must be passed, failed, or escalated.");
  loaded.state.active_repair = { ...loaded.state.active_repair, outcome, evidence, completed_at: new Date().toISOString() };
  if (outcome !== "passed") appendTransition(loaded.state, "HUMAN_DECISION_REQUIRED", evidence);
  writeJson(loaded.file, loaded.state);
  appendEvent(root, {
    event_key: crypto.createHash("sha256").update(`${loaded.state.change_id}:${storyId}:repair:${loaded.state.active_repair.attempt}:${outcome}`).digest("hex"),
    change_id: loaded.state.change_id, story_id: storyId, stage: "IMPLEMENT", type: "repair-outcome",
    classification: "unclassified", severity: outcome === "passed" ? "advisory" : "high",
    repair: { required: true, succeeded: outcome === "passed", outcome }, summary: loaded.state.active_repair.failure,
  });
  return loaded.state;
}

function recordSensors(root, storyId, file) {
  const loaded = loadState(root, storyId);
  assertBoundBranch(root, loaded.state);
  requireState(loaded.state.state, ["STORY_REVIEW"]);
  const evidence = evidenceFile(root, file);
  assertFresh(evidence, loaded.state, "Sensor");
  const report = evidence.data;
  if (report.status !== "pass" || !Array.isArray(report.sensors)) throw new Error("FAST_SENSORS requires a normalized passing sensor report.");
  const contract = approvedContract(root, loaded.state);
  const passed = new Set(report.sensors.filter((sensor) => sensor.status === "pass").map((sensor) => sensor.sensor_id));
  const missing = contract.required_sensors.filter((sensor) => !passed.has(sensor));
  if (missing.length) throw new Error(`Required sensors did not pass: ${missing.join(", ")}.`);
  if (Date.parse(report.generated_at) < Date.parse(loaded.state.transitions.at(-1).at)) throw new Error("Sensor report predates the validator verdict.");
  loaded.state.evidence.fast_sensors = evidence;
  appendTransition(loaded.state, "FAST_SENSORS", evidence.path);
  writeJson(loaded.file, loaded.state);
  return loaded.state;
}

function verify(root, storyId) {
  const loaded = loadState(root, storyId);
  assertBoundBranch(root, loaded.state);
  requireState(loaded.state.state, ["FAST_SENSORS"]);
  for (const [label, evidence] of Object.entries(loaded.state.evidence)) assertEvidenceUnchanged(root, evidence, label);
  const contract = approvedContract(root, loaded.state);
  for (const actual of productChanges(root)) if (!withinScope(actual, contract.allowed_change_scope)) throw new Error(`Git change '${actual}' is outside allowed_change_scope.`);
  appendTransition(loaded.state, "STORY_VERIFIED", loaded.state.evidence.fast_sensors.path);
  writeJson(loaded.file, loaded.state);
  appendEvent(root, {
    event_key: crypto.createHash("sha256").update(`${loaded.state.change_id}:${storyId}:verified:${loaded.state.evidence.fast_sensors.sha256}`).digest("hex"),
    change_id: loaded.state.change_id, story_id: storyId, stage: "STORY_VERIFIED", type: "story-verified",
    classification: "unclassified", severity: "info", measurements: { repair_count: loaded.state.repair_attempts },
    evidence_refs: [{ label: "fast-sensors", path: loaded.state.evidence.fast_sensors.path, sha256: loaded.state.evidence.fast_sensors.sha256 }],
  });
  return loaded.state;
}

module.exports = { STATES, finishRepair, loadState, recordImplementation, recordRed, recordReview, recordSensors, start, startRepair, validateContract, verify };
