const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const specs = require("../lib/specifications");

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
  });
  const approval = specs.approve(root, { changeId: "C-2", gate: "G0", approver: "Alex" });
  assert.equal(approval.status, "approved");
  assert.equal(approval.approver, "Alex");
  assert.throws(() => specs.approve(root, { changeId: "C-2", gate: "G1", approver: "Alex" }), /requires registered artifacts in: epics, stories, dependencies/);
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
    content: { summary: "Normalized BRD interpretation", outcomes: ["CRUD todos"] },
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
        content: { title: "S1" },
      },
      {
        id: "C-G3-deps", package: "dependencies", change_id: "C-G3", source_ids: ["C-G3-source"],
        source_locations: ["prd.md"], derived_from: ["C-G3-story-1"], status: "draft", assumptions: [], open_questions: [],
        content: { sequence: ["C-G3-story-1"] },
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
