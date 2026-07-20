const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { assertGateDesignEvolution } = require("./design-evolution");
const { g0Requirements, validateG0Route, validateSpddArtifact } = require("./spdd-contract");
const { validateG1, validateG4DependencyConsistency } = require("./backlog-planning");
const { validateG4Traceability, validateTraceabilityArtifact } = require("./requirements-traceability");
const { validateBrowserE2E } = require("./browser-e2e-contract");
const { buildProjection, recordReceipt, validateProjection } = require("./tracker-projection");
const {
  renderGateSession,
  appendixHeading,
  approveHeading,
  approveIntro,
} = require("./proposal-sessions");

const PACKAGES = [
  "source", "brd", "prd", "analysis", "reasons-canvas", "prompt-amendments",
  "epics", "stories", "dependencies", "allocations", "traceability", "tracker-projections", "test-data",
  "test-cases", "test-plans", "design", "architecture", "plans", "evidence",
  "reviews", "brownfield", "amendments",
];
const GATES = ["G0", "G1", "G2", "G3", "G4", "B0", "B1", "B2"];
const GATE_PACKAGES = {
  G0: ["source"],
  G1: ["epics", "stories", "dependencies", "allocations"],
  G2: ["test-data", "test-cases", "test-plans"],
  G3: ["design", "architecture"],
  G4: ["plans", "traceability"],
  B0: ["brownfield"],
  B1: ["brownfield"],
  B2: ["brownfield", "amendments"],
};
const GATE_PREDECESSOR = { G1: "G0", G2: "G1", G3: "G2", G4: "G3", B1: "B0", B2: "B1" };
const BROWNFIELD_TYPES = { B0: "baseline", B1: "code-map", B2: "change-strategy" };
const PROTECTED_BRANCHES = new Set(["main", "master", "develop"]);
const GREENFIELD_GATE_ORDER = Object.freeze(["G0", "G1", "G2", "G3", "G4"]);

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function assertId(value, label = "identifier") {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value || "")) {
    throw new Error(`${label} must contain only letters, numbers, dot, underscore, or hyphen.`);
  }
}

function specsRoot(root) {
  return path.join(path.resolve(root), ".claude", "specs");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function emptyIndex() {
  return { schema_version: 1, artifacts: [], relationships: [], changes: {} };
}

function initialize(root) {
  const base = specsRoot(root);
  for (const packageName of PACKAGES) fs.mkdirSync(path.join(base, packageName), { recursive: true });
  const indexPath = path.join(base, "index.json");
  if (!fs.existsSync(indexPath)) writeJson(indexPath, emptyIndex());
  return indexPath;
}

function currentBranch(root) {
  const result = spawnSync("git", ["-C", path.resolve(root), "branch", "--show-current"], { encoding: "utf8" });
  const branch = result.status === 0 ? result.stdout.trim() : "";
  if (!branch) throw new Error("Target must be a Git repository on a named feature branch.");
  if (PROTECTED_BRANCHES.has(branch)) throw new Error(`Refusing specification writes on protected branch '${branch}'. Switch to a feature branch.`);
  return branch;
}

function loadIndex(root) {
  const indexPath = initialize(root);
  const index = readJson(indexPath);
  if (index.schema_version !== 1 || !Array.isArray(index.artifacts) || !Array.isArray(index.relationships)) {
    throw new Error(".claude/specs/index.json does not match schema version 1.");
  }
  return { index, indexPath };
}

function intake(root, { changeId, source, kind }) {
  assertId(changeId, "change id");
  if (!["brd", "prd"].includes(kind)) throw new Error("kind must be brd or prd.");
  const branch = currentBranch(root);
  const projectRoot = path.resolve(root);
  const sourcePath = path.resolve(projectRoot, source);
  const relative = path.relative(projectRoot, sourcePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Source must be a file inside the target project.");
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) throw new Error(`Source file not found: ${source}`);
  const content = fs.readFileSync(sourcePath);
  const digest = sha256(content);
  const sourceId = `${changeId}-source`;
  const destination = path.join(specsRoot(root), "source", changeId, path.basename(sourcePath));
  if (fs.existsSync(destination) && sha256(fs.readFileSync(destination)) !== digest) {
    throw new Error(`Immutable source already exists with different content: ${path.relative(projectRoot, destination)}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (!fs.existsSync(destination)) fs.copyFileSync(sourcePath, destination);

  const record = {
    id: sourceId, package: "source", kind, change_id: changeId,
    source_ids: [sourceId], source_locations: [relative], derived_from: [],
    status: "captured", assumptions: [], open_questions: [], human_approver: null,
    approved_at: null, path: path.relative(projectRoot, destination), sha256: digest,
  };
  const { index, indexPath } = loadIndex(root);
  const existing = index.artifacts.find((item) => item.id === sourceId);
  if (existing && (existing.sha256 !== digest || existing.path !== record.path)) throw new Error(`Source id '${sourceId}' already identifies different content.`);
  if (!existing) index.artifacts.push(record);
  index.changes[changeId] ||= { branch, source_ids: [], gates: {} };
  if (index.changes[changeId].branch !== branch) throw new Error(`Change '${changeId}' is bound to branch '${index.changes[changeId].branch}'.`);
  if (!index.changes[changeId].source_ids.includes(sourceId)) index.changes[changeId].source_ids.push(sourceId);
  writeJson(indexPath, index);
  return record;
}

function register(root, inputFile) {
  currentBranch(root);
  const projectRoot = path.resolve(root);
  const candidate = path.resolve(projectRoot, inputFile);
  const relative = path.relative(projectRoot, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Artifact input must be inside the target project.");
  const artifact = readJson(candidate);
  const requiredArrays = ["source_ids", "source_locations", "derived_from", "assumptions", "open_questions"];
  assertId(artifact.id, "artifact id");
  assertId(artifact.change_id, "change id");
  if (!PACKAGES.includes(artifact.package) || artifact.package === "source") throw new Error(`package must be one of: ${PACKAGES.filter((p) => p !== "source").join(", ")}.`);
  for (const field of requiredArrays) if (!Array.isArray(artifact[field])) throw new Error(`${field} must be an array.`);
  if (artifact.source_ids.length === 0) throw new Error("source_ids must ground the artifact in at least one captured source.");
  if (!artifact.status || !["draft", "superseded"].includes(artifact.status)) throw new Error("registered artifact status must be draft or superseded; only a human gate can approve it.");
  const spddErrors = validateSpddArtifact(artifact);
  if (spddErrors.length) throw new Error(`SPDD artifact validation failed:\n- ${spddErrors.join("\n- ")}`);
  if (artifact.package === "traceability") {
    const traceErrors = validateTraceabilityArtifact(artifact.content);
    if (traceErrors.length) throw new Error(`Traceability artifact validation failed:\n- ${traceErrors.join("\n- ")}`);
  }
  if (artifact.package === "tracker-projections") {
    const projectionErrors = validateProjection(artifact.content);
    if (projectionErrors.length) throw new Error(`Tracker projection validation failed:\n- ${projectionErrors.join("\n- ")}`);
  }
  const { index, indexPath } = loadIndex(root);
  const change = index.changes[artifact.change_id];
  if (!change) throw new Error(`Unknown change '${artifact.change_id}'; intake its BRD/PRD first.`);
  for (const sourceId of artifact.source_ids) {
    if (!index.artifacts.some((item) => item.id === sourceId && item.package === "source")) throw new Error(`Unknown source id '${sourceId}'.`);
  }
  for (const parentId of artifact.derived_from) {
    if (!index.artifacts.some((item) => item.id === parentId)) throw new Error(`Unknown derived_from id '${parentId}'.`);
  }
  const at = index.artifacts.findIndex((item) => item.id === artifact.id);
  if (at >= 0 && index.artifacts[at].status === "approved") throw new Error(`Approved artifact '${artifact.id}' is immutable; create an amendment or superseding artifact.`);
  const destination = path.join(specsRoot(root), artifact.package, `${artifact.id}.json`);
  const normalized = { ...artifact, human_approver: artifact.human_approver || null, approved_at: artifact.approved_at || null };
  writeJson(destination, normalized);
  const digest = sha256(fs.readFileSync(destination));
  const { content, ...metadata } = normalized;
  const record = { ...metadata, artifact_type: content?.artifact_type || null, path: path.relative(projectRoot, destination), sha256: digest };
  if (at >= 0) index.artifacts[at] = record; else index.artifacts.push(record);
  index.relationships = index.relationships.filter((edge) => edge.to !== artifact.id);
  for (const from of [...artifact.source_ids, ...artifact.derived_from]) index.relationships.push({ from, to: artifact.id, type: artifact.source_ids.includes(from) ? "grounds" : "derives" });
  writeJson(indexPath, index);
  return record;
}

function approve(root, { changeId, gate, approver }) {
  assertId(changeId, "change id");
  if (!GATES.includes(gate)) throw new Error(`gate must be one of ${GATES.join(", ")}.`);
  if (!approver || !approver.trim()) throw new Error("approver is required.");
  const branch = currentBranch(root);
  const { index, indexPath } = loadIndex(root);
  const change = index.changes[changeId];
  if (!change) throw new Error(`Unknown change '${changeId}'.`);
  if (change.branch !== branch) throw new Error(`Change '${changeId}' is bound to branch '${change.branch}', not '${branch}'.`);
  const predecessor = GATE_PREDECESSOR[gate];
  if (predecessor && !change.gates[predecessor]) throw new Error(`${gate} requires approved ${predecessor}.`);
  const changeArtifacts = index.artifacts.filter((item) => item.change_id === changeId);
  const sourceKind = changeArtifacts.find((item) => item.package === "source")?.kind;
  const requiredPackages = gate === "G0" ? g0Requirements(sourceKind) : GATE_PACKAGES[gate];
  const requiredBrownfieldType = BROWNFIELD_TYPES[gate];
  const qualifies = (item, packageName) => item.package === packageName
    && item.status !== "superseded"
    && (packageName !== "brownfield" || !requiredBrownfieldType || (item.artifact_type || item.content?.artifact_type) === requiredBrownfieldType);
  const missingPackages = requiredPackages.filter((packageName) => !changeArtifacts.some((item) => qualifies(item, packageName)));
  if (missingPackages.length) throw new Error(`${gate} requires registered artifacts in: ${missingPackages.join(", ")}.`);
  if (gate === "G0") {
    const routeErrors = validateG0Route(changeArtifacts, (record) => readJson(path.join(path.resolve(root), record.path)));
    if (routeErrors.length) throw new Error(`G0 SPDD checks failed:\n- ${routeErrors.join("\n- ")}`);
  }
  if (gate === "G1") {
    const g1 = validateG1(changeArtifacts, (record) => readJson(path.join(path.resolve(root), record.path)));
    if (g1.errors.length) throw new Error(`G1 backlog checks failed:\n- ${g1.errors.join("\n- ")}`);
  }
  if (gate === "G4") {
    const dependencyErrors = validateG4DependencyConsistency(changeArtifacts, (record) => readJson(path.join(path.resolve(root), record.path)));
    if (dependencyErrors.length) throw new Error(`G4 dependency checks failed:\n- ${dependencyErrors.join("\n- ")}`);
    const traceability = validateG4Traceability(changeArtifacts, (record) => readJson(path.join(path.resolve(root), record.path)));
    if (traceability.errors.length) throw new Error(`G4 traceability checks failed:\n- ${traceability.errors.join("\n- ")}`);
    const browser = validateBrowserE2E(root, changeArtifacts, (record) => readJson(path.join(path.resolve(root), record.path)));
    if (browser.errors.length) throw new Error(`G4 browser E2E checks failed:\n- ${browser.errors.join("\n- ")}`);
  }
  const designEvolutionErrors = assertGateDesignEvolution(root, changeId, gate);
  if (designEvolutionErrors.length) {
    throw new Error(`${gate} design-evolution checks failed:\n- ${designEvolutionErrors.join("\n- ")}`);
  }
  const approvedAt = new Date().toISOString();
  for (const artifact of changeArtifacts.filter((item) => requiredPackages.some((packageName) => qualifies(item, packageName)) && item.package !== "source")) {
    artifact.status = "approved";
    artifact.human_approver = approver.trim();
    artifact.approved_at = approvedAt;
    const artifactPath = path.join(path.resolve(root), artifact.path);
    const stored = readJson(artifactPath);
    const approved = { ...stored, status: "approved", human_approver: artifact.human_approver, approved_at: approvedAt };
    writeJson(artifactPath, approved);
    artifact.sha256 = sha256(fs.readFileSync(artifactPath));
  }
  change.gates[gate] = { status: "approved", approver: approver.trim(), approved_at: approvedAt };
  if (gate === "G4") change.reapproval_required = false;
  writeJson(indexPath, index);
  return change.gates[gate];
}

function applyPromptAmendment(root, { changeId, amendmentId, approver }) {
  assertId(changeId, "change id");
  assertId(amendmentId, "amendment id");
  if (!approver || !approver.trim()) throw new Error("approver is required.");
  const branch = currentBranch(root);
  const { index, indexPath } = loadIndex(root);
  const change = index.changes[changeId];
  if (!change) throw new Error(`Unknown change '${changeId}'.`);
  if (change.branch !== branch) throw new Error(`Change '${changeId}' is bound to branch '${change.branch}', not '${branch}'.`);
  if (!change.gates?.G0) throw new Error("Prompt amendment requires an already approved G0.");
  const record = index.artifacts.find((item) => item.id === amendmentId && item.change_id === changeId && item.package === "prompt-amendments");
  if (!record || record.status !== "draft") throw new Error(`Prompt amendment '${amendmentId}' must be a registered draft.`);
  const file = path.join(path.resolve(root), record.path);
  const artifact = readJson(file);
  const errors = validateSpddArtifact(artifact);
  if (errors.length) throw new Error(`SPDD artifact validation failed:\n- ${errors.join("\n- ")}`);
  const content = artifact.content;
  const superseded = content.supersedes_artifact_ids.map((id) => index.artifacts.find((item) => item.id === id && item.change_id === changeId));
  if (superseded.some((item) => !item)) throw new Error("Prompt amendment references an unknown superseded artifact.");
  const replacements = content.replacement_artifact_ids.map((id) => index.artifacts.find((item) => item.id === id && item.change_id === changeId));
  if (replacements.some((item) => !item)) throw new Error("Prompt amendment references an unknown replacement artifact.");
  if (replacements.some((item) => item.status !== "draft")) throw new Error("Prompt amendment replacements must be registered drafts awaiting gate reapproval.");
  if (!replacements.some((item) => item.package === "reasons-canvas")) throw new Error("Prompt amendment must name a replacement reasons-canvas artifact.");

  const approvedAt = new Date().toISOString();
  for (const item of superseded) {
    item.status = "superseded";
    const storedPath = path.join(path.resolve(root), item.path);
    const stored = readJson(storedPath);
    writeJson(storedPath, { ...stored, status: "superseded", superseded_by: amendmentId });
    item.sha256 = sha256(fs.readFileSync(storedPath));
  }
  artifact.status = "approved";
  artifact.human_approver = approver.trim();
  artifact.approved_at = approvedAt;
  writeJson(file, artifact);
  record.status = "approved";
  record.human_approver = approver.trim();
  record.approved_at = approvedAt;
  record.sha256 = sha256(fs.readFileSync(file));

  const earliest = Math.min(...content.affected_gates.map((gate) => GREENFIELD_GATE_ORDER.indexOf(gate)));
  const reopened = GREENFIELD_GATE_ORDER.slice(earliest);
  change.gate_history ||= [];
  for (const gate of reopened) {
    if (change.gates[gate]) change.gate_history.push({ gate, ...change.gates[gate], reopened_by: amendmentId, reopened_at: approvedAt });
    delete change.gates[gate];
  }
  change.reapproval_required = true;
  change.active_prompt_amendment_id = amendmentId;
  writeJson(indexPath, index);
  return { change_id: changeId, amendment_id: amendmentId, status: "approved", reopened_gates: reopened, reapproval_required: true };
}

function createTrackerProjection(root, { changeId, provider, projectKey }) {
  currentBranch(root);
  const artifact = buildProjection(root, { changeId, provider, projectKey });
  const input = path.join(path.resolve(root), ".claude", "work", `${artifact.id}.json`);
  writeJson(input, artifact);
  return { artifact: register(root, path.relative(path.resolve(root), input)), input: path.relative(path.resolve(root), input) };
}

function approveTrackerProjection(root, { projectionId, approver }) {
  assertId(projectionId, "projection id");
  if (!approver || !approver.trim()) throw new Error("approver is required.");
  currentBranch(root);
  const { index, indexPath } = loadIndex(root);
  const record = index.artifacts.find((item) => item.id === projectionId && item.package === "tracker-projections");
  if (!record || record.status !== "draft") throw new Error(`Tracker projection '${projectionId}' must be a registered draft.`);
  const file = path.join(path.resolve(root), record.path);
  const artifact = readJson(file);
  const errors = validateProjection(artifact.content);
  if (errors.length) throw new Error(`Tracker projection validation failed:\n- ${errors.join("\n- ")}`);
  const approvedAt = new Date().toISOString();
  artifact.status = "approved";
  artifact.human_approver = approver.trim();
  artifact.approved_at = approvedAt;
  writeJson(file, artifact);
  record.status = "approved";
  record.human_approver = approver.trim();
  record.approved_at = approvedAt;
  record.sha256 = sha256(fs.readFileSync(file));
  writeJson(indexPath, index);
  return { projection_id: projectionId, status: "approved", approver: approver.trim(), approved_at: approvedAt, live_push_authorized: false };
}

function recordTrackerReceipt(root, { receiptFile, receiptId }) {
  currentBranch(root);
  const projectRoot = path.resolve(root);
  const candidate = path.resolve(projectRoot, receiptFile);
  const relative = path.relative(projectRoot, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Receipt input must be inside the target project.");
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) throw new Error(`Receipt file not found: ${receiptFile}`);
  return recordReceipt(projectRoot, { receiptId, receipt: readJson(candidate) });
}

function validate(root, changeId) {
  const errors = [];
  let loaded;
  try { loaded = loadIndex(root); } catch (error) { return [error.message]; }
  const { index } = loaded;
  const ids = new Set();
  for (const artifact of index.artifacts) {
    if (ids.has(artifact.id)) errors.push(`Duplicate artifact id '${artifact.id}'.`);
    ids.add(artifact.id);
    if (!PACKAGES.includes(artifact.package)) errors.push(`Artifact '${artifact.id}' has unknown package '${artifact.package}'.`);
    const file = path.join(path.resolve(root), artifact.path || "");
    if (!artifact.path || !fs.existsSync(file)) errors.push(`Artifact '${artifact.id}' points to a missing file.`);
    else if (sha256(fs.readFileSync(file)) !== artifact.sha256) errors.push(`Artifact '${artifact.id}' content no longer matches its registered hash.`);
  }
  for (const edge of index.relationships) if (!ids.has(edge.from) || !ids.has(edge.to)) errors.push(`Dangling relationship '${edge.from}' -> '${edge.to}'.`);
  if (changeId && !index.changes[changeId]) errors.push(`Unknown change '${changeId}'.`);
  return errors;
}

function requiredPackagesForGate(gate, sourceKind) {
  if (gate === "G0") return g0Requirements(sourceKind);
  return GATE_PACKAGES[gate] || [];
}

function loadArtifactBody(root, record) {
  if (!record?.path) return null;
  const file = path.join(path.resolve(root), record.path);
  if (!fs.existsSync(file)) return null;
  if (record.package === "source") {
    return {
      kind: "source-file",
      text: fs.readFileSync(file, "utf8").slice(0, 4000),
      truncated: fs.statSync(file).size > 4000,
    };
  }
  try {
    return readJson(file);
  } catch {
    return { kind: "unreadable", path: record.path };
  }
}

function bulletList(items, empty = "_None._") {
  if (!items || items.length === 0) return empty;
  return items.map((item) => `- ${typeof item === "string" ? item : JSON.stringify(item)}`).join("\n");
}

function summarizeContent(content) {
  if (content == null) return "_No content body._";
  if (typeof content === "string") return content.slice(0, 2000);
  if (content.kind === "source-file") {
    return content.truncated
      ? `${content.text}\n\n_…truncated…_`
      : content.text;
  }
  const pretty = JSON.stringify(content, null, 2);
  return pretty.length > 3000 ? `${pretty.slice(0, 3000)}\n…truncated…` : pretty;
}

/**
 * Build a human-readable co-design proposal pack for one gate.
 * Present this to the human before recording approval.
 */
function proposalPack(root, { changeId, gate, write = false }) {
  assertId(changeId, "change id");
  if (!GATES.includes(gate)) throw new Error(`gate must be one of ${GATES.join(", ")}.`);
  const branch = currentBranch(root);
  const { index } = loadIndex(root);
  const change = index.changes[changeId];
  if (!change) throw new Error(`Unknown change '${changeId}'.`);
  if (change.branch !== branch) {
    throw new Error(`Change '${changeId}' is bound to branch '${change.branch}', not '${branch}'.`);
  }

  const changeArtifacts = index.artifacts.filter((item) => item.change_id === changeId);
  const sourceKind = changeArtifacts.find((item) => item.package === "source")?.kind;
  const requiredPackages = requiredPackagesForGate(gate, sourceKind);
  const requiredBrownfieldType = BROWNFIELD_TYPES[gate];
  const qualifies = (item, packageName) => item.package === packageName
    && item.status !== "superseded"
    && (packageName !== "brownfield" || !requiredBrownfieldType
      || (item.artifact_type || item.content?.artifact_type) === requiredBrownfieldType);

  const predecessor = GATE_PREDECESSOR[gate];
  const predecessorOk = !predecessor || Boolean(change.gates[predecessor]);
  const missingPackages = requiredPackages.filter(
    (packageName) => !changeArtifacts.some((item) => qualifies(item, packageName))
  );

  const relevant = changeArtifacts.filter((item) =>
    requiredPackages.some((packageName) => qualifies(item, packageName))
  );

  const assumptions = [];
  const openQuestions = [];
  const ungrounded = [];
  const bodies = [];

  for (const record of relevant) {
    const body = loadArtifactBody(root, record);
    bodies.push({ record, body });
    const fromBody = body && typeof body === "object" && !body.kind ? body : null;
    const ass = Array.isArray(record.assumptions) ? record.assumptions
      : Array.isArray(fromBody?.assumptions) ? fromBody.assumptions : [];
    const oq = Array.isArray(record.open_questions) ? record.open_questions
      : Array.isArray(fromBody?.open_questions) ? fromBody.open_questions : [];
    for (const item of ass) assumptions.push({ artifact_id: record.id, text: item });
    for (const item of oq) openQuestions.push({ artifact_id: record.id, text: item });
    if (record.package !== "source" && (!record.source_ids || record.source_ids.length === 0)) {
      ungrounded.push(record.id);
    }
  }

  const sources = changeArtifacts.filter((item) => item.package === "source");
  const gateAlready = change.gates[gate] || null;
  const designEvolutionErrors = assertGateDesignEvolution(root, changeId, gate);
  const spddErrors = gate === "G0"
    ? validateG0Route(changeArtifacts, (record) => loadArtifactBody(root, record))
    : [];
  const g1Analysis = gate === "G1" ? validateG1(changeArtifacts, (record) => loadArtifactBody(root, record)) : null;
  const g4DependencyErrors = gate === "G4" ? validateG4DependencyConsistency(changeArtifacts, (record) => loadArtifactBody(root, record)) : [];
  const g4Traceability = gate === "G4" ? validateG4Traceability(changeArtifacts, (record) => loadArtifactBody(root, record)) : null;
  const g4Browser = gate === "G4" ? validateBrowserE2E(root, changeArtifacts, (record) => loadArtifactBody(root, record)) : null;
  const packagesComplete = predecessorOk && missingPackages.length === 0 && ungrounded.length === 0
    && designEvolutionErrors.length === 0 && spddErrors.length === 0 && (!g1Analysis || g1Analysis.errors.length === 0)
    && g4DependencyErrors.length === 0 && (!g4Traceability || g4Traceability.errors.length === 0)
    && (!g4Browser || g4Browser.errors.length === 0);
  const ready = packagesComplete && !gateAlready;

  const blocking = [];
  if (gateAlready) blocking.push(`${gate} is already approved by ${gateAlready.approver} at ${gateAlready.approved_at}.`);
  if (!predecessorOk) blocking.push(`${gate} requires approved ${predecessor}.`);
  if (missingPackages.length) blocking.push(`Missing packages: ${missingPackages.join(", ")}.`);
  if (ungrounded.length) blocking.push(`Ungrounded artifacts: ${ungrounded.join(", ")}.`);
  for (const error of designEvolutionErrors) blocking.push(error);
  for (const error of spddErrors) blocking.push(error);
  for (const error of g1Analysis?.errors || []) blocking.push(error);
  for (const error of g4DependencyErrors) blocking.push(error);
  for (const error of g4Traceability?.errors || []) blocking.push(error);
  for (const error of g4Browser?.errors || []) blocking.push(error);

  const attention = [];
  if (openQuestions.length) {
    attention.push(
      `${openQuestions.length} open question(s): resolve or explicitly accept before approving if they affect behaviour, security, or architecture.`
    );
  }
  if (assumptions.length) {
    attention.push(
      `${assumptions.length} assumption(s): do not silently promote these to requirements.`
    );
  }

  const lines = [
    `# Co-design proposal: ${changeId} / ${gate}`,
    "",
    `- **Branch:** \`${branch}\``,
    `- **Gate:** ${gate}`,
    `- **Ready for human decision:** ${ready ? "yes" : "no"}`,
    `- **Sources:** ${sources.map((s) => `\`${s.path}\` (${s.kind}, sha256 ${String(s.sha256).slice(0, 12)}…)`).join("; ") || "_none_"}`,
    "",
    "## Blocking issues",
    blocking.length ? bulletList(blocking) : "_None — required artifacts are present and grounded._",
    "",
    "## Attention (human judgment)",
    attention.length ? bulletList(attention) : "_None._",
    "",
    "## Required packages",
    bulletList(requiredPackages.map((name) => {
      const present = changeArtifacts.some((item) => qualifies(item, name));
      return `${name}: ${present ? "present" : "MISSING"}`;
    })),
    "",
    "## Assumptions (must not be silently promoted)",
    assumptions.length
      ? bulletList(assumptions.map((a) => `[${a.artifact_id}] ${a.text}`))
      : "_None recorded._",
    "",
    "## Open questions",
    openQuestions.length
      ? bulletList(openQuestions.map((q) => `[${q.artifact_id}] ${q.text}`))
      : "_None recorded._",
    "",
  ];

  const session = renderGateSession(gate, { bodies, ready, analysis: g1Analysis });
  if (session) lines.push(session.trimEnd(), "");

  lines.push(appendixHeading(gate));

  for (const { record, body } of bodies) {
    const content = body && body.content !== undefined ? body.content : body;
    lines.push(
      "",
      `### ${record.id}`,
      "",
      `- **Package:** ${record.package}`,
      `- **Status:** ${record.status}`,
      `- **Path:** \`${record.path}\``,
      `- **Source ids:** ${(record.source_ids || []).join(", ") || "_n/a_"}`,
      `- **Source locations:** ${(record.source_locations || []).join(", ") || "_n/a_"}`,
      `- **Derived from:** ${(record.derived_from || []).join(", ") || "_none_"}`,
      `- **Hash:** \`${record.sha256 || "n/a"}\``,
      "",
      "```json",
      summarizeContent(content),
      "```",
    );
  }

  lines.push(
    "",
    approveHeading(gate),
    "",
    approveIntro(gate),
    "",
    "```sh",
    `node "$CLAUDE_PLUGIN_ROOT/scripts/harness-specs.js" approve --change ${changeId} --gate ${gate} --approver <your-name> --root .`,
    "```",
    "",
    "If you reject or amend: edit the draft JSON, re-register, re-run this proposal pack, then approve.",
    "",
  );

  const markdown = `${lines.join("\n")}\n`;
  let writtenPath = null;
  if (write) {
    const relative = path.join(".claude", "specs", "evidence", `${changeId}-gate-${gate}-proposal.md`);
    const absolute = path.join(path.resolve(root), relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, markdown, "utf8");
    writtenPath = relative;
  }

  return {
    change_id: changeId,
    gate,
    branch,
    ready,
    packages_complete: packagesComplete,
    blocking,
    attention,
    missing_packages: missingPackages,
    design_evolution_errors: designEvolutionErrors,
    spdd_errors: spddErrors,
    g1_analysis: g1Analysis ? {
      topological_order: g1Analysis.topological_order,
      dependency_ready_story_ids: g1Analysis.dependency_ready_story_ids,
      critical_path: g1Analysis.critical_path,
      critical_path_points: g1Analysis.critical_path_points,
    } : null,
    g4_dependency_errors: g4DependencyErrors,
    traceability_coverage: g4Traceability?.coverage || null,
    browser_e2e: g4Browser ? { required_story_ids: g4Browser.required_story_ids, check_id: g4Browser.check_id } : null,
    assumptions,
    open_questions: openQuestions,
    artifact_ids: relevant.map((item) => item.id),
    predecessor: predecessor || null,
    predecessor_approved: predecessorOk,
    already_approved: gateAlready,
    written_path: writtenPath,
    markdown,
  };
}

module.exports = {
  GATES,
  PACKAGES,
  GATE_PACKAGES,
  applyPromptAmendment,
  approveTrackerProjection,
  approve,
  currentBranch,
  createTrackerProjection,
  initialize,
  intake,
  proposalPack,
  recordTrackerReceipt,
  register,
  validate,
};
