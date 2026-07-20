const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { reconcileTraceability, validateG4Traceability, validateTraceabilityArtifact } = require("../lib/requirements-traceability");
const { workspaceFingerprint } = require("../lib/sensor-scope");

function records(links) {
  return [
    { id: "TC-1", package: "test-cases", status: "approved", body: { content: { cases: ["case"] } } },
    { id: "P-1", package: "plans", status: "draft", body: { content: { story_id: "S-1", source_requirements: ["REQ-1"], acceptance_criteria: ["AC-1"], test_case_ids: ["TC-1"] } } },
    { id: "TRACE-1", package: "traceability", status: "draft", body: { content: { links } } },
  ];
}

function link(overrides = {}) {
  return {
    requirement_id: "REQ-1", source_location: "prd.md#req-1", story_id: "S-1",
    acceptance_criterion_id: "AC-1", test_case_id: "TC-1", level: "unit",
    disposition: "planned-automated", verification_check_id: "unit", risk_tags: [], ...overrides,
  };
}

test("G4 traceability covers every requirement and acceptance criterion", () => {
  const complete = validateG4Traceability(records([link()]), (record) => record.body);
  assert.deepEqual(complete.errors, []);
  assert.equal(complete.coverage.required_items, 2);
  const orphan = validateG4Traceability(records([]), (record) => record.body);
  assert.match(orphan.errors.join("\n"), /non-empty|Orphan requirement/);
});

test("trace links validate automated, manual, and exclusion dispositions", () => {
  assert.deepEqual(validateTraceabilityArtifact({ links: [link()] }), []);
  assert.match(validateTraceabilityArtifact({ links: [link({ disposition: "planned-manual", manual_evidence_id: undefined })] }).join("\n"), /manual_evidence_id/);
  assert.match(validateTraceabilityArtifact({ links: [link({ disposition: "approved-exclusion", owner: "", reason: "", review_on: "bad" })] }).join("\n"), /owner/);
});

test("branch reconciliation requires the mapped automated check to pass", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "traceability-"));
  fs.mkdirSync(path.join(root, ".claude", "specs", "traceability"), { recursive: true });
  const artifactPath = path.join(root, ".claude", "specs", "traceability", "TRACE-1.json");
  fs.writeFileSync(artifactPath, JSON.stringify({ content: { links: [link()] } }));
  const index = { artifacts: [{ id: "TRACE-1", change_id: "C-1", package: "traceability", status: "approved", path: path.relative(root, artifactPath) }] };
  assert.throws(() => reconcileTraceability(root, index, "C-1", { checks: [{ sensor_id: "unit", status: "fail" }] }), /requires passing check/);
  const result = reconcileTraceability(root, index, "C-1", { checks: [{ sensor_id: "unit", status: "pass", evidence: "unit.log" }] });
  assert.equal(result.results[0].status, "automated-pass");
});

test("manual evidence is human-named and hash-backed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "traceability-manual-"));
  fs.mkdirSync(path.join(root, ".claude", "specs", "traceability"), { recursive: true });
  fs.mkdirSync(path.join(root, ".claude", "specs", "evidence", "manual"), { recursive: true });
  const manualLink = link({ level: "manual", disposition: "planned-manual", verification_check_id: undefined, manual_evidence_id: "MAN-1" });
  const artifactPath = path.join(root, ".claude", "specs", "traceability", "TRACE-1.json");
  fs.writeFileSync(artifactPath, JSON.stringify({ content: { links: [manualLink] } }));
  const index = { artifacts: [{ id: "TRACE-1", change_id: "C-1", package: "traceability", status: "approved", path: path.relative(root, artifactPath) }] };
  assert.throws(() => reconcileTraceability(root, index, "C-1", { checks: [] }), /is missing/);
  fs.writeFileSync(path.join(root, ".claude", "specs", "evidence", "manual", "MAN-1.json"), JSON.stringify({ id: "MAN-1", verified_by: "Human QA", verified_at: new Date().toISOString(), result: "pass", workspace: workspaceFingerprint(root) }));
  const result = reconcileTraceability(root, index, "C-1", { checks: [] });
  assert.equal(result.results[0].status, "manual-pass");
  assert.equal(result.results[0].evidence.sha256.length, 64);
});
