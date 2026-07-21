const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildImplementationEvidence,
  buildRedEvidence,
  runFocusedCommand,
} = require("../../.claude/lib/story-evidence");
const { runLivedCanary, runMultiStoryEvolutionCanary } = require("../../.claude/lib/lived-canary");

test("runFocusedCommand executes inside the project and captures exit codes", () => {
  const run = runFocusedCommand(process.cwd(), process.execPath, ["-e", "process.exit(7)"]);
  assert.equal(run.exit_code, 7);
  assert.match(run.command, /process\.exit\(7\)/);
  assert.ok(run.executed_at);
});

test("runFocusedCommand isolates nested node --test from NODE_TEST_CONTEXT", () => {
  // This file runs under node --test, so NODE_TEST_CONTEXT is set. Without
  // isolation, a child `node --test` can exit 0 without executing files.
  const fixtureRoot = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "nested-test-"));
  require("node:fs").writeFileSync(
    require("node:path").join(fixtureRoot, "fail.test.js"),
    "const test=require('node:test');const assert=require('node:assert');test('x',()=>assert.fail('expected'));\n"
  );
  const run = runFocusedCommand(fixtureRoot, process.execPath, ["--test", "fail.test.js"]);
  assert.notEqual(run.exit_code, 0);
  require("node:fs").rmSync(fixtureRoot, { recursive: true, force: true });
});

test("red and implementation evidence builders enforce exit semantics", () => {
  const failed = { command: "node --test", argv: ["node", "--test"], exit_code: 1, stdout: "fail", stderr: "", executed_at: new Date().toISOString() };
  const red = buildRedEvidence(failed, {
    expected_failure: "missing field",
    observed_failure: "assert failed",
    test_paths: ["tests/a.test.js"],
  });
  assert.equal(red.exit_code, 1);
  assert.throws(() => buildRedEvidence({ ...failed, exit_code: 0 }, {
    expected_failure: "x", observed_failure: "y", test_paths: ["t"],
  }), /non-zero/);

  const passed = { ...failed, exit_code: 0 };
  const impl = buildImplementationEvidence(passed, {
    changed_paths: ["src/a.js"],
    test_paths: ["tests/a.test.js"],
  });
  assert.equal(impl.exit_code, 0);
  assert.throws(() => buildImplementationEvidence(failed, {
    changed_paths: ["src/a.js"], test_paths: ["tests/a.test.js"],
  }), /exit_code 0/);
});

test("lived canary co-designs G0-G4, runs real pre-PR checks, and reaches draft-PR readiness", () => {
  const report = runLivedCanary();
  assert.equal(report.status, "pass");
  assert.equal(report.story_state, "STORY_VERIFIED");
  assert.deepEqual(report.gates, ["G0", "G1", "G2", "G3", "G4"]);
  assert.equal(report.proposal_paths.length, 5);
  assert.ok(report.red_exit_code > 0);
  assert.equal(report.green_exit_code, 0);
  assert.match(report.real_commands.red, /--test/);
  assert.match(report.real_commands.green, /--test/);
  assert.match(report.evidence.red, /lived-red\.json$/);
  assert.match(report.evidence.implementation, /lived-implement\.json$/);
  assert.equal(report.story_fast_status, "pass");
  assert.equal(report.pre_pr_status, "pass");
  assert.equal(report.fail_closed_unconfigured, true);
  assert.equal(report.readiness_status, "ready-for-draft-pr");
  assert.ok(report.pre_pr_checks.every((check) => check.status === "pass"));
  assert.ok(report.pre_pr_checks.some((check) => check.kind === "unit"));
  assert.ok(report.pre_pr_checks.some((check) => check.kind === "local-smoke"));
  assert.ok(report.pre_pr_checks.some((check) => check.kind === "hermetic-system"));
  assert.ok(report.performance.every((budget) => budget.status === "pass"));
  assert.equal(report.agent_summary.status, "pass");
  assert.match(report.evidence.pre_pr, /pre-pr-verification\.json$/);
  assert.match(report.evidence.readiness, /branch-readiness\.json$/);
});

test("multi-story canary blocks dependent first-slice then verifies reuse-existing", () => {
  const report = runMultiStoryEvolutionCanary();
  assert.equal(report.status, "pass");
  assert.equal(report.negative_path.dependent_first_slice_blocked, true);
  assert.equal(report.negative_path.proposal_ready, false);
  assert.equal(report.negative_path.approve_rejected, true);
  assert.match(report.negative_path.blocking_excerpt, /first-slice/i);
  assert.equal(report.postures["MULTI-001-story-1"], "first-slice");
  assert.equal(report.postures["MULTI-001-story-2"], "reuse-existing");
  assert.equal(report.story_states["MULTI-001-story-1"], "STORY_VERIFIED");
  assert.equal(report.story_states["MULTI-001-story-2"], "STORY_VERIFIED");
  assert.equal(report.reuse_verified_in_source, true);
  assert.ok(report.reuse_targets.some((item) => item.symbol === "createTodo"));
  assert.match(report.real_commands.story1_red, /--test/);
  assert.match(report.real_commands.story2_green, /--test/);
});
