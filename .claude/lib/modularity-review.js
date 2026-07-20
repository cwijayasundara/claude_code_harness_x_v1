const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { checkCouplingImpact, checkDependencyCycles } = require("./dependency-sensors");
const { gitChangedPaths, workspaceFingerprint } = require("./sensor-scope");

const CATEGORIES = new Set(["semantic-duplication", "inconsistent-convention", "misplaced-responsibility", "incomplete-abstraction", "parameter-propagation", "god-module", "boundary-erosion", "change-amplification"]);
const SEVERITIES = new Set(["advisory", "high", "blocking"]);
const DECISIONS = new Set(["intentional-hub", "accepted-tradeoff", "false-positive"]);
const DEFAULTS = Object.freeze({ version: 1, enabled: true, minimum_independent_reviews: 2, triggers: { changed_files: 12, changed_source_files: 8, new_dependency_edges: 5, high_impact_modules: 1, dependency_cycles: 1, verified_stories_since_review: 4 }, include_paths: [".claude/project/architecture.md", ".claude/project/boundaries.json", ".claude/project/dependency-sensors.json"] });

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function fingerprint(value) { return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }

function loadModularityConfig(root) {
  const filePath = path.join(path.resolve(root), ".claude", "project", "modularity-review.json");
  if (!fs.existsSync(filePath)) return { filePath, defaults: true, config: structuredClone(DEFAULTS) };
  const parsed = readJson(filePath);
  if (parsed.version !== 1 || typeof parsed.enabled !== "boolean") throw new Error(`${filePath} must declare version 1 and enabled boolean.`);
  const config = { ...DEFAULTS, ...parsed, triggers: { ...DEFAULTS.triggers, ...(parsed.triggers || {}) } };
  if (!Number.isInteger(config.minimum_independent_reviews) || config.minimum_independent_reviews < 2 || config.minimum_independent_reviews > 5) throw new Error(`${filePath} minimum_independent_reviews must be from 2 to 5.`);
  for (const [key, value] of Object.entries(config.triggers)) if (!Number.isInteger(value) || value < 0) throw new Error(`${filePath} triggers.${key} must be a non-negative integer.`);
  if (!Array.isArray(config.include_paths) || config.include_paths.some((item) => {
    if (typeof item !== "string" || !item || path.isAbsolute(item)) return true;
    const normalized = path.normalize(item);
    return normalized === ".." || normalized.startsWith(`..${path.sep}`);
  })) throw new Error(`${filePath} include_paths must be project-relative paths.`);
  return { filePath, defaults: false, config };
}

function sourcePath(relative) { return /\.(?:py|js|jsx|mjs|cjs|ts|tsx|mts|cts|go|rs|java|kt)$/.test(relative); }
function reference(root, relative) {
  const full = path.join(path.resolve(root), relative);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return { path: relative, sha256: crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex") };
}

function evaluateTriggers(root, changedPaths, config) {
  const changed = changedPaths.length ? changedPaths : gitChangedPaths(root);
  const cycles = checkDependencyCycles(root, changed);
  const coupling = checkCouplingImpact(root, changed);
  const mergedPath = path.join(path.resolve(root), ".claude", "specs", "evidence", "runtime", "modularity", "merged-review.json");
  const lastReviewAt = fs.existsSync(mergedPath) ? Date.parse(readJson(mergedPath).generated_at || 0) : 0;
  const storyDirectory = path.join(path.resolve(root), ".claude", "state", "stories");
  const verifiedStories = fs.existsSync(storyDirectory) ? fs.readdirSync(storyDirectory).filter((name) => name.endsWith(".json")).map((name) => readJson(path.join(storyDirectory, name))).filter((story) => story.state === "STORY_VERIFIED" && Date.parse(story.updated_at || 0) > lastReviewAt).length : 0;
  const values = {
    changed_files: changed.filter((item) => !item.startsWith(".claude/")).length,
    changed_source_files: changed.filter(sourcePath).length,
    new_dependency_edges: coupling.metrics.new_edge_count || 0,
    high_impact_modules: coupling.metrics.risky_modules?.length || 0,
    dependency_cycles: cycles.metrics.cycle_count || 0,
    verified_stories_since_review: verifiedStories,
  };
  const fired = Object.entries(config.triggers).filter(([key, threshold]) => threshold > 0 && values[key] >= threshold).map(([key, threshold]) => ({ id: key, actual: values[key], threshold }));
  return { required: fired.length > 0, fired, values, dependency: { cycles: cycles.metrics, coupling: coupling.metrics } };
}

function buildReviewPacket(root, changedPaths = []) {
  const { config } = loadModularityConfig(root);
  const workspace = workspaceFingerprint(root);
  const changed = changedPaths.length ? [...new Set(changedPaths)] : workspace.changed_paths;
  const trigger = evaluateTriggers(root, changed, config);
  const packet = {
    schema_version: 1,
    packet_id: `modularity-${workspace.sha256.slice(0, 16)}`,
    generated_at: new Date().toISOString(),
    required: config.enabled && trigger.required,
    minimum_independent_reviews: config.minimum_independent_reviews,
    workspace,
    changed_paths: changed,
    triggers: trigger,
    grounding_refs: config.include_paths.map((item) => reference(root, item)).filter(Boolean),
    review_instructions: {
      categories: [...CATEGORIES],
      inspect: ["changed code and its callers/callees", "architecture and boundary intent", "existing canonical implementations before declaring duplication"],
      avoid: ["treating every high fan-in module as a god module", "proposing abstraction without at least two real uses", "material refactoring without human approval"],
      output: "One version-1 modularity review JSON document matching the documented finding contract.",
    },
  };
  return packet;
}

function validateReview(review, packet) {
  const errors = [];
  if (!review || review.schema_version !== 1) return ["Review must declare schema_version 1."];
  for (const field of ["review_id", "reviewer_id", "independent_context_id"]) if (typeof review[field] !== "string" || !review[field]) errors.push(`${field} is required.`);
  if (review.packet_id !== packet.packet_id || review.workspace_sha256 !== packet.workspace.sha256) errors.push("Review is stale or targets a different packet/workspace.");
  if (!Array.isArray(review.findings)) errors.push("findings must be an array.");
  for (const [index, finding] of (review.findings || []).entries()) {
    const label = `findings[${index}]`;
    if (!CATEGORIES.has(finding.category)) errors.push(`${label}.category is invalid.`);
    if (!SEVERITIES.has(finding.severity)) errors.push(`${label}.severity is invalid.`);
    if (!Array.isArray(finding.affected_paths) || !finding.affected_paths.length || finding.affected_paths.some((item) => typeof item !== "string" || !item)) errors.push(`${label}.affected_paths is required.`);
    if (!Array.isArray(finding.evidence) || !finding.evidence.length || finding.evidence.some((item) => typeof item !== "string" || !item)) errors.push(`${label}.evidence is required.`);
    if (!Array.isArray(finding.design_options) || finding.design_options.length < 2) errors.push(`${label}.design_options requires at least two options.`);
    if (typeof finding.recommendation !== "string" || !finding.recommendation) errors.push(`${label}.recommendation is required.`);
  }
  return errors;
}

function findingFingerprint(finding) { return fingerprint({ category: finding.category, affected_paths: [...finding.affected_paths].sort() }); }

function loadDecisions(root, today = new Date().toISOString().slice(0, 10)) {
  const filePath = path.join(path.resolve(root), ".claude", "project", "modularity-decisions.json");
  if (!fs.existsSync(filePath)) return { filePath, decisions: [] };
  const document = readJson(filePath);
  if (document.version !== 1 || !Array.isArray(document.decisions)) throw new Error(`${filePath} must contain version 1 and decisions array.`);
  const decisions = document.decisions.filter((decision, index) => {
    if (!DECISIONS.has(decision.classification) || !/^[a-f0-9]{64}$/.test(decision.finding_fingerprint || "")) throw new Error(`${filePath} decisions[${index}] classification or fingerprint is invalid.`);
    for (const field of ["owner", "approved_by", "reason", "expires_on"]) if (typeof decision[field] !== "string" || !decision[field]) throw new Error(`${filePath} decisions[${index}].${field} is required.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(decision.expires_on)) throw new Error(`${filePath} decisions[${index}].expires_on must use YYYY-MM-DD.`);
    return decision.expires_on >= today;
  });
  return { filePath, decisions };
}

function mergeReviews(root, packet, reviews) {
  const identities = new Set(); const contexts = new Set();
  for (const review of reviews) {
    const errors = validateReview(review, packet); if (errors.length) throw new Error(errors.join(" "));
    if (identities.has(review.reviewer_id) || contexts.has(review.independent_context_id)) throw new Error("Modularity reviews must use distinct reviewers and independent contexts.");
    identities.add(review.reviewer_id); contexts.add(review.independent_context_id);
  }
  if (reviews.length < packet.minimum_independent_reviews) throw new Error(`Need at least ${packet.minimum_independent_reviews} independent modularity reviews.`);
  const groups = new Map();
  for (const review of reviews) for (const finding of review.findings) {
    const key = findingFingerprint(finding); const group = groups.get(key) || { finding_fingerprint: key, category: finding.category, affected_paths: [...finding.affected_paths].sort(), reviews: [], severities: [], evidence: new Set(), design_options: new Set(), recommendations: new Set() };
    group.reviews.push(review.review_id); group.severities.push(finding.severity); finding.evidence.forEach((item) => group.evidence.add(item)); finding.design_options.forEach((item) => group.design_options.add(item)); group.recommendations.add(finding.recommendation); groups.set(key, group);
  }
  const decisions = new Map(loadDecisions(root).decisions.map((item) => [item.finding_fingerprint, item]));
  const rank = { advisory: 0, high: 1, blocking: 2 };
  const findings = [...groups.values()].map((group) => {
    const decision = decisions.get(group.finding_fingerprint) || null;
    const maxSeverity = group.severities.sort((a, b) => rank[b] - rank[a])[0];
    const corroborated = group.reviews.length >= 2;
    const disposition = decision ? "accepted-decision" : maxSeverity === "blocking" || (maxSeverity === "high" && corroborated) ? "human-decision-required" : "advisory";
    return { ...group, evidence: [...group.evidence], design_options: [...group.design_options], recommendations: [...group.recommendations], review_count: group.reviews.length, corroborated, maximum_severity: maxSeverity, disposition, decision };
  });
  const status = findings.some((item) => item.disposition === "human-decision-required") ? "human-decision-required" : findings.some((item) => item.disposition === "advisory") ? "advisory" : "pass";
  return { schema_version: 1, generated_at: new Date().toISOString(), packet_id: packet.packet_id, workspace: packet.workspace, status, independent_review_count: reviews.length, findings };
}

function writeReviewPacket(root, packet) {
  const directory = path.join(path.resolve(root), ".claude", "specs", "evidence", "runtime", "modularity");
  const jsonPath = path.join(directory, "review-packet.json"); writeJson(jsonPath, packet);
  const markdownPath = path.join(directory, "review-packet.md");
  fs.writeFileSync(markdownPath, `# Modularity review packet\n\n- Packet: ${packet.packet_id}\n- Required: ${packet.required}\n- Changed paths: ${packet.changed_paths.join(", ") || "none"}\n- Triggers: ${packet.triggers.fired.map((item) => `${item.id} ${item.actual}/${item.threshold}`).join(", ") || "none"}\n\nReview semantic duplication, inconsistent conventions, misplaced responsibilities, incomplete abstractions, parameter propagation, boundary erosion, and change amplification. Ground every finding in code and provide at least two design options.\n`, "utf8");
  return { jsonPath, markdownPath };
}

module.exports = { CATEGORIES, buildReviewPacket, evaluateTriggers, findingFingerprint, loadDecisions, loadModularityConfig, mergeReviews, validateReview, writeReviewPacket };
