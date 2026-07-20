const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const ratchet = require("../lib/story-ratchet");
const { workspaceFingerprint } = require("../lib/sensor-scope");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "story-ratchet-"));
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Harness Test"]);
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, "tests"));
  fs.writeFileSync(path.join(root, "src", "app.py"), "def value(): return 1\n");
  fs.writeFileSync(path.join(root, "tests", "test_app.py"), "def test_value(): pass\n");
  execFileSync("git", ["-C", root, "add", "src", "tests"]);
  execFileSync("git", ["-C", root, "commit", "-qm", "baseline"]);
  execFileSync("git", ["-C", root, "switch", "-qc", "feature/story"]);
  const specs = path.join(root, ".claude", "specs");
  fs.mkdirSync(path.join(specs, "stories"), { recursive: true });
  fs.mkdirSync(path.join(specs, "plans"), { recursive: true });
  fs.mkdirSync(path.join(specs, "design"), { recursive: true });
  fs.mkdirSync(path.join(specs, "test-cases"), { recursive: true });
  const story = { id: "C-1-story-1", package: "stories", status: "approved", content: { title: "Value" } };
  const contract = {
    id: "C-1-contract", package: "plans", status: "approved",
    content: {
      story_id: "C-1-story-1", feature_surfaces: ["internal"], source_requirements: ["REQ-1"], approved_design_refs: ["DES-1"],
      dependency_story_ids: [], allowed_change_scope: ["src", "tests"], acceptance_criteria: ["AC-1"],
      test_case_ids: ["TC-1"], test_data_ids: [], required_sensors: ["unit"], performance_budgets: [], routing_risks: [], human_decisions: [],
      implementation_posture: "first-slice", reuse_targets: [],
    },
  };
  fs.writeFileSync(path.join(specs, "stories", "C-1-story-1.json"), JSON.stringify(story));
  fs.writeFileSync(path.join(specs, "plans", "C-1-contract.json"), JSON.stringify(contract));
  fs.writeFileSync(path.join(specs, "design", "DES-1.json"), JSON.stringify({ id: "DES-1", status: "approved" }));
  fs.writeFileSync(path.join(specs, "test-cases", "TC-1.json"), JSON.stringify({ id: "TC-1", status: "approved" }));
  fs.writeFileSync(path.join(specs, "index.json"), JSON.stringify({
    schema_version: 1,
    changes: { "C-1": { branch: "feature/story", gates: { G4: { status: "approved" } } } },
    artifacts: [
      { id: story.id, package: "stories", status: "approved", path: ".claude/specs/stories/C-1-story-1.json" },
      { id: contract.id, change_id: "C-1", package: "plans", status: "approved", path: ".claude/specs/plans/C-1-contract.json" },
      { id: "DES-1", change_id: "C-1", package: "design", status: "approved", path: ".claude/specs/design/DES-1.json" },
      { id: "TC-1", change_id: "C-1", package: "test-cases", status: "approved", path: ".claude/specs/test-cases/TC-1.json" },
    ], relationships: [],
  }));
  fs.mkdirSync(path.join(root, ".claude", "work"), { recursive: true });
  return root;
}

function evidence(root, name, value) {
  const relative = `.claude/work/${name}.json`;
  fs.writeFileSync(path.join(root, relative), `${JSON.stringify(value)}\n`);
  return relative;
}

function sensorReport(root) {
  return {
    generated_at: new Date(Date.now() + 1000).toISOString(),
    status: "pass",
    blocking_status: "pass",
    workspace: workspaceFingerprint(root),
    sensors: [{ sensor_id: "unit", status: "pass" }],
  };
}

test("moves one approved story through red, implementation, review, sensors, and verification", () => {
  const root = fixture();
  const started = ratchet.start(root, { changeId: "C-1", storyId: "C-1-story-1" });
  assert.equal(started.state.state, "READY");
  assert.deepEqual(started.state.completion_contract, {
    acceptance_criteria: ["AC-1"],
    required_sensors: ["unit"],
    required_evidence: ["red_test", "implementation", "validator", "fast_sensors"],
    terminal_state: "STORY_VERIFIED",
  });
  const red = evidence(root, "red", { command: "pytest tests/test_app.py", exit_code: 1, expected_failure: "value should be 2", observed_failure: "expected 2, got 1", test_paths: ["tests/test_app.py"] });
  assert.equal(ratchet.recordRed(root, "C-1-story-1", red).state, "RED_TEST");
  fs.writeFileSync(path.join(root, "src", "app.py"), "def value(): return 2\n");
  const implementation = evidence(root, "implementation", { command: "pytest tests/test_app.py", exit_code: 0, changed_paths: ["src/app.py"], test_paths: ["tests/test_app.py"] });
  assert.equal(ratchet.recordImplementation(root, "C-1-story-1", implementation).state, "IMPLEMENT");
  const review = evidence(root, "review", { verdict: "pass", blocking_findings: [], non_blocking_findings: [], missing_or_stale_evidence: [], required_human_decisions: [], reviewed_paths: ["src/app.py", "tests/test_app.py"], evidence_refs: [implementation] });
  assert.equal(ratchet.recordReview(root, "C-1-story-1", review).state, "STORY_REVIEW");
  const sensors = evidence(root, "sensors", sensorReport(root));
  assert.equal(ratchet.recordSensors(root, "C-1-story-1", sensors).state, "FAST_SENSORS");
  assert.equal(ratchet.verify(root, "C-1-story-1").state, "STORY_VERIFIED");
  assert.deepEqual(ratchet.feedbackProvenance(ratchet.loadState(root, "C-1-story-1").state), [
    { evidence: "red_test", source: "deterministic-test" },
    { evidence: "implementation", source: "deterministic-test" },
    { evidence: "validator", source: "independent-evaluator" },
    { evidence: "fast_sensors", source: "deterministic-sensor" },
  ]);
});

test("rejects implementation outside the approved change scope", () => {
  const root = fixture();
  ratchet.start(root, { changeId: "C-1", storyId: "C-1-story-1" });
  ratchet.recordRed(root, "C-1-story-1", evidence(root, "red", { command: "test", exit_code: 1, expected_failure: "missing", observed_failure: "missing", test_paths: ["tests/test_app.py"] }));
  fs.writeFileSync(path.join(root, "outside.py"), "bad = True\n");
  const passing = evidence(root, "implementation", { command: "test", exit_code: 0, changed_paths: ["src/app.py"], test_paths: ["tests/test_app.py"] });
  assert.throws(() => ratchet.recordImplementation(root, "C-1-story-1", passing), /outside allowed_change_scope/);
});

test("prompt amendment reapproval requirement pauses an active story", () => {
  const root = fixture();
  ratchet.start(root, { changeId: "C-1", storyId: "C-1-story-1" });
  const indexPath = path.join(root, ".claude", "specs", "index.json");
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  index.changes["C-1"].reapproval_required = true;
  delete index.changes["C-1"].gates.G4;
  fs.writeFileSync(indexPath, JSON.stringify(index));
  const red = evidence(root, "red-amended", { command: "test", exit_code: 1, expected_failure: "missing", observed_failure: "missing", test_paths: ["tests/test_app.py"] });
  assert.throws(() => ratchet.recordRed(root, "C-1-story-1", red), /requires G0-G4 reapproval/);
});

test("a revise verdict permits only one configured repair", () => {
  const root = fixture();
  ratchet.start(root, { changeId: "C-1", storyId: "C-1-story-1" });
  ratchet.recordRed(root, "C-1-story-1", evidence(root, "red", { command: "test", exit_code: 1, expected_failure: "missing", observed_failure: "missing", test_paths: ["tests/test_app.py"] }));
  fs.writeFileSync(path.join(root, "src", "app.py"), "def value(): return 2\n");
  ratchet.recordImplementation(root, "C-1-story-1", evidence(root, "implementation", { command: "test", exit_code: 0, changed_paths: ["src/app.py"], test_paths: ["tests/test_app.py"] }));
  const revise = { verdict: "revise", blocking_findings: [{ affected_path: "src/app.py", requirement_or_rule: "AC-1", evidence: "missing edge case", required_action: "add case" }], non_blocking_findings: [], missing_or_stale_evidence: [], required_human_decisions: [], reviewed_paths: ["src/app.py"], evidence_refs: [] };
  ratchet.recordReview(root, "C-1-story-1", evidence(root, "review", revise));
  ratchet.startRepair(root, "C-1-story-1", "missing edge case", 1);
  ratchet.finishRepair(root, "C-1-story-1", { outcome: "passed", evidence: "focused test" });
  ratchet.recordReview(root, "C-1-story-1", evidence(root, "review-again", revise));
  assert.throws(() => ratchet.startRepair(root, "C-1-story-1", "still missing", 1), /Repair limit reached/);
});

test("human-decision-required blocks automated progression", () => {
  const root = fixture();
  ratchet.start(root, { changeId: "C-1", storyId: "C-1-story-1" });
  ratchet.recordRed(root, "C-1-story-1", evidence(root, "red", { command: "test", exit_code: 1, expected_failure: "missing", observed_failure: "missing", test_paths: ["tests/test_app.py"] }));
  fs.writeFileSync(path.join(root, "src", "app.py"), "def value(): return 2\n");
  ratchet.recordImplementation(root, "C-1-story-1", evidence(root, "implementation", { command: "test", exit_code: 0, changed_paths: ["src/app.py"], test_paths: ["tests/test_app.py"] }));
  const verdict = evidence(root, "review", { verdict: "human-decision-required", blocking_findings: [], non_blocking_findings: [], missing_or_stale_evidence: [], required_human_decisions: ["Choose compatibility behavior"], reviewed_paths: ["src/app.py"], evidence_refs: [] });
  assert.equal(ratchet.recordReview(root, "C-1-story-1", verdict).state, "HUMAN_DECISION_REQUIRED");
  assert.throws(() => ratchet.verify(root, "C-1-story-1"), /requires state FAST_SENSORS/);
});

test("does not verify a story after recorded evidence is changed", () => {
  const root = fixture();
  ratchet.start(root, { changeId: "C-1", storyId: "C-1-story-1" });
  ratchet.recordRed(root, "C-1-story-1", evidence(root, "red", { command: "test", exit_code: 1, expected_failure: "missing", observed_failure: "missing", test_paths: ["tests/test_app.py"] }));
  fs.writeFileSync(path.join(root, "src", "app.py"), "def value(): return 2\n");
  ratchet.recordImplementation(root, "C-1-story-1", evidence(root, "implementation", { command: "test", exit_code: 0, changed_paths: ["src/app.py"], test_paths: ["tests/test_app.py"] }));
  ratchet.recordReview(root, "C-1-story-1", evidence(root, "review", { verdict: "pass", blocking_findings: [], non_blocking_findings: [], missing_or_stale_evidence: [], required_human_decisions: [], reviewed_paths: ["src/app.py"], evidence_refs: [] }));
  ratchet.recordSensors(root, "C-1-story-1", evidence(root, "sensors", sensorReport(root)));
  fs.writeFileSync(path.join(root, ".claude", "work", "red.json"), "{}\n");
  assert.throws(() => ratchet.verify(root, "C-1-story-1"), /red_test evidence changed/);
});

test("rejects fresh-looking sensor evidence after product code changes", () => {
  const root = fixture();
  ratchet.start(root, { changeId: "C-1", storyId: "C-1-story-1" });
  ratchet.recordRed(root, "C-1-story-1", evidence(root, "red", { command: "test", exit_code: 1, expected_failure: "missing", observed_failure: "missing", test_paths: ["tests/test_app.py"] }));
  fs.writeFileSync(path.join(root, "src", "app.py"), "def value(): return 2\n");
  ratchet.recordImplementation(root, "C-1-story-1", evidence(root, "implementation", { command: "test", exit_code: 0, changed_paths: ["src/app.py"], test_paths: ["tests/test_app.py"] }));
  ratchet.recordReview(root, "C-1-story-1", evidence(root, "review", { verdict: "pass", blocking_findings: [], non_blocking_findings: [], missing_or_stale_evidence: [], required_human_decisions: [], reviewed_paths: ["src/app.py"], evidence_refs: [] }));
  ratchet.recordSensors(root, "C-1-story-1", evidence(root, "sensors", sensorReport(root)));
  fs.writeFileSync(path.join(root, "src", "app.py"), "def value(): return 3\n");
  assert.throws(() => ratchet.verify(root, "C-1-story-1"), /fast_sensors evidence is stale/);
});
