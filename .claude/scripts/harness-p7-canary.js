#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { buildCodeMap } = require("../lib/brownfield-map");
const { finalizeBranch, verifyBranch } = require("../lib/branch-verification");
const { packContext } = require("../lib/context-budget");
const { route } = require("../lib/routing-policy");
const specs = require("../lib/specifications");
const ratchet = require("../lib/story-ratchet");
const { workspaceFingerprint } = require("../lib/sensor-scope");

const pluginRoot = path.resolve(__dirname, "..");

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function writeJson(root, relative, value) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return relative;
}

function register(root, artifact) {
  const input = writeJson(root, `.claude/work/${artifact.id}.json`, artifact);
  return specs.register(root, input);
}

function baseArtifact(changeId, sourceId, id, packageName, content, derivedFrom = []) {
  return { id, package: packageName, change_id: changeId, source_ids: [sourceId], source_locations: ["requirements.md"], derived_from: derivedFrom, status: "draft", assumptions: [], open_questions: [], human_approver: null, approved_at: null, content };
}

function verificationPlan(root, failingKind = null) {
  const kinds = ["install-build", "unit", "integration", "hermetic-system", "local-smoke", "lint", "type", "security"];
  const checks = kinds.map((kind) => ({
    id: kind, label: kind, cadence: "pre-pr", kind, configured: true, command: process.execPath,
    args: ["-e", `process.exit(${kind === failingKind ? 1 : 0})`], timeout_ms: 5000, affected_paths: ["src/app.py", "tests/test_app.py"],
    ...(["unit", "integration", "hermetic-system", "local-smoke"].includes(kind) ? { hermetic: true, boundary_ids: ["external-api"] } : {}),
    ...(kind === "local-smoke" ? { public_seam: "CLI value", safe_local_config: "synthetic canary with stub", journeys: [{ id: "value-ok", type: "success" }, { id: "value-invalid", type: "failure" }] } : {}),
  }));
  checks.push({ id: "external-contract", label: "external contract", cadence: "pre-pr", kind: "contract", configured: true, command: process.execPath, args: ["-e", "process.exit(0)"], timeout_ms: 5000 });
  writeJson(root, ".claude/verification.json", { version: 1, checks, boundaries: [{ id: "external-api", kind: "http", production_dependency: "example API", test_double: "stub", contract_check_id: "external-contract" }], performance_budgets: [{ id: "smoke-duration", check_id: "local-smoke", metric: "duration_ms", maximum: 2000, scope: "synthetic public seam" }] });
}

function setup(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `harness-p7-${name}-`));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "canary@example.com"]);
  git(root, ["config", "user.name", "Harness Canary"]);
  fs.writeFileSync(path.join(root, "seed.txt"), "seed\n");
  git(root, ["add", "seed.txt"]); git(root, ["commit", "-qm", "seed"]); git(root, ["switch", "-qc", `feature/${name}`]);
  execFileSync(process.execPath, [path.join(pluginRoot, "scripts", "harness-init.js"), root], { stdio: "ignore" });
  fs.mkdirSync(path.join(root, "src")); fs.mkdirSync(path.join(root, "tests"));
  fs.writeFileSync(path.join(root, "src", "app.py"), "def value(): return 1\n");
  fs.writeFileSync(path.join(root, "tests", "test_app.py"), "def test_value(): pass\n");
  fs.writeFileSync(path.join(root, "requirements.md"), `# ${name} requirement\nValue must become two.\n`);
  verificationPlan(root);
  return root;
}

function approveDesign(root, changeId, brownfield) {
  const sourceId = `${changeId}-source`;
  specs.intake(root, { changeId, source: "requirements.md", kind: "prd" });
  register(root, baseArtifact(changeId, sourceId, `${changeId}-prd`, "prd", { outcome: "Value becomes two" }));
  const analysisId = `${changeId}-analysis`;
  register(root, baseArtifact(changeId, sourceId, analysisId, "analysis", {
    domain_concepts: ["value"], strategic_direction: ["Narrow behavior change"],
    risks: ["Regression"], requirement_gaps: ["None in synthetic fixture"],
  }, [`${changeId}-prd`]));
  register(root, baseArtifact(changeId, sourceId, `${changeId}-reasons`, "reasons-canvas", {
    requirements: ["Value becomes two"], entities: ["Value"], approach: ["Focused edit"],
    structure: ["Existing function"], operations: ["Red, green, verify"],
    norms: ["Small change"], safeguards: ["No unrelated edits"],
    sync: { status: "aligned", amendment_ids: [] },
  }, [analysisId]));
  specs.approve(root, { changeId, gate: "G0", approver: "Canary Human" });
  if (brownfield) {
    register(root, baseArtifact(changeId, sourceId, `${changeId}-baseline`, "brownfield", { artifact_type: "baseline", commands: [{ command: "synthetic baseline", exit_code: 0 }] }));
    specs.approve(root, { changeId, gate: "B0", approver: "Canary Human" });
    const codeMap = buildCodeMap(root, ["src", "tests"], undefined, ["value"]);
    register(root, baseArtifact(changeId, sourceId, `${changeId}-code-map`, "brownfield", { artifact_type: "code-map", ...codeMap }));
    specs.approve(root, { changeId, gate: "B1", approver: "Canary Human" });
    register(root, baseArtifact(changeId, sourceId, `${changeId}-strategy`, "brownfield", {
      artifact_type: "change-strategy",
      smallest_behavioral_seam: "value",
      second_slice_decision: "reuse-existing",
      reuse: [{ path: "src/app.py", symbol: "value" }],
    }, [`${changeId}-code-map`]));
    register(root, baseArtifact(changeId, sourceId, `${changeId}-amendment`, "amendments", {
      artifact_type: "design-amendment",
      decision: "no architecture change",
      proposed_delta: "Change return value only.",
      alternatives: ["rewrite module", "narrow edit to value()"],
    }, [`${changeId}-strategy`]));
    specs.approve(root, { changeId, gate: "B2", approver: "Canary Human" });
  }
  const storyId = `${changeId}-story`;
  register(root, baseArtifact(changeId, sourceId, `${changeId}-epic`, "epics", { title: "Value" }));
  register(root, baseArtifact(changeId, sourceId, storyId, "stories", {
    title: "Return two", acceptance_criteria: ["value returns two"], size: "low", story_points: 1,
    estimate_confidence: "high", estimate_basis: ["Single function behavior change"],
  }));
  register(root, baseArtifact(changeId, sourceId, `${changeId}-dependencies`, "dependencies", { nodes: [{ story_id: storyId }], edges: [] }));
  register(root, baseArtifact(changeId, sourceId, `${changeId}-allocations`, "allocations", {
    clusters: [{ id: "value-change", story_ids: [storyId], total_points: 1, depends_on_clusters: [], shared_seams: ["src/app.py"], required_skills: ["Python"], rationale: "One small vertical change." }],
  }, [storyId, `${changeId}-dependencies`]));
  specs.approve(root, { changeId, gate: "G1", approver: "Canary Human" });
  register(root, baseArtifact(changeId, sourceId, `${changeId}-data`, "test-data", { fixtures: [] }));
  register(root, baseArtifact(changeId, sourceId, `${changeId}-case`, "test-cases", { expected: 2 }));
  register(root, baseArtifact(changeId, sourceId, `${changeId}-test-plan`, "test-plans", { levels: ["unit", "system"] }));
  specs.approve(root, { changeId, gate: "G2", approver: "Canary Human" });
  register(root, baseArtifact(changeId, sourceId, `${changeId}-design`, "design", { seam: "value" }));
  register(root, baseArtifact(changeId, sourceId, `${changeId}-architecture`, "architecture", {
    change: "none",
    structural_alternatives: [
      { id: "clone-vertical", summary: "Copy value() into a new module", duplication_risk: "high" },
      { id: "shared-modules", summary: "Edit the existing value helper in place", duplication_risk: "low" },
      { id: "parameterized-spine", summary: "Introduce a multi-stage pipeline for value", duplication_risk: "medium" },
    ],
    selected_alternative_id: "shared-modules",
    selection_rationale: "Single pure function change; shared helper edit is enough.",
    second_slice_reuse_policy: {
      when: "second-similar-capability",
      required_action: "reuse-existing-seams-or-design-amendment",
      generalize_min_uses: 2,
    },
    evolutionary_rules: ["Second similar helper reuses or opens a design amendment."],
  }));
  specs.approve(root, { changeId, gate: "G3", approver: "Canary Human" });
  const contract = {
    story_id: storyId, feature_surfaces: ["internal"], source_requirements: ["Value must become two"], approved_design_refs: [`${changeId}-design`], dependency_story_ids: [],
    allowed_change_scope: ["src", "tests"], acceptance_criteria: ["returns two"], test_case_ids: [`${changeId}-case`], test_data_ids: [`${changeId}-data`],
    required_sensors: ["unit"], performance_budgets: [], routing_risks: [], human_decisions: [],
    implementation_posture: brownfield ? "reuse-existing" : "first-slice",
    reuse_targets: brownfield ? [{ path: "src/app.py", symbol: "value" }] : [],
  };
  register(root, baseArtifact(changeId, sourceId, `${changeId}-contract`, "plans", contract, [storyId]));
  register(root, baseArtifact(changeId, sourceId, `${changeId}-traceability`, "traceability", { links: [{
    requirement_id: "Value must become two", source_location: "requirements.md", story_id: storyId,
    acceptance_criterion_id: "returns two", test_case_id: `${changeId}-case`, level: "unit",
    disposition: "planned-automated", verification_check_id: "unit", risk_tags: [],
  }] }, [`${changeId}-contract`, `${changeId}-case`]));
  specs.approve(root, { changeId, gate: "G4", approver: "Canary Human" });
  return { storyId, codeMap: brownfield ? JSON.parse(fs.readFileSync(path.join(root, ".claude", "specs", "brownfield", `${changeId}-code-map.json`))) : null };
}

function executeStory(root, changeId, storyId) {
  git(root, ["add", "."]); git(root, ["commit", "-qm", "approved design"]);
  ratchet.start(root, { changeId, storyId });
  ratchet.recordRed(root, storyId, writeJson(root, ".claude/specs/evidence/red.json", { command: "synthetic focused test", exit_code: 1, expected_failure: "expected two", observed_failure: "received one", test_paths: ["tests/test_app.py"] }));
  fs.writeFileSync(path.join(root, "src", "app.py"), "def value(): return 2\n");
  ratchet.recordImplementation(root, storyId, writeJson(root, ".claude/specs/evidence/implementation.json", { command: "synthetic focused test", exit_code: 0, changed_paths: ["src/app.py"], test_paths: ["tests/test_app.py"] }));
  ratchet.recordReview(root, storyId, writeJson(root, ".claude/specs/reviews/story.json", { verdict: "pass", blocking_findings: [], non_blocking_findings: [], missing_or_stale_evidence: [], required_human_decisions: [], reviewed_paths: ["src/app.py", "tests/test_app.py"], evidence_refs: [".claude/specs/evidence/implementation.json"] }));
  ratchet.recordSensors(root, storyId, writeJson(root, ".claude/specs/evidence/fast.json", {
    generated_at: new Date(Date.now() + 1000).toISOString(),
    status: "pass",
    blocking_status: "pass",
    workspace: workspaceFingerprint(root),
    sensors: [{ sensor_id: "unit", status: "pass" }],
  }));
  ratchet.verify(root, storyId);
  verificationPlan(root, "hermetic-system");
  const injectedFailure = verifyBranch(root, { changeId, cadence: "pre-pr" }).report;
  verificationPlan(root);
  const prePr = verifyBranch(root, { changeId, cadence: "pre-pr" });
  const branchReview = writeJson(root, ".claude/specs/reviews/branch.json", { verdict: "pass", blocking_findings: [], required_human_decisions: [], non_blocking_findings: [] });
  const readiness = finalizeBranch(root, { changeId, reportFile: path.relative(root, prePr.reportPath), reviewFile: branchReview });
  const routing = JSON.parse(fs.readFileSync(path.join(root, ".claude", "routing.json")));
  const routeDecision = route(routing, { task: "story-validation", risks: [] });
  const context = packContext(root, { tokenBudget: routing.context_budgets["evaluator-strong"], manifest: { items: [
    { path: "requirements.md", kind: "source-requirement", required: true, priority: 100 },
    { path: "src/app.py", kind: "code", required: true, priority: 80 },
    { path: "tests/test_app.py", kind: "test", required: true, priority: 80 },
  ] } });
  return { prePr: prePr.report, readiness: readiness.evidence, routeDecision, context, state: ratchet.loadState(root, storyId).state, sensorProbe: { injected_failure_detected: injectedFailure.status === "fail" && injectedFailure.checks.some((item) => item.kind === "hermetic-system" && item.status === "fail"), correction_passed: prePr.report.status === "pass" } };
}

function runCase(name, brownfield) {
  const started = Date.now(); const root = setup(name);
  try {
    const changeId = brownfield ? "BROWN-001" : "GREEN-001";
    const design = approveDesign(root, changeId, brownfield);
    const result = executeStory(root, changeId, design.storyId);
    const graph = design.codeMap?.content;
    return {
      name, type: brownfield ? "brownfield" : "greenfield", status: result.readiness.status === "ready-for-draft-pr" ? "pass" : "fail",
      elapsed_ms: Date.now() - started, story_state: result.state.state, pre_pr_status: result.prePr.status,
      context_estimated_tokens: result.context.estimated_tokens, context_budget_tokens: result.context.budget_tokens,
      route: result.routeDecision.role, repair_count: result.state.repair_attempts,
      sensor_probe: result.sensorProbe,
      graph: brownfield ? { source_files: graph.inventory.source_files, impact_candidates: graph.maps.impact.length, adapter: graph.adapter.provider } : null,
    };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

try {
  const started = Date.now();
  const scenarios = [runCase("greenfield", false), runCase("brownfield", true)];
  const report = {
    schema_version: 1, generated_at: new Date().toISOString(), measurement_type: "synthetic-deterministic-release-canary",
    status: scenarios.every((item) => item.status === "pass") ? "pass" : "fail", elapsed_ms: Date.now() - started, scenarios,
    controlled_measures: { first_pass_contract_acceptance: scenarios.filter((item) => item.status === "pass").length / scenarios.length, injected_sensor_detection_rate: scenarios.filter((item) => item.sensor_probe.injected_failure_detected).length / scenarios.length, sensor_correction_pass_rate: scenarios.filter((item) => item.sensor_probe.correction_passed).length / scenarios.length, repair_count: scenarios.reduce((sum, item) => sum + item.repair_count, 0), context_loaded_tokens: scenarios.reduce((sum, item) => sum + item.context_estimated_tokens, 0) },
    real_pilot_measures_required: ["human_review_minutes", "escaped_defects", "sensor_precision_and_correction", "modularity_review_precision_and_value", "provider_cost_per_accepted_story", "production_graph_retrieval_value"],
    limitations: ["Synthetic canaries prove deterministic control integration, not model quality, human review time, provider cost, or production defect escape."],
  };
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex >= 0) {
    const output = path.resolve(process.argv[outputIndex + 1]); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.status === "pass" ? 0 : 1);
} catch (error) {
  process.stderr.write(`ERROR: ${error.stack || error.message}\n`);
  process.exit(1);
}
