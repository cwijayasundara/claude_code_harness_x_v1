const assert = require("node:assert/strict");
const test = require("node:test");
const { renderGateSession } = require("../../.claude/lib/proposal-sessions");

function body(packageName, content, id = `${packageName}-1`) {
  return {
    record: { id, package: packageName, path: `.claude/specs/${packageName}/${id}.json`, status: "draft" },
    body: { content },
  };
}

test("G0 session narrates interpretation and checklist", () => {
  const md = renderGateSession("G0", {
    ready: true,
    bodies: [
      {
        record: {
          id: "C-source", package: "source", path: "requirements/prd.md", kind: "prd", sha256: "abc123def456",
        },
        body: { kind: "source-file", text: "# PRD", truncated: false },
      },
      body("prd", {
        summary: "Ship todo create",
        outcomes: ["createTodo returns id"],
        in_scope: ["helper"],
        out_of_scope: ["HTTP"],
      }, "C-prd"),
    ],
  });
  assert.match(md, /G0 interpretation session/);
  assert.match(md, /Ship todo create/);
  assert.match(md, /createTodo returns id/);
  assert.match(md, /Human checklist before approve/);
});

test("G0 session renders SPDD analysis and every REASONS section", () => {
  const md = renderGateSession("G0", {
    ready: true,
    bodies: [
      body("analysis", {
        domain_concepts: ["Todo"], strategic_direction: ["Reuse"],
        risks: ["Drift"], requirement_gaps: ["None"],
      }, "A1"),
      body("reasons-canvas", {
        requirements: ["R"], entities: ["E"], approach: ["A"], structure: ["S"],
        operations: ["O"], norms: ["N"], safeguards: ["Safe"],
        sync: { status: "aligned", amendment_ids: [] },
      }, "RC1"),
    ],
  });
  assert.match(md, /SPDD analysis/);
  assert.match(md, /REASONS Canvas/);
  for (const section of ["requirements", "entities", "approach", "structure", "operations", "norms", "safeguards", "sync"]) {
    assert.match(md, new RegExp(section));
  }
});

test("G1 session lists stories and dependency order", () => {
  const md = renderGateSession("G1", {
    ready: true,
    bodies: [
      body("epics", { title: "Todos" }, "E1"),
      body("stories", {
        title: "Create todo",
        size: "low", story_points: 2, estimate_confidence: "high", estimate_basis: ["small seam"],
        acceptance_criteria: ["returns id", "rejects empty"],
      }, "S1"),
      body("dependencies", {
        nodes: [{ story_id: "S1" }, { story_id: "S2" }],
        edges: [{ from: "S1", to: "S2" }],
      }, "D1"),
      body("allocations", { clusters: [{ id: "cluster", story_ids: ["S1", "S2"], total_points: 5, depends_on_clusters: [] }] }, "A1"),
    ],
    analysis: { topological_order: ["S1", "S2"], dependency_ready_story_ids: ["S1"], critical_path: ["S1", "S2"], critical_path_points: 5 },
  });
  assert.match(md, /G1 stories/);
  assert.match(md, /Create todo/);
  assert.match(md, /Critical path/);
  assert.match(md, /Allocation clusters/);
});

test("G2 session summarizes plans and cases", () => {
  const md = renderGateSession("G2", {
    ready: false,
    bodies: [
      body("test-plans", { levels: ["unit", "integration"], hermetic: true }, "P1"),
      body("test-cases", { cases: [{ id: "happy", expect: "ok" }, "empty"] }, "C1"),
      body("test-data", { fixtures: ["a"] }, "D1"),
    ],
  });
  assert.match(md, /G2 test strategy/);
  assert.match(md, /unit, integration/);
  assert.match(md, /2 case/);
});

test("G4 session surfaces posture and reuse", () => {
  const md = renderGateSession("G4", {
    ready: true,
    bodies: [
      body("plans", {
        story_id: "S2",
        implementation_posture: "reuse-existing",
        dependency_story_ids: ["S1"],
        allowed_change_scope: ["src"],
        acceptance_criteria: ["batch reuses createTodo"],
        test_case_ids: ["TC-2"],
        required_sensors: ["unit", "file-size"],
        approved_design_refs: ["DES-1"],
        reuse_targets: [{ path: "src/todo.js", symbol: "createTodo" }],
      }, "contract-2"),
    ],
  });
  assert.match(md, /G4 story contracts/);
  assert.match(md, /reuse-existing/);
  assert.match(md, /createTodo/);
  assert.match(md, /file-size/);
});
