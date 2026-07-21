const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const specs = require("../../.claude/lib/specifications");

function project(branch = "feature/specs") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-specs-"));
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Harness Test"]);
  fs.writeFileSync(path.join(root, "seed.txt"), "seed\n");
  execFileSync("git", ["-C", root, "add", "seed.txt"]);
  execFileSync("git", ["-C", root, "commit", "-qm", "seed"]);
  execFileSync("git", ["-C", root, "switch", "-qc", branch]);
  return root;
}

function registerDraft(root, artifact) {
  const file = `${artifact.id}.draft.json`;
  fs.writeFileSync(path.join(root, file), JSON.stringify(artifact));
  return specs.register(root, file);
}

function registerPrdSpdd(root, changeId) {
  const sourceId = `${changeId}-source`;
  const analysisId = `${changeId}-analysis`;
  registerDraft(root, {
    id: analysisId, package: "analysis", change_id: changeId, source_ids: [sourceId],
    source_locations: ["prd.md"], derived_from: [`${changeId}-prd`], status: "draft",
    assumptions: [], open_questions: [], content: {
      domain_concepts: ["concept"], strategic_direction: ["direction"],
      risks: ["risk"], requirement_gaps: ["none"],
    },
  });
  registerDraft(root, {
    id: `${changeId}-reasons`, package: "reasons-canvas", change_id: changeId, source_ids: [sourceId],
    source_locations: ["prd.md"], derived_from: [analysisId], status: "draft",
    assumptions: [], open_questions: [], content: {
      requirements: ["requirement"], entities: ["entity"], approach: ["approach"],
      structure: ["structure"], operations: ["operation"], norms: ["norm"],
      safeguards: ["safeguard"], sync: { status: "aligned", amendment_ids: [] },
    },
  });
}

test("intake captures an immutable source and binds the change to the feature branch", () => {
  const root = project();
  fs.mkdirSync(path.join(root, "requirements"));
  fs.writeFileSync(path.join(root, "requirements", "prd.md"), "# Product requirement\n");
  const record = specs.intake(root, { changeId: "CHANGE-001", source: "requirements/prd.md", kind: "prd" });
  assert.equal(record.kind, "prd");
  assert.equal(record.sha256.length, 64);
  const index = JSON.parse(fs.readFileSync(path.join(root, ".claude", "specs", "index.json")));
  assert.equal(index.changes["CHANGE-001"].branch, "feature/specs");
  assert.deepEqual(specs.validate(root, "CHANGE-001"), []);
});

test("story intake uses a governing intent instead of a synthetic PRD or BRD", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "story.md"), "# US-142\nAs an administrator I can export invoices.\n");
  const source = specs.intake(root, { changeId: "US-142", source: "story.md", kind: "story" });
  assert.equal(source.kind, "story");
  registerDraft(root, {
    id: "US-142-intent", package: "intents", change_id: "US-142", source_ids: ["US-142-source"],
    source_locations: ["story.md"], derived_from: [], status: "draft", assumptions: [], open_questions: [],
    content: {
      artifact_type: "governing-intent", outcome: "Administrators can export invoices.",
      actors: ["administrator"], scope: ["invoice export"], exclusions: [], acceptance_signals: ["CSV can be downloaded"],
    },
  });
  const pack = specs.proposalPack(root, { changeId: "US-142", gate: "G0" });
  assert.equal(pack.ready, true);
  assert.deepEqual(pack.missing_packages, []);
  assert.equal(specs.approve(root, { changeId: "US-142", gate: "G0", approver: "Alex" }).status, "approved");
});

test("governing intent fails closed when its outcome contract is incomplete", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "feature.md"), "# Feature\n");
  specs.intake(root, { changeId: "F-1", source: "feature.md", kind: "feature" });
  assert.throws(() => registerDraft(root, {
    id: "F-1-intent", package: "intents", change_id: "F-1", source_ids: ["F-1-source"],
    source_locations: ["feature.md"], derived_from: [], status: "draft", assumptions: [], open_questions: [],
    content: { artifact_type: "governing-intent", outcome: "", actors: [], scope: [], exclusions: [], acceptance_signals: [] },
  }), /intents.outcome is required/);
});

test("specification writes are refused on protected branches", () => {
  const root = project("main");
  fs.writeFileSync(path.join(root, "prd.md"), "# PRD\n");
  assert.throws(() => specs.intake(root, { changeId: "C-1", source: "prd.md", kind: "prd" }), /protected branch/);
});

test("registered artifacts require captured sources and produce traceability edges", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "prd.md"), "# PRD\n");
  specs.intake(root, { changeId: "C-1", source: "prd.md", kind: "prd" });
  const draft = {
    id: "C-1-story-1", package: "stories", change_id: "C-1",
    source_ids: ["C-1-source"], source_locations: ["prd.md#outcome"], derived_from: [],
    status: "draft", assumptions: [], open_questions: [], human_approver: null, approved_at: null,
    content: { title: "A grounded story" },
  };
  fs.writeFileSync(path.join(root, "draft.json"), JSON.stringify(draft));
  specs.register(root, "draft.json");
  const index = JSON.parse(fs.readFileSync(path.join(root, ".claude", "specs", "index.json")));
  assert.deepEqual(index.relationships, [{ from: "C-1-source", to: "C-1-story-1", type: "grounds" }]);
  assert.deepEqual(specs.validate(root), []);
});

test("human gates are sequential and record the approver", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "brd.md"), "# BRD\n");
  specs.intake(root, { changeId: "C-2", source: "brd.md", kind: "brd" });
  assert.throws(() => specs.approve(root, { changeId: "C-2", gate: "G1", approver: "Alex" }), /requires approved G0/);
  assert.throws(() => specs.approve(root, { changeId: "C-2", gate: "G0", approver: "Alex" }), /requires registered artifacts in: brd/);
  registerDraft(root, {
    id: "C-2-brd", package: "brd", change_id: "C-2", source_ids: ["C-2-source"],
    source_locations: ["brd.md"], derived_from: [], status: "draft", assumptions: [], open_questions: [],
    content: { intake_path: "brd-direct", direct_brd_rationale: "Already sufficient", sufficiency_checks: ["Scope and outcomes are explicit"] },
  });
  const approval = specs.approve(root, { changeId: "C-2", gate: "G0", approver: "Alex" });
  assert.equal(approval.status, "approved");
  assert.equal(approval.approver, "Alex");
  assert.throws(() => specs.approve(root, { changeId: "C-2", gate: "G1", approver: "Alex" }), /requires registered artifacts in: epics, stories, dependencies, allocations/);
});

test("product checkpoint presents and atomically records G0 and G1", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "brd.md"), "# BRD\nShip one outcome.\n");
  specs.intake(root, { changeId: "C-CHECK", source: "brd.md", kind: "brd" });
  registerDraft(root, {
    id: "C-CHECK-brd", package: "brd", change_id: "C-CHECK", source_ids: ["C-CHECK-source"],
    source_locations: ["brd.md"], derived_from: [], status: "draft", assumptions: [], open_questions: [],
    content: { intake_path: "brd-direct", direct_brd_rationale: "Sufficient bounded requirement", sufficiency_checks: ["Outcome is explicit"] },
  });
  registerDraft(root, {
    id: "C-CHECK-epic", package: "epics", change_id: "C-CHECK", source_ids: ["C-CHECK-source"],
    source_locations: ["brd.md"], derived_from: [], status: "draft", assumptions: [], open_questions: [], content: { title: "Outcome" },
  });
  registerDraft(root, {
    id: "C-CHECK-story", package: "stories", change_id: "C-CHECK", source_ids: ["C-CHECK-source"],
    source_locations: ["brd.md"], derived_from: ["C-CHECK-epic"], status: "draft", assumptions: [], open_questions: [],
    content: { title: "Deliver outcome", size: "low", story_points: 2, estimate_confidence: "high", estimate_basis: ["One seam"], acceptance_criteria: ["Outcome is visible"] },
  });
  registerDraft(root, {
    id: "C-CHECK-deps", package: "dependencies", change_id: "C-CHECK", source_ids: ["C-CHECK-source"],
    source_locations: ["brd.md"], derived_from: ["C-CHECK-story"], status: "draft", assumptions: [], open_questions: [],
    content: { nodes: [{ story_id: "C-CHECK-story" }], edges: [] },
  });
  registerDraft(root, {
    id: "C-CHECK-alloc", package: "allocations", change_id: "C-CHECK", source_ids: ["C-CHECK-source"],
    source_locations: ["brd.md"], derived_from: ["C-CHECK-story", "C-CHECK-deps"], status: "draft", assumptions: [], open_questions: [],
    content: { clusters: [{ id: "cluster-1", story_ids: ["C-CHECK-story"], total_points: 2, shared_seams: [], required_skills: [], depends_on_clusters: [], rationale: "One cohesive story" }] },
  });
  const pack = specs.checkpointPack(root, { changeId: "C-CHECK", checkpoint: "product", write: true });
  assert.equal(pack.ready, true);
  assert.match(pack.markdown, /one human decision/);
  assert.ok(fs.existsSync(path.join(root, pack.written_path)));
  const result = specs.approveCheckpoint(root, { changeId: "C-CHECK", checkpoint: "product", approver: "Alex" });
  assert.equal(result.approvals.G0.status, "approved");
  assert.equal(result.approvals.G1.status, "approved");
  const index = JSON.parse(fs.readFileSync(path.join(root, ".claude", "specs", "index.json"), "utf8"));
  assert.equal(index.changes["C-CHECK"].gates.G0.approver, "Alex");
  assert.equal(index.changes["C-CHECK"].gates.G1.approver, "Alex");
});

test("checkpoint approval leaves no partial approval when a constituent gate is incomplete", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "brd.md"), "# BRD\n");
  specs.intake(root, { changeId: "C-ROLLBACK", source: "brd.md", kind: "brd" });
  registerDraft(root, {
    id: "C-ROLLBACK-brd", package: "brd", change_id: "C-ROLLBACK", source_ids: ["C-ROLLBACK-source"],
    source_locations: ["brd.md"], derived_from: [], status: "draft", assumptions: [], open_questions: [],
    content: { intake_path: "brd-direct", direct_brd_rationale: "Sufficient", sufficiency_checks: ["Reviewed"] },
  });
  assert.throws(() => specs.approveCheckpoint(root, { changeId: "C-ROLLBACK", checkpoint: "product", approver: "Alex" }), /not ready/);
  const index = JSON.parse(fs.readFileSync(path.join(root, ".claude", "specs", "index.json"), "utf8"));
  assert.equal(index.changes["C-ROLLBACK"].gates.G0, undefined);
  assert.equal(index.artifacts.find((item) => item.id === "C-ROLLBACK-brd").status, "draft");
});

test("PRD G0 fails closed without SPDD and rejects a canvas not derived from analysis", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "prd.md"), "# PRD\n");
  specs.intake(root, { changeId: "C-SPDD", source: "prd.md", kind: "prd" });
  registerDraft(root, {
    id: "C-SPDD-prd", package: "prd", change_id: "C-SPDD", source_ids: ["C-SPDD-source"],
    source_locations: ["prd.md"], derived_from: [], status: "draft", assumptions: [], open_questions: [],
    content: { summary: "Grounded PRD" },
  });
  assert.throws(
    () => specs.approve(root, { changeId: "C-SPDD", gate: "G0", approver: "Alex" }),
    /analysis, reasons-canvas/
  );

  registerPrdSpdd(root, "C-SPDD");
  const canvasPath = path.join(root, ".claude", "specs", "reasons-canvas", "C-SPDD-reasons.json");
  const canvas = JSON.parse(fs.readFileSync(canvasPath, "utf8"));
  canvas.derived_from = ["C-SPDD-prd"];
  fs.writeFileSync(path.join(root, "wrong-canvas.json"), JSON.stringify({ ...canvas, status: "draft" }));
  specs.register(root, "wrong-canvas.json");
  const pack = specs.proposalPack(root, { changeId: "C-SPDD", gate: "G0" });
  assert.equal(pack.ready, false);
  assert.match(pack.blocking.join("\n"), /must derive from analysis/);
  assert.throws(
    () => specs.approve(root, { changeId: "C-SPDD", gate: "G0", approver: "Alex" }),
    /must derive from analysis/
  );
});

test("direct BRD G0 fails without an explicit reviewed sufficiency route", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "brd.md"), "# BRD\n");
  specs.intake(root, { changeId: "C-DIRECT", source: "brd.md", kind: "brd" });
  registerDraft(root, {
    id: "C-DIRECT-brd", package: "brd", change_id: "C-DIRECT", source_ids: ["C-DIRECT-source"],
    source_locations: ["brd.md"], derived_from: [], status: "draft", assumptions: [], open_questions: [],
    content: { summary: "Insufficient direct route" },
  });
  assert.throws(
    () => specs.approve(root, { changeId: "C-DIRECT", gate: "G0", approver: "Alex" }),
    /intake_path='brd-direct'/
  );
});

test("approved prompt amendment supersedes intent and reopens downstream gates", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "prd.md"), "# PRD\n");
  specs.intake(root, { changeId: "C-AMEND", source: "prd.md", kind: "prd" });
  registerDraft(root, {
    id: "C-AMEND-prd", package: "prd", change_id: "C-AMEND", source_ids: ["C-AMEND-source"],
    source_locations: ["prd.md"], derived_from: [], status: "draft", assumptions: [], open_questions: [], content: { summary: "v1" },
  });
  registerPrdSpdd(root, "C-AMEND");
  specs.approve(root, { changeId: "C-AMEND", gate: "G0", approver: "Alex" });
  registerDraft(root, {
    id: "C-AMEND-reasons-v2", package: "reasons-canvas", change_id: "C-AMEND", source_ids: ["C-AMEND-source"],
    source_locations: ["prd.md"], derived_from: ["C-AMEND-analysis"], status: "draft", assumptions: [], open_questions: [], content: {
      requirements: ["corrected"], entities: ["entity"], approach: ["approach"], structure: ["structure"],
      operations: ["operation"], norms: ["norm"], safeguards: ["safeguard"], sync: { status: "aligned", amendment_ids: ["C-AMEND-prompt-1"] },
    },
  });
  registerDraft(root, {
    id: "C-AMEND-prompt-1", package: "prompt-amendments", change_id: "C-AMEND", source_ids: ["C-AMEND-source"],
    source_locations: ["prd.md"], derived_from: ["C-AMEND-reasons"], status: "draft", assumptions: [], open_questions: [], content: {
      reason: "Correct business rule", affected_gates: ["G0"], supersedes_artifact_ids: ["C-AMEND-reasons"], replacement_artifact_ids: ["C-AMEND-reasons-v2"],
    },
  });
  const result = specs.applyPromptAmendment(root, { changeId: "C-AMEND", amendmentId: "C-AMEND-prompt-1", approver: "Alex" });
  assert.deepEqual(result.reopened_gates, ["G0", "G1", "G2", "G3", "G4"]);
  const index = JSON.parse(fs.readFileSync(path.join(root, ".claude", "specs", "index.json"), "utf8"));
  assert.equal(index.changes["C-AMEND"].reapproval_required, true);
  assert.equal(index.changes["C-AMEND"].gates.G0, undefined);
  assert.equal(index.artifacts.find((item) => item.id === "C-AMEND-reasons").status, "superseded");
  assert.equal(specs.proposalPack(root, { changeId: "C-AMEND", gate: "G0" }).ready, true);
  specs.approve(root, { changeId: "C-AMEND", gate: "G0", approver: "Alex" });
});

test("validation detects post-registration artifact drift", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "prd.md"), "# PRD\n");
  specs.intake(root, { changeId: "C-3", source: "prd.md", kind: "prd" });
  const file = path.join(root, ".claude", "specs", "source", "C-3", "prd.md");
  fs.appendFileSync(file, "changed\n");
  assert.match(specs.validate(root).join("\n"), /no longer matches/);
});

test("proposal pack renders a human-readable gate review and writes evidence when requested", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "brd.md"), "# BRD\nDeliver a todo list API.\n");
  specs.intake(root, { changeId: "C-PROP", source: "brd.md", kind: "brd" });
  const incomplete = specs.proposalPack(root, { changeId: "C-PROP", gate: "G0" });
  assert.equal(incomplete.ready, false);
  assert.match(incomplete.markdown, /MISSING/);
  assert.ok(incomplete.missing_packages.includes("brd"));

  registerDraft(root, {
    id: "C-PROP-brd",
    package: "brd",
    change_id: "C-PROP",
    source_ids: ["C-PROP-source"],
    source_locations: ["brd.md#outcome"],
    derived_from: [],
    status: "draft",
    assumptions: ["Users are authenticated externally."],
    open_questions: ["Should soft-delete be supported?"],
    content: { intake_path: "brd-direct", direct_brd_rationale: "Already sufficient", sufficiency_checks: ["Scope and outcomes are explicit"], summary: "Normalized BRD interpretation", outcomes: ["CRUD todos"] },
  });

  const pack = specs.proposalPack(root, { changeId: "C-PROP", gate: "G0", write: true });
  assert.equal(pack.ready, true);
  assert.equal(pack.packages_complete, true);
  assert.match(pack.markdown, /Co-design proposal: C-PROP \/ G0/);
  assert.match(pack.markdown, /G0 interpretation session/);
  assert.match(pack.markdown, /Normalized interpretation/);
  assert.match(pack.markdown, /Should soft-delete be supported/);
  assert.match(pack.markdown, /Users are authenticated externally/);
  assert.equal(pack.written_path, ".claude/specs/evidence/C-PROP-gate-G0-proposal.md");
  assert.ok(fs.existsSync(path.join(root, pack.written_path)));
  assert.match(fs.readFileSync(path.join(root, pack.written_path), "utf8"), /Ready for human decision/);
});

test("proposal pack refuses to skip gate predecessors", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "brd.md"), "# BRD\n");
  specs.intake(root, { changeId: "C-PRE", source: "brd.md", kind: "brd" });
  const pack = specs.proposalPack(root, { changeId: "C-PRE", gate: "G1" });
  assert.equal(pack.ready, false);
  assert.match(pack.blocking.join("\n"), /requires approved G0/);
});

test("brownfield gates require baseline, code-map, and strategy evidence in order", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "change.md"), "# Existing-system change\n");
  specs.intake(root, { changeId: "C-4", source: "change.md", kind: "prd" });
  assert.throws(() => specs.approve(root, { changeId: "C-4", gate: "B0", approver: "Sam" }), /requires registered artifacts in: brownfield/);
  registerDraft(root, {
    id: "C-4-baseline", package: "brownfield", change_id: "C-4", source_ids: ["C-4-source"],
    source_locations: ["change.md"], derived_from: [], status: "draft", assumptions: [], open_questions: [],
    content: { artifact_type: "baseline", commands: [] },
  });
  specs.approve(root, { changeId: "C-4", gate: "B0", approver: "Sam" });
  assert.throws(() => specs.approve(root, { changeId: "C-4", gate: "B2", approver: "Sam" }), /requires approved B1/);
  assert.throws(() => specs.approve(root, { changeId: "C-4", gate: "B1", approver: "Sam" }), /requires registered artifacts in: brownfield/);

  registerDraft(root, {
    id: "C-4-code-map", package: "brownfield", change_id: "C-4", source_ids: ["C-4-source"],
    source_locations: ["src"], derived_from: [], status: "draft", assumptions: [], open_questions: [],
    content: { artifact_type: "code-map", graph: { nodes: [], edges: [] } },
  });
  specs.approve(root, { changeId: "C-4", gate: "B1", approver: "Sam" });
  registerDraft(root, {
    id: "C-4-strategy", package: "brownfield", change_id: "C-4", source_ids: ["C-4-source"],
    source_locations: ["change.md"], derived_from: ["C-4-code-map"], status: "draft", assumptions: [], open_questions: [],
    content: {
      artifact_type: "change-strategy",
      second_slice_decision: "reuse-existing",
      reuse: [{ path: "src/helpers.py", symbol: "parse_amount" }],
    },
  });
  registerDraft(root, {
    id: "C-4-amendment", package: "amendments", change_id: "C-4", source_ids: ["C-4-source"],
    source_locations: ["change.md"], derived_from: ["C-4-strategy"], status: "draft", assumptions: [], open_questions: [],
    content: {
      artifact_type: "design-amendment",
      decision: "Reuse parse_amount; no layer change.",
      proposed_delta: "Call existing helper from the new call site.",
      alternatives: ["clone amount parsing", "reuse parse_amount"],
    },
  });
  const approval = specs.approve(root, { changeId: "C-4", gate: "B2", approver: "Sam" });
  assert.equal(approval.status, "approved");
});

test("G3 proposal and approve require three structural alternatives and second-slice policy", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "prd.md"), "# PRD\n");
  specs.intake(root, { changeId: "C-G3", source: "prd.md", kind: "prd" });
  for (const [gate, drafts] of [
    ["G0", [{
      id: "C-G3-prd", package: "prd", change_id: "C-G3", source_ids: ["C-G3-source"],
      source_locations: ["prd.md"], derived_from: [], status: "draft", assumptions: [], open_questions: [],
      content: { summary: "ok" },
    }]],
    ["G1", [
      {
        id: "C-G3-epic", package: "epics", change_id: "C-G3", source_ids: ["C-G3-source"],
        source_locations: ["prd.md"], derived_from: [], status: "draft", assumptions: [], open_questions: [],
        content: { title: "E1" },
      },
      {
        id: "C-G3-story-1", package: "stories", change_id: "C-G3", source_ids: ["C-G3-source"],
        source_locations: ["prd.md"], derived_from: ["C-G3-epic"], status: "draft", assumptions: [], open_questions: [],
        content: { title: "S1", acceptance_criteria: ["AC"], size: "low", story_points: 1, estimate_confidence: "high", estimate_basis: ["Small seam"] },
      },
      {
        id: "C-G3-deps", package: "dependencies", change_id: "C-G3", source_ids: ["C-G3-source"],
        source_locations: ["prd.md"], derived_from: ["C-G3-story-1"], status: "draft", assumptions: [], open_questions: [],
        content: { nodes: [{ story_id: "C-G3-story-1" }], edges: [] },
      },
      {
        id: "C-G3-allocations", package: "allocations", change_id: "C-G3", source_ids: ["C-G3-source"],
        source_locations: ["prd.md"], derived_from: ["C-G3-story-1", "C-G3-deps"], status: "draft", assumptions: [], open_questions: [],
        content: { clusters: [{ id: "cluster-1", story_ids: ["C-G3-story-1"], total_points: 1, depends_on_clusters: [], shared_seams: ["src"], required_skills: ["coding"], rationale: "Cohesive slice" }] },
      },
    ]],
    ["G2", [
      {
        id: "C-G3-data", package: "test-data", change_id: "C-G3", source_ids: ["C-G3-source"],
        source_locations: ["prd.md"], derived_from: [], status: "draft", assumptions: [], open_questions: [],
        content: { fixtures: [] },
      },
      {
        id: "C-G3-case", package: "test-cases", change_id: "C-G3", source_ids: ["C-G3-source"],
        source_locations: ["prd.md"], derived_from: [], status: "draft", assumptions: [], open_questions: [],
        content: { cases: ["happy"] },
      },
      {
        id: "C-G3-plan", package: "test-plans", change_id: "C-G3", source_ids: ["C-G3-source"],
        source_locations: ["prd.md"], derived_from: [], status: "draft", assumptions: [], open_questions: [],
        content: { levels: ["unit"] },
      },
    ]],
  ]) {
    for (const draft of drafts) registerDraft(root, draft);
    if (gate === "G0") registerPrdSpdd(root, "C-G3");
    specs.approve(root, { changeId: "C-G3", gate, approver: "Alex" });
  }

  registerDraft(root, {
    id: "C-G3-design", package: "design", change_id: "C-G3", source_ids: ["C-G3-source"],
    source_locations: ["prd.md"], derived_from: [], status: "draft", assumptions: [], open_questions: [],
    content: { seam: "api" },
  });
  registerDraft(root, {
    id: "C-G3-arch", package: "architecture", change_id: "C-G3", source_ids: ["C-G3-source"],
    source_locations: ["prd.md"], derived_from: ["C-G3-design"], status: "draft", assumptions: [], open_questions: [],
    content: { style: "layered" },
  });
  const incomplete = specs.proposalPack(root, { changeId: "C-G3", gate: "G3" });
  assert.equal(incomplete.ready, false);
  assert.match(incomplete.blocking.join("\n"), /structural_alternatives/);
  assert.match(incomplete.markdown, /clone-vertical/);
  assert.throws(
    () => specs.approve(root, { changeId: "C-G3", gate: "G3", approver: "Alex" }),
    /design-evolution/
  );

  registerDraft(root, {
    id: "C-G3-arch", package: "architecture", change_id: "C-G3", source_ids: ["C-G3-source"],
    source_locations: ["prd.md"], derived_from: ["C-G3-design"], status: "draft", assumptions: [], open_questions: [],
    content: {
      structural_alternatives: [
        { id: "clone-vertical", summary: "One stack per entity", duplication_risk: "high" },
        { id: "shared-modules", summary: "Shared helpers", duplication_risk: "low" },
        { id: "parameterized-spine", summary: "One flow + strategies", duplication_risk: "medium" },
      ],
      selected_alternative_id: "parameterized-spine",
      selection_rationale: "Entity pipelines share the same skeleton; strategies differ only at policy points.",
      second_slice_reuse_policy: {
        when: "second-similar-capability",
        required_action: "reuse-existing-seams-or-design-amendment",
        generalize_min_uses: 2,
      },
      evolutionary_rules: ["Second entity reuses the spine or opens a design amendment."],
    },
  });
  registerDraft(root, {
    id: "C-G3-design", package: "design", change_id: "C-G3", source_ids: ["C-G3-source"],
    source_locations: ["prd.md"], derived_from: [], status: "draft", assumptions: [], open_questions: [],
    content: {
      seam: "public API handler → application service",
      folder_structure: ["src/api/", "src/app/", "src/domain/"],
    },
  });
  const complete = specs.proposalPack(root, { changeId: "C-G3", gate: "G3", write: true });
  assert.equal(complete.ready, true);
  assert.match(complete.markdown, /G3 design session/);
  assert.match(complete.markdown, /Recommended shape:\*\* `parameterized-spine`/);
  assert.match(complete.markdown, /Entity pipelines share the same skeleton/);
  assert.match(complete.markdown, /Human checklist before approve/);
  assert.match(complete.markdown, /Primary seam:\*\* public API handler/);
  assert.match(complete.markdown, /Registered artifacts \(JSON appendix\)/);
  assert.match(complete.markdown, /Approve command/);
  assert.equal(complete.written_path, ".claude/specs/evidence/C-G3-gate-G3-proposal.md");
  assert.match(
    require("node:fs").readFileSync(require("node:path").join(root, complete.written_path), "utf8"),
    /structural alternatives/i
  );
  assert.equal(specs.approve(root, { changeId: "C-G3", gate: "G3", approver: "Alex" }).status, "approved");
});
