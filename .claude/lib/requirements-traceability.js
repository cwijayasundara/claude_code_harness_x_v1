const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { workspaceFingerprint } = require("./sensor-scope");

const LEVELS = new Set(["unit", "integration", "contract", "system", "browser-e2e", "manual"]);
const DISPOSITIONS = new Set(["planned-automated", "planned-manual", "approved-exclusion"]);

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function contentOf(record, loadBody) {
  return loadBody(record)?.content || null;
}

function validateLink(link, index) {
  const errors = [];
  const label = `links[${index}]`;
  for (const field of ["requirement_id", "source_location", "story_id", "acceptance_criterion_id", "test_case_id"]) {
    if (typeof link?.[field] !== "string" || !link[field].trim()) errors.push(`${label}.${field} is required.`);
  }
  if (!LEVELS.has(link?.level)) errors.push(`${label}.level is invalid.`);
  if (!DISPOSITIONS.has(link?.disposition)) errors.push(`${label}.disposition is invalid.`);
  if (link?.disposition === "planned-automated" && (typeof link.verification_check_id !== "string" || !link.verification_check_id.trim())) {
    errors.push(`${label}.verification_check_id is required for planned-automated coverage.`);
  }
  if (link?.disposition === "planned-manual" && (typeof link.manual_evidence_id !== "string" || !link.manual_evidence_id.trim())) {
    errors.push(`${label}.manual_evidence_id is required for planned-manual coverage.`);
  }
  if (link?.disposition === "approved-exclusion") {
    for (const field of ["owner", "reason", "review_on"]) if (typeof link[field] !== "string" || !link[field].trim()) errors.push(`${label}.${field} is required for approved-exclusion.`);
    if (link.review_on && !/^\d{4}-\d{2}-\d{2}$/.test(link.review_on)) errors.push(`${label}.review_on must be YYYY-MM-DD.`);
  }
  if (!Array.isArray(link?.risk_tags)) errors.push(`${label}.risk_tags must be an array.`);
  return errors;
}

function validateTraceabilityArtifact(content) {
  if (!content || typeof content !== "object" || Array.isArray(content)) return ["traceability content must be an object."];
  if (!Array.isArray(content.links) || content.links.length === 0) return ["traceability.links must be a non-empty array."];
  return content.links.flatMap(validateLink);
}

function validateG4Traceability(records, loadBody) {
  const errors = [];
  const traceRecords = records.filter((item) => item.package === "traceability" && item.status !== "superseded");
  if (traceRecords.length !== 1) return { errors: ["G4 requires exactly one traceability artifact."], coverage: null };
  const content = contentOf(traceRecords[0], loadBody);
  errors.push(...validateTraceabilityArtifact(content));
  const links = content?.links || [];
  const contracts = records.filter((item) => item.package === "plans" && item.status !== "superseded")
    .map((record) => ({ record, content: contentOf(record, loadBody) }))
    .filter((item) => item.content?.story_id);
  const testArtifacts = new Set(records.filter((item) => item.package === "test-cases" && item.status === "approved").map((item) => item.id));
  const requiredRequirements = [];
  const requiredCriteria = [];
  for (const { record, content: contract } of contracts) {
    for (const requirementId of contract.source_requirements || []) requiredRequirements.push({ story_id: contract.story_id, requirement_id: requirementId, contract_id: record.id });
    for (const acId of contract.acceptance_criteria || []) requiredCriteria.push({ story_id: contract.story_id, acceptance_criterion_id: acId, contract_id: record.id });
    for (const testId of contract.test_case_ids || []) if (!testArtifacts.has(testId)) errors.push(`Story contract '${record.id}' references unapproved test case '${testId}'.`);
  }
  for (const item of requiredRequirements) if (!links.some((link) => link.story_id === item.story_id && link.requirement_id === item.requirement_id)) errors.push(`Orphan requirement: ${item.story_id} / ${item.requirement_id} has no test disposition.`);
  for (const item of requiredCriteria) if (!links.some((link) => link.story_id === item.story_id && link.acceptance_criterion_id === item.acceptance_criterion_id)) errors.push(`Orphan acceptance criterion: ${item.story_id} / ${item.acceptance_criterion_id} has no test disposition.`);
  for (const [index, link] of links.entries()) {
    const contract = contracts.find((item) => item.content.story_id === link.story_id)?.content;
    if (!contract) errors.push(`links[${index}] references unknown story '${link.story_id}'.`);
    else {
      if (!contract.source_requirements.includes(link.requirement_id)) errors.push(`links[${index}] references unknown requirement '${link.requirement_id}' for ${link.story_id}.`);
      if (!contract.acceptance_criteria.includes(link.acceptance_criterion_id)) errors.push(`links[${index}] references unknown acceptance criterion '${link.acceptance_criterion_id}' for ${link.story_id}.`);
      if (!contract.test_case_ids.includes(link.test_case_id)) errors.push(`links[${index}] test '${link.test_case_id}' is not approved by the ${link.story_id} contract.`);
    }
  }
  const requiredCount = requiredRequirements.length + requiredCriteria.length;
  const orphanCount = errors.filter((error) => error.startsWith("Orphan requirement:") || error.startsWith("Orphan acceptance criterion:")).length;
  return { errors, coverage: { required_items: requiredCount, linked_items: requiredCount - orphanCount, link_count: links.length, artifact_id: traceRecords[0].id } };
}

function loadManualEvidence(root, evidenceId) {
  const file = path.join(root, ".claude", "specs", "evidence", "manual", `${evidenceId}.json`);
  if (!fs.existsSync(file)) return { error: `Manual evidence '${evidenceId}' is missing.` };
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (data.id !== evidenceId || typeof data.verified_by !== "string" || !data.verified_by.trim() || !data.verified_at || data.result !== "pass") {
    return { error: `Manual evidence '${evidenceId}' must record id, verified_by, verified_at, and result='pass'.` };
  }
  if (!data.workspace?.sha256 || data.workspace.sha256 !== workspaceFingerprint(root).sha256) {
    return { error: `Manual evidence '${evidenceId}' is stale for the current product workspace.` };
  }
  return { data, path: path.relative(root, file), sha256: sha256(file) };
}

function reconcileTraceability(root, index, changeId, report) {
  const record = index.artifacts.find((item) => item.change_id === changeId && item.package === "traceability" && item.status === "approved");
  if (!record) throw new Error(`Change '${changeId}' has no approved traceability artifact.`);
  const artifact = JSON.parse(fs.readFileSync(path.join(root, record.path), "utf8"));
  const checks = new Map((report.checks || []).map((check) => [check.sensor_id, check]));
  const now = new Date().toISOString().slice(0, 10);
  const results = [];
  const errors = [];
  for (const link of artifact.content.links) {
    let status = "unverified";
    let evidence = null;
    if (link.disposition === "planned-automated") {
      const check = checks.get(link.verification_check_id);
      if (check?.status === "pass") {
        status = "automated-pass";
        evidence = check.evidence;
      } else errors.push(`Trace ${link.story_id}/${link.acceptance_criterion_id} requires passing check '${link.verification_check_id}'.`);
    } else if (link.disposition === "planned-manual") {
      const manual = loadManualEvidence(root, link.manual_evidence_id);
      if (manual.error) errors.push(manual.error);
      else {
        status = "manual-pass";
        evidence = { path: manual.path, sha256: manual.sha256, verified_by: manual.data.verified_by };
      }
    } else if (link.disposition === "approved-exclusion") {
      if (link.review_on < now) errors.push(`Approved exclusion for ${link.story_id}/${link.acceptance_criterion_id} expired on ${link.review_on}.`);
      else {
        status = "approved-exclusion";
        evidence = { owner: link.owner, reason: link.reason, review_on: link.review_on };
      }
    }
    results.push({ requirement_id: link.requirement_id, story_id: link.story_id, acceptance_criterion_id: link.acceptance_criterion_id, test_case_id: link.test_case_id, level: link.level, status, evidence });
  }
  if (errors.length) throw new Error(`Requirements traceability is incomplete:\n- ${errors.join("\n- ")}`);
  return { artifact_id: record.id, status: "pass", results };
}

module.exports = { DISPOSITIONS, LEVELS, reconcileTraceability, validateG4Traceability, validateTraceabilityArtifact };
