const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const { finalizeBranch, verifyBranch } = require("../lib/branch-verification");

function project(failingKind = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "branch-verification-"));
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Harness Test"]);
  fs.writeFileSync(path.join(root, "app.js"), "module.exports = 1;\n");
  execFileSync("git", ["-C", root, "add", "app.js"]);
  execFileSync("git", ["-C", root, "commit", "-qm", "baseline"]);
  execFileSync("git", ["-C", root, "switch", "-qc", "feature/verify"]);
  fs.mkdirSync(path.join(root, ".claude"));
  const kinds = ["install-build", "unit", "integration", "hermetic-system", "local-smoke", "lint", "type", "security"];
  const checks = kinds.map((kind) => ({
    id: kind, label: kind, cadence: "pre-pr", kind, configured: true,
    command: process.execPath, args: ["-e", `process.exit(${kind === failingKind ? 1 : 0})`], timeout_ms: 5000,
    affected_paths: ["app.js"],
    ...(["unit", "integration", "hermetic-system", "local-smoke"].includes(kind) ? { hermetic: true, boundary_ids: ["llm"] } : {}),
    ...(kind === "local-smoke" ? { public_seam: "CLI", safe_local_config: "test doubles", journeys: [{ id: "ok", type: "success" }, { id: "bad", type: "failure" }] } : {}),
  }));
  checks.push({ id: "llm-contract", label: "LLM contract", cadence: "pre-pr", kind: "contract", configured: true, command: process.execPath, args: ["-e", "process.exit(0)"], timeout_ms: 5000 });
  fs.writeFileSync(path.join(root, ".claude", "verification.json"), JSON.stringify({
    version: 1, checks,
    boundaries: [{ id: "llm", kind: "llm", production_dependency: "provider API", test_double: "stub", contract_check_id: "llm-contract" }],
    performance_budgets: [{ id: "smoke", check_id: "local-smoke", metric: "duration_ms", maximum: 2000, scope: "CLI smoke" }],
  }));
  return root;
}

test("runs the complete pre-PR contract and writes normalized evidence", () => {
  const root = project();
  const { report, reportPath } = verifyBranch(root, { changeId: "C-1", cadence: "pre-pr" });
  assert.equal(report.status, "pass");
  assert.ok(report.checks.every((check) => typeof check.runtime_ms === "number" && check.cadence === "pre-pr"));
  assert.equal(report.performance[0].status, "pass");
  assert.ok(fs.existsSync(reportPath));
});

test("a failing hermetic regression blocks the branch report", () => {
  const root = project("hermetic-system");
  const { report } = verifyBranch(root, { changeId: "C-2", cadence: "pre-pr" });
  assert.equal(report.status, "fail");
  assert.equal(report.checks.find((check) => check.kind === "hermetic-system").status, "fail");
});

test("pre-pr fails closed when a required check is unconfigured", () => {
  const root = project();
  const plan = JSON.parse(fs.readFileSync(path.join(root, ".claude", "verification.json"), "utf8"));
  const unit = plan.checks.find((check) => check.kind === "unit");
  unit.configured = false;
  unit.configuration_help = "Configure the unit suite.";
  delete unit.command;
  delete unit.args;
  delete unit.timeout_ms;
  fs.writeFileSync(path.join(root, ".claude", "verification.json"), JSON.stringify(plan));
  assert.throws(
    () => verifyBranch(root, { changeId: "C-unconfigured", cadence: "pre-pr" }),
    /fail-closed|not configured/
  );
});

test("agent_summary lists corrections for failing checks", () => {
  const root = project("security");
  const { report } = verifyBranch(root, { changeId: "C-summary", cadence: "pre-pr" });
  assert.equal(report.status, "fail");
  assert.equal(report.agent_summary.status, "fail");
  assert.ok(report.agent_summary.corrections.some((item) => item.kind === "security"));
  assert.ok(report.agent_summary.corrections[0].next_action);
});

test("finalizes only after every approved story and independent branch review pass", () => {
  const root = project();
  const { reportPath } = verifyBranch(root, { changeId: "C-3", cadence: "pre-pr" });
  fs.mkdirSync(path.join(root, ".claude", "state", "stories"), { recursive: true });
  fs.mkdirSync(path.join(root, ".claude", "specs", "reviews"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "state", "stories", "C-3-story.json"), JSON.stringify({ story_id: "C-3-story", state: "STORY_VERIFIED" }));
  fs.writeFileSync(path.join(root, ".claude", "specs", "index.json"), JSON.stringify({ changes: { "C-3": { source_ids: ["C-3-source"] } }, artifacts: [{ id: "C-3-story", change_id: "C-3", package: "stories", status: "approved" }] }));
  const reviewPath = path.join(root, ".claude", "specs", "reviews", "C-3-branch.json");
  fs.writeFileSync(reviewPath, JSON.stringify({ verdict: "pass", blocking_findings: [], required_human_decisions: [], non_blocking_findings: [] }));
  const { evidence } = finalizeBranch(root, { changeId: "C-3", reportFile: path.relative(root, reportPath), reviewFile: path.relative(root, reviewPath) });
  assert.equal(evidence.status, "ready-for-draft-pr");
  assert.deepEqual(evidence.story_ids, ["C-3-story"]);
});
