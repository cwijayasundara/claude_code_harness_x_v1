const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const specs = require("./specifications");
const ratchet = require("./story-ratchet");
const { buildCodeMap } = require("./brownfield-map");
const { assertStrategyPrefersReuse, proposeChangeStrategy } = require("./brownfield-strategy");
const { finalizeBranch, verifyBranch } = require("./branch-verification");
const { workspaceFingerprint } = require("./sensor-scope");
const {
  buildImplementationEvidence,
  buildRedEvidence,
  runFocusedCommand,
  writeEvidence,
} = require("./story-evidence");

const pluginRoot = path.resolve(__dirname, "..");

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  return relative;
}

function writeJson(root, relative, value) {
  return write(root, relative, `${JSON.stringify(value, null, 2)}\n`);
}

function register(root, artifact) {
  const input = writeJson(root, `.claude/work/${artifact.id}.json`, artifact);
  return specs.register(root, input);
}

function baseArtifact(changeId, sourceId, id, packageName, content, derivedFrom = [], locations = ["requirements/change.md"]) {
  return {
    id,
    package: packageName,
    change_id: changeId,
    source_ids: [sourceId],
    source_locations: locations,
    derived_from: derivedFrom,
    status: "draft",
    assumptions: [],
    open_questions: [],
    human_approver: null,
    approved_at: null,
    content,
  };
}

function registerSpdd(root, changeId, sourceId) {
  const analysisId = `${changeId}-analysis`;
  register(root, baseArtifact(changeId, sourceId, analysisId, "analysis", {
    domain_concepts: ["todo", "title normalization"],
    strategic_direction: ["Reuse the existing normalization seam."],
    risks: ["Avoid changing the protected helper contract."],
    requirement_gaps: ["No material gaps in the bounded canary."],
  }, [`${changeId}-prd`]));
  register(root, baseArtifact(changeId, sourceId, `${changeId}-reasons`, "reasons-canvas", {
    requirements: ["Reuse normalizeTitle and assign stable todo ids."],
    entities: ["Todo and normalized title."],
    approach: ["Map the existing seam before a narrow change."],
    structure: ["Retain current modules and dependency direction."],
    operations: ["Characterize, test red, reuse, and regress."],
    norms: ["Reuse before extraction or duplication."],
    safeguards: ["Preserve protected interfaces and baseline behavior."],
    sync: { status: "aligned", amendment_ids: [] },
  }, [analysisId]));
}

function traceLinks(contract) {
  return contract.source_requirements.flatMap((requirementId) => contract.acceptance_criteria.map((acceptanceCriterionId) => ({
    requirement_id: requirementId, source_location: "requirements/change.md", story_id: contract.story_id,
    acceptance_criterion_id: acceptanceCriterionId, test_case_id: contract.test_case_ids[0], level: "unit",
    disposition: "planned-automated", verification_check_id: "unit-suite", risk_tags: ["brownfield-regression"],
  })));
}

function proposalAndApprove(root, changeId, gate, approver) {
  const pack = specs.proposalPack(root, { changeId, gate, write: true });
  if (!pack.ready) throw new Error(`${gate} not ready: ${pack.blocking.join("; ")}`);
  return { pack, approval: specs.approve(root, { changeId, gate, approver }) };
}

function writeVerification(root) {
  const node = process.execPath;
  writeJson(root, ".claude/verification.json", {
    version: 1,
    checks: [
      {
        id: "install-build", label: "Load modules", cadence: "pre-pr", kind: "install-build", configured: true,
        command: node, args: ["-e", "require('./src/normalize.js'); require('./src/todo.js');"], timeout_ms: 10_000,
      },
      {
        id: "unit-suite", label: "Unit suite", cadence: "pre-pr", kind: "unit", configured: true, hermetic: true, boundary_ids: [],
        command: node, args: ["--test", "tests/normalize.test.js", "tests/todo.test.js"], timeout_ms: 30_000,
      },
      {
        id: "integration-suite", label: "Integration", cadence: "pre-pr", kind: "integration", configured: true, hermetic: true, boundary_ids: [],
        command: node, args: ["--test", "tests/todo.test.js"], timeout_ms: 30_000,
      },
      {
        id: "system-regression", label: "System", cadence: "pre-pr", kind: "hermetic-system", configured: true, hermetic: true, boundary_ids: [],
        command: node, args: ["--test", "tests/normalize.test.js", "tests/todo.test.js"], timeout_ms: 30_000,
      },
      {
        id: "local-smoke", label: "CLI smoke", cadence: "pre-pr", kind: "local-smoke", configured: true, hermetic: true, boundary_ids: [],
        public_seam: "node -e createTodo", safe_local_config: "in-process",
        journeys: [{ id: "ok", type: "success" }, { id: "empty", type: "failure" }],
        command: node,
        args: ["-e", "const {createTodo}=require('./src/todo'); const t=createTodo('x'); if(!t.id||t.done!==false) process.exit(1); try{createTodo('')}catch{process.exit(0)} process.exit(1)"],
        timeout_ms: 10_000,
      },
      {
        id: "lint", label: "Syntax", cadence: "pre-pr", kind: "lint", configured: true,
        command: node, args: ["--check", "src/todo.js"], timeout_ms: 10_000,
      },
      {
        id: "type", label: "Shape", cadence: "pre-pr", kind: "type", configured: true,
        command: node, args: ["-e", "const {createTodo}=require('./src/todo'); const t=createTodo('a'); if(typeof t.id!=='string') process.exit(1)"], timeout_ms: 10_000,
      },
      {
        id: "security", label: "No secrets", cadence: "pre-pr", kind: "security", configured: true,
        command: node, args: ["-e", "const fs=require('fs'); if(/AKIA[0-9A-Z]{16}/.test(fs.readFileSync('src/todo.js','utf8'))) process.exit(1)"], timeout_ms: 10_000,
      },
    ],
    boundaries: [],
    performance_budgets: [
      { id: "unit-duration", check_id: "unit-suite", metric: "duration_ms", maximum: 15_000, scope: "brownfield unit suite" },
    ],
  });
}

/**
 * Lived brownfield canary:
 * existing code + graph/adapter map → reuse strategy → TDD change that reuses normalizeTitle.
 */
function runBrownfieldCanary(options = {}) {
  const started = Date.now();
  const keep = Boolean(options.keep);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-brownfield-"));
  const changeId = "BF-001";
  const sourceId = `${changeId}-source`;
  const storyId = `${changeId}-story-1`;
  const approver = "Brownfield Canary";
  const report = {
    schema_version: 1,
    measurement_type: "lived-brownfield-reuse-canary",
    change_id: changeId,
    story_id: storyId,
  };

  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "canary@example.com"]);
    git(root, ["config", "user.name", "Brownfield Canary"]);

    // Existing codebase with a reusable helper already tested.
    write(root, "package.json", `${JSON.stringify({ name: "brownfield-fixture", private: true, type: "commonjs" }, null, 2)}\n`);
    write(root, "src/normalize.js", [
      "\"use strict\";",
      "function normalizeTitle(title) {",
      "  if (typeof title !== \"string\") throw new Error(\"title must be a string\");",
      "  const cleaned = title.trim();",
      "  if (!cleaned) throw new Error(\"title is required\");",
      "  return cleaned;",
      "}",
      "module.exports = { normalizeTitle };",
      "",
    ].join("\n"));
    write(root, "src/todo.js", [
      "\"use strict\";",
      "// Intentionally does NOT reuse normalizeTitle yet — brownfield change will fix that.",
      "function createTodo(title) {",
      "  if (typeof title !== \"string\" || title.trim() === \"\") throw new Error(\"title is required\");",
      "  return { id: \"legacy\", title: title.trim(), done: false };",
      "}",
      "module.exports = { createTodo };",
      "",
    ].join("\n"));
    write(root, "tests/normalize.test.js", [
      "\"use strict\";",
      "const test = require(\"node:test\");",
      "const assert = require(\"node:assert/strict\");",
      "const { normalizeTitle } = require(\"../src/normalize.js\");",
      "test(\"normalizeTitle trims and rejects empty\", () => {",
      "  assert.equal(normalizeTitle(\"  hi  \"), \"hi\");",
      "  assert.throws(() => normalizeTitle(\"   \"), /title/i);",
      "});",
      "",
    ].join("\n"));
    write(root, "tests/todo.test.js", [
      "\"use strict\";",
      "const test = require(\"node:test\");",
      "const assert = require(\"node:assert/strict\");",
      "const { createTodo } = require(\"../src/todo.js\");",
      "test(\"createTodo returns id title done\", () => {",
      "  const todo = createTodo(\"Buy milk\");",
      "  assert.equal(typeof todo.id, \"string\");",
      "  assert.ok(todo.id.length > 0);",
      "  assert.notEqual(todo.id, \"legacy\");",
      "  assert.equal(todo.title, \"Buy milk\");",
      "  assert.equal(todo.done, false);",
      "});",
      "test(\"createTodo reuses normalize semantics for padding\", () => {",
      "  const todo = createTodo(\"  padded  \");",
      "  assert.equal(todo.title, \"padded\");",
      "});",
      "",
    ].join("\n"));
    write(root, "README.md", "# Existing todo helper\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "existing brownfield codebase"]);
    git(root, ["switch", "-qc", "feature/reuse-normalize"]);

    execFileSync(process.execPath, [path.join(pluginRoot, "scripts", "harness-init.js"), root], { stdio: "ignore" });
    writeVerification(root);

    write(root, "requirements/change.md", [
      "# Change request",
      "",
      "createTodo must stop hardcoding id=legacy and must reuse the existing",
      "normalizeTitle helper instead of re-implementing trim/empty checks.",
      "",
    ].join("\n"));

    specs.intake(root, { changeId, source: "requirements/change.md", kind: "prd" });
    register(root, baseArtifact(changeId, sourceId, `${changeId}-prd`, "prd", {
      summary: "Reuse normalizeTitle inside createTodo and assign stable ids.",
    }));
    registerSpdd(root, changeId, sourceId);
    proposalAndApprove(root, changeId, "G0", approver);

    // B0 baseline with real commands
    const baselineUnit = runFocusedCommand(root, process.execPath, ["--test", "tests/normalize.test.js"]);
    if (baselineUnit.exit_code !== 0) throw new Error("Baseline normalize tests must pass.");
    const baselineTodo = runFocusedCommand(root, process.execPath, ["--test", "tests/todo.test.js"]);
    // todo tests intentionally fail (legacy id) — record as known failure
    register(root, baseArtifact(changeId, sourceId, `${changeId}-baseline`, "brownfield", {
      artifact_type: "baseline",
      commands: [
        { command: baselineUnit.command, exit_code: baselineUnit.exit_code, suite: "normalize" },
        { command: baselineTodo.command, exit_code: baselineTodo.exit_code, suite: "todo", known_failure: true },
      ],
      known_failures: [
        "tests/todo.test.js fails because createTodo still returns id=legacy and may not share normalizeTitle.",
      ],
      protected_interfaces: ["normalizeTitle public helper"],
      test_gaps: [],
    }, [], ["requirements/change.md", "src", "tests"]));
    const b0 = proposalAndApprove(root, changeId, "B0", approver);

    // Graphify-shaped adapter (bounded export — harness does not run Graphify).
    const adapterPath = writeJson(root, ".claude/specs/brownfield/adapter-export.json", {
      provider: "graphify",
      notes: "Synthetic Graphify-shaped export for the canary only.",
      nodes: [
        { id: "file:src/normalize.js", kind: "file", path: "src/normalize.js" },
        { id: "symbol:normalizeTitle", kind: "function", name: "normalizeTitle", path: "src/normalize.js" },
        { id: "file:src/todo.js", kind: "file", path: "src/todo.js" },
        { id: "symbol:createTodo", kind: "function", name: "createTodo", path: "src/todo.js" },
      ],
      edges: [
        {
          from: "file:src/normalize.js",
          to: "symbol:normalizeTitle",
          type: "declares",
          provenance: { method: "graphify-ast", confidence: "extracted" },
        },
        {
          from: "file:src/todo.js",
          to: "symbol:createTodo",
          type: "declares",
          provenance: { method: "graphify-ast", confidence: "extracted" },
        },
        {
          from: "symbol:createTodo",
          to: "symbol:normalizeTitle",
          type: "should-call",
          provenance: { method: "human-goal", confidence: "projected" },
        },
      ],
    });

    const codeMap = buildCodeMap(root, ["src", "tests"], adapterPath, ["createTodo", "normalizeTitle", "todo"]);
    if (codeMap.adapter.provider !== "graphify") throw new Error("Adapter provider not recorded.");
    if (!codeMap.maps.canonical_reuse_candidates.length && !codeMap.graph.nodes.some((n) => n.name === "normalizeTitle")) {
      throw new Error("Expected normalizeTitle in map.");
    }

    register(root, baseArtifact(changeId, sourceId, `${changeId}-code-map`, "brownfield", {
      artifact_type: "code-map",
      ...codeMap,
    }, [], ["src", "tests"]));
    const b1 = proposalAndApprove(root, changeId, "B1", approver);

    const strategy = proposeChangeStrategy({
      goal: "Reuse normalizeTitle in createTodo; stop returning id=legacy.",
      focus: ["createTodo", "normalizeTitle"],
      codeMap,
      preferredReuse: [{
        path: "src/normalize.js",
        symbol: "normalizeTitle",
        reason: "Existing tested helper already implements trim/empty validation.",
      }],
      characterizationTests: [
        { path: "tests/normalize.test.js", purpose: "Keep normalizeTitle behaviour pinned." },
        { path: "tests/todo.test.js", purpose: "Drive createTodo behaviour after reuse." },
      ],
    });
    const strategyErrors = assertStrategyPrefersReuse(strategy, ["src/normalize.js"]);
    if (strategyErrors.length) throw new Error(strategyErrors.join("\n"));

    register(root, baseArtifact(changeId, sourceId, `${changeId}-strategy`, "brownfield", strategy, [`${changeId}-code-map`]));
    register(root, baseArtifact(changeId, sourceId, `${changeId}-amendment`, "amendments", {
      artifact_type: "design-amendment",
      decision: "No layering change; wire createTodo to existing normalizeTitle helper.",
      proposed_delta: "createTodo calls normalizeTitle; no new abstraction.",
      alternatives: ["clone validation in createTodo", "reuse normalizeTitle"],
      reuse: ["src/normalize.js#normalizeTitle"],
    }, [`${changeId}-strategy`]));
    const b2 = proposalAndApprove(root, changeId, "B2", approver);

    // G1–G4 story for the brownfield fix
    register(root, baseArtifact(changeId, sourceId, `${changeId}-epic`, "epics", { title: "Reuse normalize in todos" }));
    register(root, baseArtifact(changeId, sourceId, storyId, "stories", {
      title: "createTodo reuses normalizeTitle",
      size: "low", story_points: 3, estimate_confidence: "high",
      estimate_basis: ["One existing seam, characterization coverage, and regression tests."],
      acceptance_criteria: [
        "createTodo uses normalizeTitle for title cleaning",
        "createTodo returns a non-legacy id",
      ],
    }, [`${changeId}-epic`]));
    register(root, baseArtifact(changeId, sourceId, `${changeId}-deps`, "dependencies", {
      nodes: [{ story_id: storyId }], edges: [],
    }, [storyId]));
    register(root, baseArtifact(changeId, sourceId, `${changeId}-allocations`, "allocations", {
      clusters: [{ id: "normalize-reuse", story_ids: [storyId], total_points: 3, depends_on_clusters: [], shared_seams: ["src/normalize.js", "src/todo.js"], required_skills: ["JavaScript"], rationale: "One bounded brownfield reuse slice." }],
    }, [storyId, `${changeId}-deps`]));
    proposalAndApprove(root, changeId, "G1", approver);

    register(root, baseArtifact(changeId, sourceId, `${changeId}-data`, "test-data", { fixtures: ["Buy milk", "  padded  "] }, [storyId]));
    register(root, baseArtifact(changeId, sourceId, `${changeId}-case`, "test-cases", {
      cases: ["non-legacy id", "padded title", "empty throws"],
    }, [storyId]));
    register(root, baseArtifact(changeId, sourceId, `${changeId}-test-plan`, "test-plans", {
      levels: ["unit"],
      hermetic: true,
    }, [`${changeId}-case`]));
    proposalAndApprove(root, changeId, "G2", approver);

    register(root, baseArtifact(changeId, sourceId, `${changeId}-design`, "design", {
      seam: "createTodo calls normalizeTitle",
      folder_structure: ["src/todo.js", "src/normalize.js"],
    }, [storyId, `${changeId}-strategy`]));
    register(root, baseArtifact(changeId, sourceId, `${changeId}-architecture`, "architecture", {
      change: "none — reuse helper",
      structural_alternatives: [
        {
          id: "clone-vertical",
          summary: "Reimplement title cleaning inside createTodo.",
          duplication_risk: "high",
        },
        {
          id: "shared-modules",
          summary: "Wire createTodo to existing normalizeTitle helper.",
          duplication_risk: "low",
        },
        {
          id: "parameterized-spine",
          summary: "Introduce a multi-stage entity pipeline for todos.",
          duplication_risk: "medium",
        },
      ],
      selected_alternative_id: "shared-modules",
      selection_rationale: "Canonical helper already exists; reuse it rather than cloning or inventing a spine.",
      second_slice_reuse_policy: {
        when: "second-similar-capability",
        required_action: "reuse-existing-seams-or-design-amendment",
        generalize_min_uses: 2,
      },
      evolutionary_rules: [
        "Prefer normalizeTitle for any new title-taking factory.",
      ],
    }, [`${changeId}-design`]));
    proposalAndApprove(root, changeId, "G3", approver);

    const contract = {
      story_id: storyId,
      feature_surfaces: ["internal"],
      source_requirements: ["reuse normalizeTitle", "non-legacy id"],
      approved_design_refs: [`${changeId}-design`, `${changeId}-architecture`, `${changeId}-amendment`],
      dependency_story_ids: [],
      allowed_change_scope: ["src", "tests"],
      acceptance_criteria: [
        "createTodo uses normalizeTitle",
        "createTodo returns non-legacy id",
      ],
      test_case_ids: [`${changeId}-case`],
      test_data_ids: [`${changeId}-data`],
      required_sensors: ["unit"],
      performance_budgets: [],
      routing_risks: [],
      human_decisions: [],
      implementation_posture: "reuse-existing",
      reuse_targets: [{ path: "src/normalize.js", symbol: "normalizeTitle" }],
    };
    register(root, baseArtifact(changeId, sourceId, `${changeId}-contract`, "plans", contract, [storyId, `${changeId}-design`]));
    register(root, baseArtifact(changeId, sourceId, `${changeId}-traceability`, "traceability", { links: traceLinks(contract) }, [`${changeId}-contract`, `${changeId}-case`]));
    proposalAndApprove(root, changeId, "G4", approver);

    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "approved brownfield co-design"]);

    // RED: existing failing todo tests
    const redRun = runFocusedCommand(root, process.execPath, ["--test", "tests/todo.test.js"]);
    if (redRun.exit_code === 0) throw new Error("Expected red todo tests before implementation.");
    const redPath = writeEvidence(root, ".claude/specs/evidence/bf-red.json", buildRedEvidence(redRun, {
      expected_failure: "createTodo must not use id=legacy and must reuse normalizeTitle",
      observed_failure: (redRun.stderr || redRun.stdout || "").slice(0, 500),
      test_paths: ["tests/todo.test.js"],
    }));
    ratchet.start(root, { changeId, storyId });
    ratchet.recordRed(root, storyId, redPath);

    // IMPLEMENT: reuse normalizeTitle
    write(root, "src/todo.js", [
      "\"use strict\";",
      "const { normalizeTitle } = require(\"./normalize.js\");",
      "function createTodo(title) {",
      "  const cleaned = normalizeTitle(title);",
      "  return { id: `todo-${Buffer.from(cleaned).toString(\"hex\").slice(0, 8)}`, title: cleaned, done: false };",
      "}",
      "module.exports = { createTodo };",
      "",
    ].join("\n"));

    // Guard: implementation must import normalize
    if (!fs.readFileSync(path.join(root, "src/todo.js"), "utf8").includes("normalizeTitle")) {
      throw new Error("Implementation did not reuse normalizeTitle.");
    }

    const greenRun = runFocusedCommand(root, process.execPath, ["--test", "tests/normalize.test.js", "tests/todo.test.js"]);
    if (greenRun.exit_code !== 0) {
      throw new Error(`Expected green after reuse implementation.\n${greenRun.stdout}\n${greenRun.stderr}`);
    }
    const implementPath = writeEvidence(root, ".claude/specs/evidence/bf-implement.json", buildImplementationEvidence(greenRun, {
      changed_paths: ["src/todo.js"],
      test_paths: ["tests/todo.test.js", "tests/normalize.test.js"],
      notes: ["Reused normalizeTitle; did not duplicate trim/empty logic."],
    }));
    ratchet.recordImplementation(root, storyId, implementPath);

    const reviewPath = writeJson(root, ".claude/specs/reviews/bf-story.json", {
      verdict: "pass",
      blocking_findings: [],
      non_blocking_findings: [],
      missing_or_stale_evidence: [],
      required_human_decisions: [],
      reviewed_paths: ["src/todo.js", "src/normalize.js"],
      evidence_refs: [redPath, implementPath, `.claude/specs/brownfield/${changeId}-strategy.json`],
    });
    const reviewAbs = path.join(root, reviewPath);
    const future = new Date(Date.now() + 1500);
    fs.utimesSync(reviewAbs, future, future);
    ratchet.recordReview(root, storyId, reviewPath);

    const sensorPath = writeJson(root, ".claude/specs/evidence/bf-sensors.json", {
      generated_at: new Date(Date.now() + 2000).toISOString(),
      status: "pass",
      blocking_status: "pass",
      workspace: workspaceFingerprint(root),
      sensors: [{ sensor_id: "unit", status: "pass", command: greenRun.command, exit_code: 0 }],
    });
    ratchet.recordSensors(root, storyId, sensorPath);
    const verified = ratchet.verify(root, storyId);

    const prePr = verifyBranch(root, { changeId, cadence: "pre-pr" });
    if (prePr.report.status !== "pass") {
      throw new Error(`pre-pr failed: ${JSON.stringify(prePr.report.agent_summary)}`);
    }
    const branchReview = writeJson(root, ".claude/specs/reviews/bf-branch.json", {
      verdict: "pass",
      blocking_findings: [],
      non_blocking_findings: [],
      required_human_decisions: [],
      reviewed_paths: ["src/todo.js"],
      evidence_refs: [path.relative(root, prePr.reportPath)],
    });
    fs.utimesSync(path.join(root, branchReview), new Date(Date.parse(prePr.report.generated_at) + 1500), new Date(Date.parse(prePr.report.generated_at) + 1500));
    const readiness = finalizeBranch(root, {
      changeId,
      reportFile: path.relative(root, prePr.reportPath),
      reviewFile: branchReview,
    });

    const validationErrors = specs.validate(root, changeId);
    if (validationErrors.length) throw new Error(validationErrors.join("\n"));

    report.status =
      verified.state === "STORY_VERIFIED" && readiness.evidence.status === "ready-for-draft-pr"
        ? "pass"
        : "fail";
    report.elapsed_ms = Date.now() - started;
    report.story_state = verified.state;
    report.branch = "feature/reuse-normalize";
    report.gates = ["G0", "B0", "B1", "B2", "G1", "G2", "G3", "G4"];
    report.adapter_provider = codeMap.adapter.provider;
    report.reuse_targets = strategy.reuse.map((item) => item.symbol || item.path);
    report.duplication_risks = strategy.duplication_risks.length;
    report.red_exit_code = redRun.exit_code;
    report.green_exit_code = greenRun.exit_code;
    report.pre_pr_status = prePr.report.status;
    report.readiness_status = readiness.evidence.status;
    report.proposal_paths = [b0.pack.written_path, b1.pack.written_path, b2.pack.written_path];
    report.implementation_reused_normalize = true;
    report.evidence = {
      code_map: `.claude/specs/brownfield/${changeId}-code-map.json`,
      strategy: `.claude/specs/brownfield/${changeId}-strategy.json`,
      adapter: adapterPath,
      red: redPath,
      implementation: implementPath,
      pre_pr: path.relative(root, prePr.reportPath),
      readiness: path.relative(root, readiness.output),
    };
    if (keep) report.root = root;
    return report;
  } catch (error) {
    report.status = "fail";
    report.elapsed_ms = Date.now() - started;
    report.error = error.message;
    report.root = root;
    throw Object.assign(error, { report, root });
  } finally {
    if (!keep && report.status === "pass") fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = { runBrownfieldCanary };
