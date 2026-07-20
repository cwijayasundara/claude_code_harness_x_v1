const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");

const pluginRoot = path.resolve(__dirname, "..");
const initializer = path.join(pluginRoot, "scripts", "harness-init.js");
const status = path.join(pluginRoot, "scripts", "harness-status.js");

test("status reports installation and operational-health signals", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-status-"));
  execFileSync(process.execPath, [initializer, root], { cwd: pluginRoot, stdio: "ignore" });
  fs.mkdirSync(path.join(root, ".claude", "specs", "evidence", "runtime"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "specs", "evidence", "runtime", "sensor-report.json"), JSON.stringify({ status: "pass", generated_at: "2026-07-18T00:00:00.000Z" }));
  fs.writeFileSync(path.join(root, ".claude", "specs", "evidence", "runtime", "harness-doctor.json"), JSON.stringify({ status: "pass" }));
  const output = execFileSync(process.execPath, [status, root], { cwd: pluginRoot, encoding: "utf8" });
  assert.match(output, /Installed harness: 0\.2\.0/);
  assert.match(output, /Latest sensors: pass/);
  assert.match(output, /Environment doctor: pass/);
  assert.match(output, /Real-pilot readiness/);
  assert.match(output, /Status: insufficient-evidence; rollout authority: human/);
});

test("agent status gives concise correction guidance and a sensor trend", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-agent-status-"));
  execFileSync(process.execPath, [initializer, root], { cwd: pluginRoot, stdio: "ignore" });
  const evidence = path.join(root, ".claude", "specs", "evidence", "runtime");
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, "sensor-report.json"), JSON.stringify({
    status: "fail",
    generated_at: "2026-07-18T00:00:00.000Z",
    sensors: [{
      sensor_id: "secret-scan",
      status: "fail",
      affected_paths: ["app/config.py"],
      reason: "Potential committed secret found.",
      next_action: "Remove the secret.",
    }],
  }));
  fs.writeFileSync(path.join(evidence, "sensor-history.jsonl"), [
    JSON.stringify({ sensor_id: "secret-scan", status: "pass" }),
    JSON.stringify({ sensor_id: "secret-scan", status: "fail" }),
  ].join("\n") + "\n");

  const output = execFileSync(process.execPath, [status, root, "--agent"], { cwd: pluginRoot, encoding: "utf8" });
  assert.match(output, /SENSOR STATUS: fail/);
  assert.match(output, /FAIL secret-scan \[worse\]/);
  assert.match(output, /PATHS: app\/config.py/);
  assert.match(output, /Remove and rotate the exposed credential/);
});

test("status surfaces a story completion contract and feedback provenance", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-story-status-"));
  execFileSync(process.execPath, [initializer, root], { cwd: pluginRoot, stdio: "ignore" });
  const stories = path.join(root, ".claude", "state", "stories");
  fs.writeFileSync(path.join(stories, "C-1-story-1.json"), JSON.stringify({
    story_id: "C-1-story-1",
    state: "STORY_REVIEW",
    repair_attempts: 0,
    updated_at: "2026-07-20T00:00:00.000Z",
    completion_contract: {
      acceptance_criteria: ["AC-1"],
      required_sensors: ["unit"],
      required_evidence: ["red_test", "implementation", "validator", "fast_sensors"],
      terminal_state: "STORY_VERIFIED",
    },
    evidence: { red_test: {}, implementation: {}, validator: {} },
  }));
  const output = execFileSync(process.execPath, [status, root], { cwd: pluginRoot, encoding: "utf8" });
  assert.match(output, /Exit: STORY_VERIFIED; AC AC-1; sensors unit/);
  assert.match(output, /red_test=deterministic-test/);
  assert.match(output, /validator=independent-evaluator/);
});

test("status leads with a concise active-work dashboard and preserves full detail", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-workflow-status-"));
  execFileSync(process.execPath, [initializer, root], { cwd: pluginRoot, stdio: "ignore" });
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Harness Test"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-qm", "scaffold"]);
  execFileSync("git", ["-C", root, "switch", "-qc", "feature/status"]);
  const indexPath = path.join(root, ".claude", "specs", "index.json");
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  index.changes["US-142"] = {
    branch: "feature/status", source_ids: [], gates: {}, workflow: {
      entry_kind: "story", target: "draft-pr", interaction_mode: "checkpoint",
      repository_posture: "brownfield", delivery_lane: "bounded-change",
      classification_confidence: "high", classification_rationale: ["Explicit story"], material_questions: [],
      current_checkpoint: "product", state: "active", next_action: "cached", created_at: "2026-07-20T00:00:00Z", updated_at: "2026-07-20T00:00:00Z",
    },
  };
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  const concise = execFileSync(process.execPath, [status, root], { cwd: pluginRoot, encoding: "utf8" });
  assert.match(concise, /Change: US-142/);
  assert.match(concise, /Route: brownfield bounded-change/);
  assert.match(concise, /Next: Prepare or review the grounded intent \(G0\)/);
  assert.doesNotMatch(concise, /Real-pilot readiness/);
  const full = execFileSync(process.execPath, [status, root, "--full"], { cwd: pluginRoot, encoding: "utf8" });
  assert.match(full, /Real-pilot readiness/);
});
