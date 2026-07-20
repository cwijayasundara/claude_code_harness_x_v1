const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const specs = require("./specifications");
const ratchet = require("./story-ratchet");
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

function baseArtifact(changeId, sourceId, id, packageName, content, derivedFrom = [], extras = {}) {
  return {
    id,
    package: packageName,
    change_id: changeId,
    source_ids: [sourceId],
    source_locations: ["requirements/prd.md"],
    derived_from: derivedFrom,
    status: "draft",
    assumptions: extras.assumptions || [],
    open_questions: extras.open_questions || [],
    human_approver: null,
    approved_at: null,
    content,
  };
}

function registerSpdd(root, changeId, sourceId) {
  const analysisId = `${changeId}-analysis`;
  register(root, baseArtifact(changeId, sourceId, analysisId, "analysis", {
    domain_concepts: ["todo"],
    strategic_direction: ["Deliver the smallest source-grounded vertical slice."],
    risks: ["Preserve validation and public behavior."],
    requirement_gaps: ["No material gaps in the canary fixture."],
  }, [`${changeId}-prd`]));
  register(root, baseArtifact(changeId, sourceId, `${changeId}-reasons`, "reasons-canvas", {
    requirements: ["Implement the captured PRD outcomes and definition of done."],
    entities: ["Todo with title, id, and completion state."],
    approach: ["Use focused TDD at the public module seam."],
    structure: ["Keep behavior in the existing todo module."],
    operations: ["Write a failing test, implement, verify, and review."],
    norms: ["Small functions and deterministic tests."],
    safeguards: ["No external services or unrelated scope."],
    sync: { status: "aligned", amendment_ids: [] },
  }, [analysisId]));
}

function traceLinks(contract, sourceLocation, checkId = "unit-suite") {
  return contract.source_requirements.flatMap((requirementId) => contract.acceptance_criteria.map((acceptanceCriterionId) => ({
    requirement_id: requirementId,
    source_location: sourceLocation,
    story_id: contract.story_id,
    acceptance_criterion_id: acceptanceCriterionId,
    test_case_id: contract.test_case_ids[0],
    level: "unit",
    disposition: "planned-automated",
    verification_check_id: checkId,
    risk_tags: [],
  })));
}

function proposalAndApprove(root, changeId, gate, approver) {
  const pack = specs.proposalPack(root, { changeId, gate, write: true });
  if (!pack.ready) {
    throw new Error(`${gate} proposal is not ready: ${pack.blocking.join("; ") || "unknown"}`);
  }
  const approval = specs.approve(root, { changeId, gate, approver });
  return { pack, approval };
}

function writeLivedVerificationPlan(root) {
  // Fully configured real commands — no invented exit codes.
  const node = process.execPath;
  const plan = {
    version: 1,
    checks: [
      {
        id: "install-build",
        label: "Load package and module",
        cadence: "pre-pr",
        kind: "install-build",
        configured: true,
        command: node,
        args: ["-e", "require('./package.json'); require('./src/todo.js');"],
        timeout_ms: 10_000,
        affected_paths: ["src/todo.js", "package.json"],
      },
      {
        id: "unit-suite",
        label: "Unit suite",
        cadence: "pre-pr",
        kind: "unit",
        configured: true,
        hermetic: true,
        boundary_ids: [],
        command: node,
        args: ["--test", "tests/todo.test.js"],
        timeout_ms: 30_000,
        affected_paths: ["src/todo.js", "tests/todo.test.js"],
      },
      {
        id: "unit-story-fast",
        label: "Focused unit (story-fast)",
        cadence: "story-fast",
        kind: "unit",
        configured: true,
        hermetic: true,
        boundary_ids: [],
        command: node,
        args: ["--test", "tests/todo.test.js"],
        timeout_ms: 30_000,
        affected_paths: ["src/todo.js", "tests/todo.test.js"],
      },
      {
        id: "integration-suite",
        label: "Integration suite (pure module seams)",
        cadence: "pre-pr",
        kind: "integration",
        configured: true,
        hermetic: true,
        boundary_ids: [],
        command: node,
        args: ["--test", "tests/todo.integration.test.js"],
        timeout_ms: 30_000,
        affected_paths: ["src/todo.js", "tests/todo.integration.test.js"],
      },
      {
        id: "system-regression",
        label: "Hermetic system regression script",
        cadence: "pre-pr",
        kind: "hermetic-system",
        configured: true,
        hermetic: true,
        boundary_ids: [],
        command: node,
        args: ["scripts/system-regression.js"],
        timeout_ms: 30_000,
        affected_paths: ["src/todo.js", "scripts/system-regression.js"],
      },
      {
        id: "local-smoke",
        label: "Public-seam smoke (CLI)",
        cadence: "pre-pr",
        kind: "local-smoke",
        configured: true,
        hermetic: true,
        boundary_ids: [],
        public_seam: "CLI scripts/smoke.js",
        safe_local_config: "no network; pure in-process createTodo",
        journeys: [
          { id: "create-success", type: "success" },
          { id: "create-empty-failure", type: "failure" },
        ],
        command: node,
        args: ["scripts/smoke.js"],
        timeout_ms: 15_000,
        affected_paths: ["src/todo.js", "scripts/smoke.js"],
      },
      {
        id: "lint",
        label: "Syntax check",
        cadence: "pre-pr",
        kind: "lint",
        configured: true,
        command: node,
        args: ["--check", "src/todo.js"],
        timeout_ms: 10_000,
        affected_paths: ["src/todo.js"],
      },
      {
        id: "type",
        label: "Load-time type/shape check",
        cadence: "pre-pr",
        kind: "type",
        configured: true,
        command: node,
        args: ["scripts/typecheck.js"],
        timeout_ms: 10_000,
        affected_paths: ["src/todo.js"],
      },
      {
        id: "security",
        label: "Secret pattern scan on product sources",
        cadence: "pre-pr",
        kind: "security",
        configured: true,
        command: node,
        args: ["scripts/secret-scan.js"],
        timeout_ms: 10_000,
        affected_paths: ["src/todo.js"],
      },
    ],
    boundaries: [],
    performance_budgets: [
      {
        id: "smoke-duration",
        check_id: "local-smoke",
        metric: "duration_ms",
        maximum: 5000,
        scope: "CLI smoke success+failure journeys",
      },
      {
        id: "unit-duration",
        check_id: "unit-suite",
        metric: "duration_ms",
        maximum: 10_000,
        scope: "unit suite",
      },
    ],
  };
  writeJson(root, ".claude/verification.json", plan);
  return plan;
}

function writeLivedSupportScripts(root) {
  write(root, "scripts/smoke.js", [
    "\"use strict\";",
    "const { createTodo } = require(\"../src/todo.js\");",
    "let failed = false;",
    "try {",
    "  const todo = createTodo(\"smoke-ok\");",
    "  if (!todo.id || todo.done !== false || todo.title !== \"smoke-ok\") failed = true;",
    "} catch { failed = true; }",
    "let failureOk = false;",
    "try { createTodo(\"\"); } catch { failureOk = true; }",
    "if (!failureOk) failed = true;",
    "process.exit(failed ? 1 : 0);",
    "",
  ].join("\n"));

  write(root, "scripts/system-regression.js", [
    "\"use strict\";",
    "const { spawnSync } = require(\"node:child_process\");",
    "const path = require(\"node:path\");",
    "const root = path.resolve(__dirname, \"..\");",
    "const env = { ...process.env };",
    "delete env.NODE_TEST_CONTEXT;",
    "delete env.NODE_CHANNEL_FD;",
    "const unit = spawnSync(process.execPath, [\"--test\", \"tests/todo.test.js\", \"tests/todo.integration.test.js\"], { cwd: root, encoding: \"utf8\", env });",
    "if (unit.status !== 0) { process.stderr.write(unit.stdout + unit.stderr); process.exit(unit.status ?? 1); }",
    "const smoke = spawnSync(process.execPath, [\"scripts/smoke.js\"], { cwd: root, encoding: \"utf8\", env });",
    "if (smoke.status !== 0) { process.stderr.write(smoke.stdout + smoke.stderr); process.exit(smoke.status ?? 1); }",
    "process.exit(0);",
    "",
  ].join("\n"));

  write(root, "scripts/typecheck.js", [
    "\"use strict\";",
    "const { createTodo } = require(\"../src/todo.js\");",
    "const todo = createTodo(\"typed\");",
    "if (typeof todo.id !== \"string\" || typeof todo.title !== \"string\" || typeof todo.done !== \"boolean\") {",
    "  process.stderr.write(\"createTodo shape invalid\\n\");",
    "  process.exit(1);",
    "}",
    "process.exit(0);",
    "",
  ].join("\n"));

  write(root, "scripts/secret-scan.js", [
    "\"use strict\";",
    "const fs = require(\"node:fs\");",
    "const path = require(\"node:path\");",
    "const root = path.resolve(__dirname, \"..\");",
    "const patterns = [/AKIA[0-9A-Z]{16}/, /-----BEGIN (RSA |OPENSSH )?PRIVATE KEY-----/, /api[_-]?key\\s*[:=]\\s*['\\\"][A-Za-z0-9_\\-]{16,}/i];",
    "function scan(file) {",
    "  const text = fs.readFileSync(file, \"utf8\");",
    "  for (const pattern of patterns) if (pattern.test(text)) {",
    "    process.stderr.write(`Possible secret in ${path.relative(root, file)}\\n`);",
    "    process.exit(1);",
    "  }",
    "}",
    "scan(path.join(root, \"src/todo.js\"));",
    "scan(path.join(root, \"scripts/smoke.js\"));",
    "process.exit(0);",
    "",
  ].join("\n"));

  write(root, "tests/todo.integration.test.js", [
    "\"use strict\";",
    "const test = require(\"node:test\");",
    "const assert = require(\"node:assert/strict\");",
    "const { createTodo } = require(\"../src/todo.js\");",
    "",
    "test(\"createTodo ids differ for different titles\", () => {",
    "  const a = createTodo(\"alpha\");",
    "  const b = createTodo(\"beta\");",
    "  assert.notEqual(a.id, b.id);",
    "  assert.equal(a.done, false);",
    "  assert.equal(b.done, false);",
    "});",
    "",
  ].join("\n"));
}

/**
 * Deterministic lived greenfield canary:
 * co-design G0–G4 with proposal packs, then TDD ratchet with real Node tests.
 */
function runLivedCanary(options = {}) {
  const started = Date.now();
  const keep = Boolean(options.keep);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-lived-"));
  const changeId = "LIVED-001";
  const sourceId = `${changeId}-source`;
  const storyId = `${changeId}-story-1`;
  const approver = "Lived Canary";
  const report = {
    schema_version: 1,
    measurement_type: "lived-tdd-story-canary",
    change_id: changeId,
    story_id: storyId,
    root: keep ? root : undefined,
  };

  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "canary@example.com"]);
    git(root, ["config", "user.name", "Lived Canary"]);
    write(root, "README.md", "# Lived canary fixture\n");
    git(root, ["add", "README.md"]);
    git(root, ["commit", "-qm", "seed"]);
    git(root, ["switch", "-qc", "feature/lived-todo"]);

    execFileSync(process.execPath, [path.join(pluginRoot, "scripts", "harness-init.js"), root], {
      stdio: "ignore",
    });

    // Minimal product surface: intentionally incomplete until after RED.
    write(root, "src/todo.js", [
      "\"use strict\";",
      "// Intentionally incomplete before RED is recorded.",
      "function createTodo(title) {",
      "  return { title };",
      "}",
      "module.exports = { createTodo };",
      "",
    ].join("\n"));
    write(root, "package.json", `${JSON.stringify({ name: "lived-canary-fixture", private: true, type: "commonjs" }, null, 2)}\n`);
    writeLivedSupportScripts(root);
    writeLivedVerificationPlan(root);

    write(root, "requirements/prd.md", [
      "# PRD: Create Todo",
      "",
      "## Outcome",
      "A createTodo(title) helper returns a todo with id, title, and done=false.",
      "",
      "## Acceptance",
      "- Empty title is rejected.",
      "- Successful create returns id, title, done=false.",
      "",
      "## NFR",
      "- Unit tests run under Node without external services.",
      "",
    ].join("\n"));

    specs.intake(root, { changeId, source: "requirements/prd.md", kind: "prd" });

    // --- G0 ---
    register(root, baseArtifact(changeId, sourceId, `${changeId}-prd`, "prd", {
      summary: "createTodo returns a complete todo object",
      outcomes: ["createTodo builds id/title/done"],
      in_scope: ["createTodo helper", "unit tests"],
      out_of_scope: ["HTTP server", "persistence"],
    }, [], {
      assumptions: ["Ids may be opaque strings for the unit seam."],
      open_questions: [],
    }));
    registerSpdd(root, changeId, sourceId);
    const g0 = proposalAndApprove(root, changeId, "G0", approver);

    // --- G1 ---
    register(root, baseArtifact(changeId, sourceId, `${changeId}-epic`, "epics", {
      title: "Todo creation",
      goal: "Support creating a todo object",
    }));
    register(root, baseArtifact(changeId, sourceId, storyId, "stories", {
      title: "Create a todo with defaults",
      size: "low", story_points: 2, estimate_confidence: "high",
      estimate_basis: ["One module seam and two focused acceptance cases."],
      acceptance_criteria: [
        "createTodo(title) returns { id, title, done: false }",
        "createTodo(\"\") throws",
      ],
    }, [`${changeId}-epic`]));
    register(root, baseArtifact(changeId, sourceId, `${changeId}-deps`, "dependencies", {
      nodes: [{ story_id: storyId }], edges: [],
    }, [storyId]));
    register(root, baseArtifact(changeId, sourceId, `${changeId}-allocations`, "allocations", {
      clusters: [{ id: "todo-create", story_ids: [storyId], total_points: 2, depends_on_clusters: [], shared_seams: ["src/todo.js"], required_skills: ["JavaScript"], rationale: "One cohesive vertical slice." }],
    }, [storyId, `${changeId}-deps`]));
    const g1 = proposalAndApprove(root, changeId, "G1", approver);

    // --- G2 ---
    register(root, baseArtifact(changeId, sourceId, `${changeId}-data`, "test-data", {
      fixtures: [{ title: "Buy milk" }, { title: "" }],
    }, [storyId]));
    register(root, baseArtifact(changeId, sourceId, `${changeId}-case`, "test-cases", {
      cases: [
        { id: "happy", input: "Buy milk", expect: { done: false } },
        { id: "empty", input: "", expect: "throws" },
      ],
    }, [storyId]));
    register(root, baseArtifact(changeId, sourceId, `${changeId}-test-plan`, "test-plans", {
      levels: ["unit"],
      hermetic: true,
      doubles: "none required for pure function",
    }, [`${changeId}-case`, `${changeId}-data`]));
    const g2 = proposalAndApprove(root, changeId, "G2", approver);

    // --- G3 ---
    register(root, baseArtifact(changeId, sourceId, `${changeId}-design`, "design", {
      folder_structure: ["src/todo.js", "tests/todo.test.js"],
      seam: "createTodo pure function",
    }, [storyId]));
    register(root, baseArtifact(changeId, sourceId, `${changeId}-architecture`, "architecture", {
      style: "single-module helper",
      boundaries: ["no IO"],
      performance_budgets: [{ id: "unit-suite", metric: "duration_ms", maximum: 5000 }],
      structural_alternatives: [
        {
          id: "clone-vertical",
          summary: "Separate modules per future todo operation with copied validation.",
          duplication_risk: "high",
        },
        {
          id: "shared-modules",
          summary: "Small pure helpers (createTodo) shared by call sites; no orchestration spine.",
          duplication_risk: "low",
        },
        {
          id: "parameterized-spine",
          summary: "A staged pipeline for todo CRUD; overkill for one pure factory.",
          duplication_risk: "medium",
        },
      ],
      selected_alternative_id: "shared-modules",
      selection_rationale: "Single pure function with no multi-entity skeleton; shared helper is enough.",
      second_slice_reuse_policy: {
        when: "second-similar-capability",
        required_action: "reuse-existing-seams-or-design-amendment",
        generalize_min_uses: 2,
      },
      evolutionary_rules: [
        "Second similar factory reuses validation helpers or opens a design amendment.",
        "Do not clone createTodo per UI surface.",
      ],
    }, [`${changeId}-design`]));
    const g3 = proposalAndApprove(root, changeId, "G3", approver);

    // --- G4 ---
    const contract = {
      story_id: storyId,
      feature_surfaces: ["internal"],
      source_requirements: ["createTodo returns id, title, done=false", "empty title rejected"],
      approved_design_refs: [`${changeId}-design`, `${changeId}-architecture`],
      dependency_story_ids: [],
      allowed_change_scope: ["src", "tests"],
      acceptance_criteria: [
        "createTodo(title) returns { id, title, done: false }",
        "createTodo(\"\") throws",
      ],
      test_case_ids: [`${changeId}-case`],
      test_data_ids: [`${changeId}-data`],
      required_sensors: ["unit"],
      performance_budgets: [{ id: "unit-suite", metric: "duration_ms", maximum: 5000 }],
      routing_risks: [],
      human_decisions: [],
      implementation_posture: "first-slice",
      reuse_targets: [],
    };
    register(root, baseArtifact(changeId, sourceId, `${changeId}-contract`, "plans", contract, [storyId, `${changeId}-design`, `${changeId}-case`]));
    register(root, baseArtifact(changeId, sourceId, `${changeId}-traceability`, "traceability", {
      links: traceLinks(contract, "requirements/prd.md#acceptance"),
    }, [`${changeId}-contract`, `${changeId}-case`]));
    const g4 = proposalAndApprove(root, changeId, "G4", approver);

    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "approved co-design through G4"]);

    // Failing tests first (TDD red).
    write(root, "tests/todo.test.js", [
      "\"use strict\";",
      "const test = require(\"node:test\");",
      "const assert = require(\"node:assert/strict\");",
      "const { createTodo } = require(\"../src/todo.js\");",
      "",
      "test(\"createTodo returns id, title, and done=false\", () => {",
      "  const todo = createTodo(\"Buy milk\");",
      "  assert.equal(typeof todo.id, \"string\");",
      "  assert.ok(todo.id.length > 0);",
      "  assert.equal(todo.title, \"Buy milk\");",
      "  assert.equal(todo.done, false);",
      "});",
      "",
      "test(\"createTodo rejects empty title\", () => {",
      "  assert.throws(() => createTodo(\"\"), /title/i);",
      "});",
      "",
    ].join("\n"));

    const redRun = runFocusedCommand(root, process.execPath, ["--test", "tests/todo.test.js"]);
    if (redRun.exit_code === 0) throw new Error("Expected red tests to fail before implementation.");
    const redPath = writeEvidence(root, ".claude/specs/evidence/lived-red.json", buildRedEvidence(redRun, {
      expected_failure: "createTodo must supply id and done=false and reject empty titles",
      observed_failure: (redRun.stderr || redRun.stdout || "test failed").slice(0, 500),
      test_paths: ["tests/todo.test.js"],
      notes: ["Lived canary executed node --test before implementation."],
    }));

    ratchet.start(root, { changeId, storyId });
    ratchet.recordRed(root, storyId, redPath);

    // Smallest passing implementation.
    write(root, "src/todo.js", [
      "\"use strict\";",
      "function createTodo(title) {",
      "  if (typeof title !== \"string\" || title.trim() === \"\") {",
      "    throw new Error(\"title is required\");",
      "  }",
      "  return { id: `todo-${Buffer.from(title).toString(\"hex\").slice(0, 8)}`, title, done: false };",
      "}",
      "module.exports = { createTodo };",
      "",
    ].join("\n"));

    const greenRun = runFocusedCommand(root, process.execPath, ["--test", "tests/todo.test.js"]);
    if (greenRun.exit_code !== 0) {
      throw new Error(`Expected green tests after implementation.\n${greenRun.stdout}\n${greenRun.stderr}`);
    }
    const implementPath = writeEvidence(root, ".claude/specs/evidence/lived-implement.json", buildImplementationEvidence(greenRun, {
      changed_paths: ["src/todo.js", "tests/todo.test.js"],
      test_paths: ["tests/todo.test.js"],
      notes: ["Lived canary executed node --test after implementation."],
    }));
    ratchet.recordImplementation(root, storyId, implementPath);

    const reviewPath = writeJson(root, ".claude/specs/reviews/lived-story.json", {
      verdict: "pass",
      blocking_findings: [],
      non_blocking_findings: [],
      missing_or_stale_evidence: [],
      required_human_decisions: [],
      reviewed_paths: ["src/todo.js", "tests/todo.test.js"],
      evidence_refs: [redPath, implementPath],
    });
    // Ensure review file mtime is after implementation state (assertFresh).
    const reviewAbsolute = path.join(root, reviewPath);
    const future = new Date(Date.now() + 1500);
    fs.utimesSync(reviewAbsolute, future, future);
    ratchet.recordReview(root, storyId, reviewPath);

    const sensorPath = writeJson(root, ".claude/specs/evidence/lived-sensors.json", {
      generated_at: new Date(Date.now() + 2000).toISOString(),
      status: "pass",
      blocking_status: "pass",
      workspace: workspaceFingerprint(root),
      sensors: [{
        sensor_id: "unit",
        status: "pass",
        command: greenRun.command,
        exit_code: greenRun.exit_code,
        evidence: implementPath,
      }],
    });
    ratchet.recordSensors(root, storyId, sensorPath);
    const verified = ratchet.verify(root, storyId);

    // Story-fast then full pre-PR local engineer simulation (real commands).
    const storyFast = verifyBranch(root, { changeId, cadence: "story-fast" });
    if (storyFast.report.status !== "pass") {
      throw new Error(`story-fast verification failed: ${JSON.stringify(storyFast.report.agent_summary)}`);
    }

    // Fail-closed probe: temporarily unconfigure a required check, expect throw.
    const verificationPath = path.join(root, ".claude", "verification.json");
    const configuredPlan = JSON.parse(fs.readFileSync(verificationPath, "utf8"));
    const brokenPlan = structuredClone(configuredPlan);
    const unitCheck = brokenPlan.checks.find((check) => check.id === "unit-suite");
    unitCheck.configured = false;
    unitCheck.configuration_help = "unit suite must be configured for pre-pr.";
    delete unitCheck.command;
    delete unitCheck.args;
    delete unitCheck.timeout_ms;
    fs.writeFileSync(verificationPath, `${JSON.stringify(brokenPlan, null, 2)}\n`);
    let failClosed = false;
    try {
      verifyBranch(root, { changeId, cadence: "pre-pr" });
    } catch (error) {
      failClosed = /fail-closed|not configured/i.test(error.message);
      if (!failClosed) throw error;
    }
    if (!failClosed) throw new Error("Expected pre-pr to fail closed when a required check is unconfigured.");
    fs.writeFileSync(verificationPath, `${JSON.stringify(configuredPlan, null, 2)}\n`);

    const prePr = verifyBranch(root, { changeId, cadence: "pre-pr" });
    if (prePr.report.status !== "pass") {
      throw new Error(`pre-pr verification failed: ${JSON.stringify(prePr.report.agent_summary, null, 2)}`);
    }

    const branchReviewRel = writeJson(root, ".claude/specs/reviews/lived-branch.json", {
      verdict: "pass",
      blocking_findings: [],
      non_blocking_findings: [],
      required_human_decisions: [],
      reviewed_paths: ["src/todo.js", "tests/todo.test.js", "tests/todo.integration.test.js"],
      evidence_refs: [path.relative(root, prePr.reportPath)],
    });
    const branchReviewAbs = path.join(root, branchReviewRel);
    const afterPrePr = new Date(Date.parse(prePr.report.generated_at) + 1500);
    fs.utimesSync(branchReviewAbs, afterPrePr, afterPrePr);

    const readiness = finalizeBranch(root, {
      changeId,
      reportFile: path.relative(root, prePr.reportPath),
      reviewFile: branchReviewRel,
    });

    const validationErrors = specs.validate(root, changeId);
    if (validationErrors.length) throw new Error(validationErrors.join("\n"));

    report.status =
      verified.state === "STORY_VERIFIED" && readiness.evidence.status === "ready-for-draft-pr"
        ? "pass"
        : "fail";
    report.elapsed_ms = Date.now() - started;
    report.story_state = verified.state;
    report.branch = "feature/lived-todo";
    report.gates = ["G0", "G1", "G2", "G3", "G4"];
    report.proposal_paths = [
      g0.pack.written_path,
      g1.pack.written_path,
      g2.pack.written_path,
      g3.pack.written_path,
      g4.pack.written_path,
    ];
    report.red_exit_code = redRun.exit_code;
    report.green_exit_code = greenRun.exit_code;
    report.real_commands = {
      red: redRun.command,
      green: greenRun.command,
    };
    report.story_fast_status = storyFast.report.status;
    report.pre_pr_status = prePr.report.status;
    report.pre_pr_checks = prePr.report.checks.map((check) => ({
      id: check.sensor_id,
      kind: check.kind,
      status: check.status,
      runtime_ms: check.runtime_ms,
    }));
    report.performance = prePr.report.performance;
    report.fail_closed_unconfigured = failClosed;
    report.readiness_status = readiness.evidence.status;
    report.agent_summary = prePr.report.agent_summary;
    report.evidence = {
      red: redPath,
      implementation: implementPath,
      review: reviewPath,
      sensors: sensorPath,
      story_fast: path.relative(root, storyFast.reportPath),
      pre_pr: path.relative(root, prePr.reportPath),
      branch_review: branchReviewRel,
      readiness: path.relative(root, readiness.output),
    };
    return report;
  } catch (error) {
    report.status = "fail";
    report.elapsed_ms = Date.now() - started;
    report.error = error.message;
    report.root = root;
    throw Object.assign(error, { report, root });
  } finally {
    if (!keep && report.status === "pass") {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}

function structuralAlternativesSharedModules(selectionRationale, evolutionaryRules) {
  return {
    structural_alternatives: [
      {
        id: "clone-vertical",
        summary: "Separate module per capability with copied validation and id rules.",
        duplication_risk: "high",
      },
      {
        id: "shared-modules",
        summary: "Thin call sites reuse createTodo; no orchestration spine.",
        duplication_risk: "low",
      },
      {
        id: "parameterized-spine",
        summary: "Staged todo pipeline for create/batch/update; heavier than needed here.",
        duplication_risk: "medium",
      },
    ],
    selected_alternative_id: "shared-modules",
    selection_rationale: selectionRationale,
    second_slice_reuse_policy: {
      when: "second-similar-capability",
      required_action: "reuse-existing-seams-or-design-amendment",
      generalize_min_uses: 2,
    },
    evolutionary_rules: evolutionaryRules,
  };
}

function runStoryRatchet({
  root,
  changeId,
  storyId,
  testPath,
  redExpected,
  implementFiles,
  changedPaths,
  evidencePrefix,
}) {
  const redRun = runFocusedCommand(root, process.execPath, ["--test", testPath]);
  if (redRun.exit_code === 0) throw new Error(`Expected red tests for ${storyId} (${testPath}).`);
  const redPath = writeEvidence(root, `.claude/specs/evidence/${evidencePrefix}-red.json`, buildRedEvidence(redRun, {
    expected_failure: redExpected,
    observed_failure: (redRun.stderr || redRun.stdout || "test failed").slice(0, 500),
    test_paths: [testPath],
  }));
  ratchet.start(root, { changeId, storyId });
  ratchet.recordRed(root, storyId, redPath);

  for (const [relative, content] of implementFiles) write(root, relative, content);

  const greenRun = runFocusedCommand(root, process.execPath, ["--test", testPath]);
  if (greenRun.exit_code !== 0) {
    throw new Error(`Expected green tests for ${storyId}.\n${greenRun.stdout}\n${greenRun.stderr}`);
  }
  const implementPath = writeEvidence(
    root,
    `.claude/specs/evidence/${evidencePrefix}-implement.json`,
    buildImplementationEvidence(greenRun, {
      changed_paths: changedPaths,
      test_paths: [testPath],
    })
  );
  ratchet.recordImplementation(root, storyId, implementPath);

  const reviewPath = writeJson(root, `.claude/specs/reviews/${evidencePrefix}-story.json`, {
    verdict: "pass",
    blocking_findings: [],
    non_blocking_findings: [],
    missing_or_stale_evidence: [],
    required_human_decisions: [],
    reviewed_paths: changedPaths,
    evidence_refs: [redPath, implementPath],
  });
  const reviewAbsolute = path.join(root, reviewPath);
  const future = new Date(Date.now() + 1500);
  fs.utimesSync(reviewAbsolute, future, future);
  ratchet.recordReview(root, storyId, reviewPath);

  const sensorPath = writeJson(root, `.claude/specs/evidence/${evidencePrefix}-sensors.json`, {
    generated_at: new Date(Date.now() + 2000).toISOString(),
    status: "pass",
    blocking_status: "pass",
    workspace: workspaceFingerprint(root),
    sensors: [{
      sensor_id: "unit",
      status: "pass",
      command: greenRun.command,
      exit_code: greenRun.exit_code,
      evidence: implementPath,
    }],
  });
  ratchet.recordSensors(root, storyId, sensorPath);
  const verified = ratchet.verify(root, storyId);
  return {
    state: verified.state,
    red_exit_code: redRun.exit_code,
    green_exit_code: greenRun.exit_code,
    red_command: redRun.command,
    green_command: greenRun.command,
    evidence: { red: redPath, implementation: implementPath, review: reviewPath, sensors: sensorPath },
  };
}

/**
 * Multi-story evolutionary canary:
 * story-1 first-slice → story-2 reuses createTodo.
 * Fails closed if story-2 claims first-slice while depending on story-1.
 */
function runMultiStoryEvolutionCanary(options = {}) {
  const started = Date.now();
  const keep = Boolean(options.keep);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-multi-story-"));
  const changeId = "MULTI-001";
  const sourceId = `${changeId}-source`;
  const story1 = `${changeId}-story-1`;
  const story2 = `${changeId}-story-2`;
  const approver = "Multi-Story Canary";
  const report = {
    schema_version: 1,
    measurement_type: "multi-story-evolution-canary",
    change_id: changeId,
    story_ids: [story1, story2],
    root: keep ? root : undefined,
  };

  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "canary@example.com"]);
    git(root, ["config", "user.name", "Multi-Story Canary"]);
    write(root, "README.md", "# Multi-story evolution canary\n");
    git(root, ["add", "README.md"]);
    git(root, ["commit", "-qm", "seed"]);
    git(root, ["switch", "-qc", "feature/multi-story-evolution"]);

    execFileSync(process.execPath, [path.join(pluginRoot, "scripts", "harness-init.js"), root], {
      stdio: "ignore",
    });

    write(root, "src/todo.js", [
      "\"use strict\";",
      "function createTodo(title) {",
      "  return { title };",
      "}",
      "function createTodosFromTitles(titles) {",
      "  return titles.map((title) => ({ title }));",
      "}",
      "module.exports = { createTodo, createTodosFromTitles };",
      "",
    ].join("\n"));
    write(root, "package.json", `${JSON.stringify({
      name: "multi-story-evolution-fixture",
      private: true,
      type: "commonjs",
    }, null, 2)}\n`);
    writeLivedSupportScripts(root);
    writeLivedVerificationPlan(root);

    write(root, "requirements/prd.md", [
      "# PRD: Todo create + batch",
      "",
      "## Outcome",
      "1. createTodo(title) returns { id, title, done:false } and rejects empty titles.",
      "2. createTodosFromTitles(titles) maps titles via createTodo (reuse — no cloned validation).",
      "",
      "## Evolutionary rule",
      "The second capability reuses the first factory; do not copy title rules.",
      "",
    ].join("\n"));

    specs.intake(root, { changeId, source: "requirements/prd.md", kind: "prd" });

    register(root, baseArtifact(changeId, sourceId, `${changeId}-prd`, "prd", {
      summary: "createTodo then batch that reuses it",
      outcomes: ["createTodo", "createTodosFromTitles reuses createTodo"],
    }));
    registerSpdd(root, changeId, sourceId);
    proposalAndApprove(root, changeId, "G0", approver);

    register(root, baseArtifact(changeId, sourceId, `${changeId}-epic`, "epics", {
      title: "Todo create + batch",
    }));
    register(root, baseArtifact(changeId, sourceId, story1, "stories", {
      title: "Create a single todo",
      size: "low", story_points: 2, estimate_confidence: "high",
      estimate_basis: ["Focused factory plus validation tests."],
      acceptance_criteria: [
        "createTodo(title) returns { id, title, done: false }",
        "createTodo(\"\") throws",
      ],
    }, [`${changeId}-epic`]));
    register(root, baseArtifact(changeId, sourceId, story2, "stories", {
      title: "Batch create reuses createTodo",
      size: "low", story_points: 3, estimate_confidence: "high",
      estimate_basis: ["One reuse seam plus batch acceptance tests."],
      acceptance_criteria: [
        "createTodosFromTitles maps each title through createTodo",
        "Empty titles in the batch still throw",
      ],
    }, [`${changeId}-epic`]));
    register(root, baseArtifact(changeId, sourceId, `${changeId}-deps`, "dependencies", {
      nodes: [{ story_id: story1 }, { story_id: story2 }],
      edges: [{ from: story1, to: story2, rationale: "Batch reuses the single-create seam." }],
    }, [story1, story2]));
    register(root, baseArtifact(changeId, sourceId, `${changeId}-allocations`, "allocations", {
      clusters: [{ id: "todo-evolution", story_ids: [story1, story2], total_points: 5, depends_on_clusters: [], shared_seams: ["src/todo.js"], required_skills: ["JavaScript"], rationale: "Keep sequential reuse work with one owner." }],
    }, [story1, story2, `${changeId}-deps`]));
    proposalAndApprove(root, changeId, "G1", approver);

    register(root, baseArtifact(changeId, sourceId, `${changeId}-data`, "test-data", {
      fixtures: [{ title: "Buy milk" }, { titles: ["A", "B"] }],
    }, [story1, story2]));
    register(root, baseArtifact(changeId, sourceId, `${changeId}-case-1`, "test-cases", {
      story_id: story1,
      cases: ["happy", "empty"],
    }, [story1]));
    register(root, baseArtifact(changeId, sourceId, `${changeId}-case-2`, "test-cases", {
      story_id: story2,
      cases: ["batch-maps-createTodo", "batch-empty-throws"],
    }, [story2]));
    register(root, baseArtifact(changeId, sourceId, `${changeId}-test-plan`, "test-plans", {
      levels: ["unit"],
      hermetic: true,
    }, [`${changeId}-case-1`, `${changeId}-case-2`]));
    proposalAndApprove(root, changeId, "G2", approver);

    register(root, baseArtifact(changeId, sourceId, `${changeId}-design`, "design", {
      folder_structure: ["src/todo.js", "tests/todo.test.js", "tests/todo-batch.test.js"],
      seam: "createTodosFromTitles calls createTodo",
    }, [story1, story2]));
    register(root, baseArtifact(changeId, sourceId, `${changeId}-architecture`, "architecture", {
      style: "shared-modules",
      boundaries: ["no IO"],
      performance_budgets: [{ id: "unit-suite", metric: "duration_ms", maximum: 5000 }],
      ...structuralAlternativesSharedModules(
        "Two related factories; batch must call createTodo rather than cloning validation.",
        [
          "Story 2 reuses createTodo (implementation_posture reuse-existing).",
          "Do not register a dependent story as first-slice.",
        ]
      ),
    }, [`${changeId}-design`]));
    proposalAndApprove(root, changeId, "G3", approver);

    const story1Contract = {
      story_id: story1,
      feature_surfaces: ["internal"],
      source_requirements: ["createTodo returns id, title, done=false", "empty title rejected"],
      approved_design_refs: [`${changeId}-design`, `${changeId}-architecture`],
      dependency_story_ids: [],
      allowed_change_scope: ["src", "tests"],
      acceptance_criteria: [
        "createTodo(title) returns { id, title, done: false }",
        "createTodo(\"\") throws",
      ],
      test_case_ids: [`${changeId}-case-1`],
      test_data_ids: [`${changeId}-data`],
      required_sensors: ["unit"],
      performance_budgets: [{ id: "unit-suite", metric: "duration_ms", maximum: 5000 }],
      routing_risks: [],
      human_decisions: ["independent-first-slice for the initial createTodo factory"],
      implementation_posture: "first-slice",
      reuse_targets: [],
    };

    register(root, baseArtifact(changeId, sourceId, `${changeId}-contract-1`, "plans", story1Contract, [
      story1, `${changeId}-design`, `${changeId}-case-1`,
    ]));

    // Negative path: dependent story claims first-slice → G4 blocked.
    register(root, baseArtifact(changeId, sourceId, `${changeId}-contract-2`, "plans", {
      story_id: story2,
      feature_surfaces: ["internal"],
      source_requirements: ["batch reuses createTodo"],
      approved_design_refs: [`${changeId}-design`, `${changeId}-architecture`],
      dependency_story_ids: [story1],
      allowed_change_scope: ["src", "tests"],
      acceptance_criteria: ["createTodosFromTitles uses createTodo"],
      test_case_ids: [`${changeId}-case-2`],
      test_data_ids: [`${changeId}-data`],
      required_sensors: ["unit"],
      performance_budgets: [],
      routing_risks: [],
      human_decisions: [],
      implementation_posture: "first-slice",
      reuse_targets: [],
    }, [story2, story1, `${changeId}-design`, `${changeId}-case-2`]));
    const badStory2Contract = JSON.parse(fs.readFileSync(path.join(root, ".claude", "specs", "plans", `${changeId}-contract-2.json`), "utf8")).content;
    register(root, baseArtifact(changeId, sourceId, `${changeId}-traceability`, "traceability", {
      links: [...traceLinks(story1Contract, "requirements/prd.md#outcome"), ...traceLinks(badStory2Contract, "requirements/prd.md#outcome")],
    }, [`${changeId}-contract-1`, `${changeId}-contract-2`]));

    const badG4 = specs.proposalPack(root, { changeId, gate: "G4", write: true });
    if (badG4.ready) {
      throw new Error("Expected G4 to be blocked when story-2 uses first-slice with dependencies.");
    }
    const badBlocking = badG4.blocking.join("\n");
    if (!/first-slice/i.test(badBlocking)) {
      throw new Error(`Expected first-slice blocking message, got: ${badBlocking}`);
    }
    let approveRejected = false;
    try {
      specs.approve(root, { changeId, gate: "G4", approver });
    } catch (error) {
      approveRejected = /design-evolution|first-slice/i.test(error.message);
      if (!approveRejected) throw error;
    }
    if (!approveRejected) {
      throw new Error("Expected approve(G4) to throw for dependent first-slice story.");
    }

    // Positive path: story-2 reuses createTodo.
    const story2Contract = {
      story_id: story2,
      feature_surfaces: ["internal"],
      source_requirements: ["batch reuses createTodo", "empty titles still throw"],
      approved_design_refs: [`${changeId}-design`, `${changeId}-architecture`],
      dependency_story_ids: [story1],
      allowed_change_scope: ["src", "tests"],
      acceptance_criteria: [
        "createTodosFromTitles maps each title through createTodo",
        "createTodosFromTitles([\"\"]) throws",
      ],
      test_case_ids: [`${changeId}-case-2`],
      test_data_ids: [`${changeId}-data`],
      required_sensors: ["unit"],
      performance_budgets: [{ id: "unit-suite", metric: "duration_ms", maximum: 5000 }],
      routing_risks: [],
      human_decisions: [],
      implementation_posture: "reuse-existing",
      reuse_targets: [{ path: "src/todo.js", symbol: "createTodo" }],
    };
    register(root, baseArtifact(changeId, sourceId, `${changeId}-contract-2`, "plans", story2Contract, [story2, story1, `${changeId}-design`, `${changeId}-case-2`]));
    register(root, baseArtifact(changeId, sourceId, `${changeId}-traceability`, "traceability", {
      links: [...traceLinks(story1Contract, "requirements/prd.md#outcome"), ...traceLinks(story2Contract, "requirements/prd.md#outcome")],
    }, [`${changeId}-contract-1`, `${changeId}-contract-2`]));

    const g4 = proposalAndApprove(root, changeId, "G4", approver);
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "approved multi-story co-design with reuse posture"]);

    write(root, "tests/todo.test.js", [
      "\"use strict\";",
      "const test = require(\"node:test\");",
      "const assert = require(\"node:assert/strict\");",
      "const { createTodo } = require(\"../src/todo.js\");",
      "",
      "test(\"createTodo returns id, title, and done=false\", () => {",
      "  const todo = createTodo(\"Buy milk\");",
      "  assert.equal(typeof todo.id, \"string\");",
      "  assert.ok(todo.id.length > 0);",
      "  assert.equal(todo.title, \"Buy milk\");",
      "  assert.equal(todo.done, false);",
      "});",
      "",
      "test(\"createTodo rejects empty title\", () => {",
      "  assert.throws(() => createTodo(\"\"), /title/i);",
      "});",
      "",
    ].join("\n"));

    const story1Result = runStoryRatchet({
      root,
      changeId,
      storyId: story1,
      testPath: "tests/todo.test.js",
      redExpected: "createTodo must supply id/done and reject empty titles",
      implementFiles: [[
        "src/todo.js",
        [
          "\"use strict\";",
          "function createTodo(title) {",
          "  if (typeof title !== \"string\" || title.trim() === \"\") {",
          "    throw new Error(\"title is required\");",
          "  }",
          "  return { id: `todo-${Buffer.from(title).toString(\"hex\").slice(0, 8)}`, title, done: false };",
          "}",
          "function createTodosFromTitles(titles) {",
          "  return titles.map((title) => ({ title }));",
          "}",
          "module.exports = { createTodo, createTodosFromTitles };",
          "",
        ].join("\n"),
      ]],
      changedPaths: ["src/todo.js", "tests/todo.test.js"],
      evidencePrefix: "multi-s1",
    });

    write(root, "tests/todo-batch.test.js", [
      "\"use strict\";",
      "const test = require(\"node:test\");",
      "const assert = require(\"node:assert/strict\");",
      "const { createTodo, createTodosFromTitles } = require(\"../src/todo.js\");",
      "",
      "test(\"createTodosFromTitles maps via createTodo\", () => {",
      "  const batch = createTodosFromTitles([\"A\", \"B\"]);",
      "  assert.equal(batch.length, 2);",
      "  assert.deepEqual(batch[0], createTodo(\"A\"));",
      "  assert.deepEqual(batch[1], createTodo(\"B\"));",
      "});",
      "",
      "test(\"createTodosFromTitles rejects empty titles\", () => {",
      "  assert.throws(() => createTodosFromTitles([\"\"]), /title/i);",
      "});",
      "",
    ].join("\n"));

    const story2Result = runStoryRatchet({
      root,
      changeId,
      storyId: story2,
      testPath: "tests/todo-batch.test.js",
      redExpected: "batch must reuse createTodo behaviour",
      implementFiles: [[
        "src/todo.js",
        [
          "\"use strict\";",
          "function createTodo(title) {",
          "  if (typeof title !== \"string\" || title.trim() === \"\") {",
          "    throw new Error(\"title is required\");",
          "  }",
          "  return { id: `todo-${Buffer.from(title).toString(\"hex\").slice(0, 8)}`, title, done: false };",
          "}",
          "function createTodosFromTitles(titles) {",
          "  if (!Array.isArray(titles)) throw new Error(\"titles must be an array\");",
          "  return titles.map((title) => createTodo(title));",
          "}",
          "module.exports = { createTodo, createTodosFromTitles };",
          "",
        ].join("\n"),
      ]],
      changedPaths: ["src/todo.js", "tests/todo-batch.test.js"],
      evidencePrefix: "multi-s2",
    });

    // Prove reuse is structural: batch implementation must call createTodo.
    const src = fs.readFileSync(path.join(root, "src/todo.js"), "utf8");
    if (!/createTodosFromTitles[\s\S]*createTodo\s*\(/.test(src)) {
      throw new Error("Story-2 implementation must call createTodo (reuse), not clone validation.");
    }

    const bothVerified =
      story1Result.state === "STORY_VERIFIED" && story2Result.state === "STORY_VERIFIED";
    report.status = bothVerified ? "pass" : "fail";
    report.elapsed_ms = Date.now() - started;
    report.branch = "feature/multi-story-evolution";
    report.gates = ["G0", "G1", "G2", "G3", "G4"];
    report.negative_path = {
      dependent_first_slice_blocked: true,
      proposal_ready: badG4.ready,
      approve_rejected: approveRejected,
      blocking_excerpt: badBlocking.slice(0, 400),
      proposal_path: badG4.written_path,
    };
    report.story_states = {
      [story1]: story1Result.state,
      [story2]: story2Result.state,
    };
    report.postures = {
      [story1]: "first-slice",
      [story2]: "reuse-existing",
    };
    report.reuse_targets = [{ path: "src/todo.js", symbol: "createTodo" }];
    report.reuse_verified_in_source = true;
    report.real_commands = {
      story1_red: story1Result.red_command,
      story1_green: story1Result.green_command,
      story2_red: story2Result.red_command,
      story2_green: story2Result.green_command,
    };
    report.g4_proposal_path = g4.pack.written_path;
    report.evidence = {
      story1: story1Result.evidence,
      story2: story2Result.evidence,
      bad_g4_proposal: badG4.written_path,
    };
    return report;
  } catch (error) {
    report.status = "fail";
    report.elapsed_ms = Date.now() - started;
    report.error = error.message;
    report.root = root;
    throw Object.assign(error, { report, root });
  } finally {
    if (!keep && report.status === "pass") {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}

module.exports = { runLivedCanary, runMultiStoryEvolutionCanary };
