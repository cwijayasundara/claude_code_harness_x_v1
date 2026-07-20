const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { currentBranch } = require("./specifications");
const {
  REQUIRED_PRE_PR_KINDS,
  loadVerificationPlan,
  validateVerificationPlan,
} = require("./verification-plan");
const { redactEvidence } = require("./evidence-hygiene");
const { buildReviewPacket } = require("./modularity-review");
const { assertEvidenceFresh } = require("./sensor-operations");
const { workspaceFingerprint } = require("./sensor-scope");
const { reconcileTraceability } = require("./requirements-traceability");

function projectFile(root, candidate, label) {
  const absolute = path.resolve(root, candidate);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} must be inside the target project.`);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`${label} not found: ${candidate}.`);
  return { absolute, relative };
}

function changedPaths(root) {
  const result = spawnSync("git", ["-C", root, "status", "--porcelain=v1", "--untracked-files=all"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Unable to inspect Git changes.");
  return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).split(" -> ").at(-1)).filter(Boolean);
}

function writeLog(root, changeId, checkId, output) {
  const file = path.join(root, ".claude", "specs", "evidence", "logs", changeId, `${checkId}.log`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, redactEvidence(output || "No command output.\n"), "utf8");
  return path.relative(root, file);
}

function isolatedEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  // Nested under node --test, child node --test would otherwise exit 0 without running.
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_CHANNEL_FD;
  return env;
}

/**
 * pre-pr must not soft-pass with missing commands. Fail closed before execution
 * when any required local-engineer kind is absent or unconfigured.
 */
function assertCadenceConfigured(plan, cadence) {
  if (cadence !== "pre-pr") return;
  const missing = [];
  for (const kind of REQUIRED_PRE_PR_KINDS) {
    const check = plan.checks.find((item) => item.cadence === "pre-pr" && item.kind === kind);
    if (!check) {
      missing.push(`missing pre-pr check kind '${kind}'`);
      continue;
    }
    if (check.configured !== true) {
      missing.push(
        `'${check.id}' (${kind}) is not configured` +
        (check.configuration_help ? `: ${check.configuration_help}` : ".")
      );
    }
  }
  if (missing.length) {
    throw new Error(
      "pre-pr verification is fail-closed until every required check is configured:\n- " +
      missing.join("\n- ")
    );
  }
}

function runCheck(root, changeId, check) {
  if (!check.configured) return {
    sensor_id: check.id, kind: check.kind, cadence: check.cadence, status: "fail",
    affected_paths: [".claude/verification.json"], reason: `${check.label} is not configured.`,
    next_action: check.configuration_help || "Configure this check in .claude/verification.json.",
    evidence: ".claude/verification.json", runtime_ms: 0, cost: "not-run",
  };
  const started = process.hrtime.bigint();
  const execution = spawnSync(check.command, check.args, {
    cwd: root, encoding: "utf8", timeout: check.timeout_ms, maxBuffer: 2 * 1024 * 1024,
    env: isolatedEnv(check.env || {}),
  });
  const runtimeMs = Number(process.hrtime.bigint() - started) / 1e6;
  const output = `${execution.stdout || ""}${execution.stderr || ""}`;
  const log = writeLog(root, changeId, check.id, output);
  const timedOut = execution.error?.code === "ETIMEDOUT";
  const passed = execution.status === 0 && !execution.error;
  return {
    sensor_id: check.id, kind: check.kind, cadence: check.cadence, status: passed ? "pass" : "fail",
    affected_paths: check.affected_paths || ["."],
    reason: passed ? `${check.label} passed.` : `${check.label} ${timedOut ? "timed out" : `failed with exit ${execution.status ?? "unknown"}`}.`,
    next_action: passed ? "No action required." : `Inspect ${log}, correct the failure, and rerun this cadence.`,
    evidence: `${log}; ${check.command} ${check.args.join(" ")}`.trim(), runtime_ms: Math.round(runtimeMs * 100) / 100,
    cost: `local deterministic process; timeout ${check.timeout_ms}ms`,
  };
}

function summarizeVerificationForAgent(report) {
  const failing = (report.checks || []).filter((check) => check.status !== "pass");
  if (!failing.length) {
    return {
      status: "pass",
      summary: `${report.cadence} verification passed on branch ${report.branch}.`,
      corrections: [],
    };
  }
  return {
    status: "fail",
    summary: `${report.cadence} verification failed (${failing.length} check(s)).`,
    corrections: failing.map((check) => ({
      sensor_id: check.sensor_id,
      kind: check.kind,
      reason: check.reason,
      next_action: check.next_action,
      evidence: check.evidence,
      affected_paths: check.affected_paths || [],
    })),
  };
}

function verifyBranch(root, { changeId, cadence }) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(changeId || "")) throw new Error("Change id is invalid.");
  const branch = currentBranch(root);
  const { plan } = loadVerificationPlan(root);
  const errors = validateVerificationPlan(plan);
  if (errors.length) throw new Error(errors.join("\n"));
  assertCadenceConfigured(plan, cadence);
  const selected = plan.checks.filter((check) => check.cadence === cadence);
  if (!selected.length) throw new Error(`No verification checks declare cadence '${cadence}'.`);
  const checks = selected.map((check) => runCheck(path.resolve(root), changeId, check));
  const performance = plan.performance_budgets.filter((budget) => selected.some((check) => check.id === budget.check_id)).map((budget) => {
    const measured = checks.find((check) => check.sensor_id === budget.check_id)?.runtime_ms;
    const status = typeof measured === "number" && measured <= budget.maximum ? "pass" : "fail";
    return { id: budget.id, check_id: budget.check_id, metric: budget.metric, measured, maximum: budget.maximum, unit: "ms", scope: budget.scope, status };
  });
  for (const result of performance.filter((item) => item.status === "fail")) checks.push({
    sensor_id: `performance-${result.id}`, kind: "performance", cadence, status: "fail", affected_paths: [".claude/verification.json"],
    reason: `${result.scope} measured ${result.measured}ms, above budget ${result.maximum}ms.`, next_action: "Profile the measured scope, correct the regression or obtain an approved budget amendment.",
    evidence: `check ${result.check_id}`, runtime_ms: 0, cost: "derived measurement",
  });
  const report = {
    schema_version: 1, change_id: changeId, cadence, branch, generated_at: new Date().toISOString(),
    changed_paths: changedPaths(path.resolve(root)), status: checks.every((check) => check.status === "pass") ? "pass" : "fail",
    checks, sensors: checks, performance,
  };
  report.agent_summary = summarizeVerificationForAgent(report);
  const reportPath = path.join(path.resolve(root), ".claude", "specs", "evidence", `${changeId}-${cadence}-verification.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { report, reportPath };
}

function finalizeBranch(root, { changeId, reportFile, reviewFile }) {
  const projectRoot = path.resolve(root);
  const branch = currentBranch(projectRoot);
  const reportSource = projectFile(projectRoot, reportFile, "Pre-PR report");
  const reviewSource = projectFile(projectRoot, reviewFile, "Branch review");
  const report = JSON.parse(fs.readFileSync(reportSource.absolute, "utf8"));
  const review = JSON.parse(fs.readFileSync(reviewSource.absolute, "utf8"));
  if (report.change_id !== changeId || report.cadence !== "pre-pr" || report.branch !== branch || report.status !== "pass") {
    throw new Error("Branch finalization requires the current branch's passing pre-pr report.");
  }
  assertEvidenceFresh(projectRoot, report, "pre_pr");
  if (review.verdict !== "pass" || !Array.isArray(review.blocking_findings) || review.blocking_findings.length || !Array.isArray(review.required_human_decisions) || review.required_human_decisions.length) {
    throw new Error("Branch finalization requires a passing independent branch review with no blockers or human decisions.");
  }
  if (fs.statSync(reviewSource.absolute).mtimeMs + 1000 < Date.parse(report.generated_at)) throw new Error("Independent branch review predates the pre-pr report.");
  const modularityPacket = buildReviewPacket(projectRoot, report.changed_paths || []);
  let modularityReview = null;
  if (modularityPacket.required) {
    const modularityPath = path.join(projectRoot, ".claude", "specs", "evidence", "runtime", "modularity", "merged-review.json");
    if (!fs.existsSync(modularityPath)) throw new Error("Risk triggers require a merged independent modularity review before branch finalization.");
    modularityReview = JSON.parse(fs.readFileSync(modularityPath, "utf8"));
    if (modularityReview.packet_id !== modularityPacket.packet_id || modularityReview.workspace?.sha256 !== workspaceFingerprint(projectRoot).sha256) throw new Error("Merged modularity review is stale for the current workspace.");
    if (modularityReview.status === "human-decision-required") throw new Error("Merged modularity review has unresolved findings requiring a human decision.");
    if ((modularityReview.independent_review_count || 0) < modularityPacket.minimum_independent_reviews) throw new Error("Merged modularity review lacks the required independent review count.");
  }
  const index = JSON.parse(fs.readFileSync(path.join(projectRoot, ".claude", "specs", "index.json"), "utf8"));
  const stories = index.artifacts.filter((item) => item.change_id === changeId && item.package === "stories" && item.status === "approved");
  if (!stories.length) throw new Error(`Change '${changeId}' has no approved stories.`);
  for (const story of stories) {
    const stateFile = path.join(projectRoot, ".claude", "state", "stories", `${story.id}.json`);
    if (!fs.existsSync(stateFile) || JSON.parse(fs.readFileSync(stateFile, "utf8")).state !== "STORY_VERIFIED") throw new Error(`Story '${story.id}' is not STORY_VERIFIED.`);
  }
  const traceability = reconcileTraceability(projectRoot, index, changeId, report);
  const evidence = {
    schema_version: 1, change_id: changeId, branch, generated_at: new Date().toISOString(), status: "ready-for-draft-pr",
    source_ids: index.changes?.[changeId]?.source_ids || [], story_ids: stories.map((story) => story.id), changed_paths: report.changed_paths,
    pre_pr_report: reportSource.relative, branch_review: reviewSource.relative,
    performance: report.performance, residual_risks: review.non_blocking_findings || [],
    modularity_review: modularityReview ? path.relative(projectRoot, path.join(projectRoot, ".claude", "specs", "evidence", "runtime", "modularity", "merged-review.json")) : null,
    traceability,
  };
  const output = path.join(projectRoot, ".claude", "specs", "evidence", `${changeId}-branch-readiness.json`);
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return { evidence, output };
}

module.exports = {
  assertCadenceConfigured,
  finalizeBranch,
  summarizeVerificationForAgent,
  verifyBranch,
};
