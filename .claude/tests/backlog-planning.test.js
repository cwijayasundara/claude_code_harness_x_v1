const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeDag, validateAllocations, validateG4DependencyConsistency, validateStoryEstimate } = require("../lib/backlog-planning");

test("story estimates enforce coarse size, points, confidence, basis, and ACs", () => {
  assert.deepEqual(validateStoryEstimate({ size: "medium", story_points: 5, estimate_confidence: "high", estimate_basis: ["two seams"], acceptance_criteria: ["AC"] }, "S1"), []);
  const errors = validateStoryEstimate({ size: "low", story_points: 8, estimate_confidence: "unknown", estimate_basis: [], acceptance_criteria: [] }, "S1");
  assert.match(errors.join("\n"), /does not match/);
  assert.match(errors.join("\n"), /estimate_confidence/);
  assert.match(errors.join("\n"), /acceptance_criteria/);
});

test("dependency DAG derives ready stories and weighted critical path", () => {
  const stories = [{ id: "S1" }, { id: "S2" }, { id: "S3" }];
  const result = analyzeDag(stories, {
    nodes: stories.map((story) => ({ story_id: story.id })),
    edges: [{ from: "S1", to: "S2" }, { from: "S2", to: "S3" }],
  }, new Map([["S1", 2], ["S2", 5], ["S3", 3]]));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.dependency_ready_story_ids, ["S1"]);
  assert.deepEqual(result.critical_path, ["S1", "S2", "S3"]);
  assert.equal(result.critical_path_points, 10);
});

test("dependency DAG rejects cycles, unknown nodes, and self edges", () => {
  const stories = [{ id: "S1" }, { id: "S2" }];
  const result = analyzeDag(stories, {
    nodes: [{ story_id: "S1" }, { story_id: "S2" }, { story_id: "UNKNOWN" }],
    edges: [{ from: "S1", to: "S2" }, { from: "S2", to: "S1" }, { from: "S1", to: "S1" }],
  }, new Map([["S1", 1], ["S2", 1]]));
  assert.match(result.errors.join("\n"), /unknown story/);
  assert.match(result.errors.join("\n"), /self-edge/);
  assert.match(result.errors.join("\n"), /cycle/);
});

test("allocation clusters cover stories once and carry cross-cluster dependencies", () => {
  const stories = [{ id: "S1" }, { id: "S2" }];
  const dag = analyzeDag(stories, { nodes: [{ story_id: "S1" }, { story_id: "S2" }], edges: [{ from: "S1", to: "S2" }] }, new Map([["S1", 2], ["S2", 3]]));
  const clusters = { clusters: [
    { id: "C1", story_ids: ["S1"], total_points: 2, depends_on_clusters: [], shared_seams: ["a"], required_skills: ["x"], rationale: "foundation" },
    { id: "C2", story_ids: ["S2"], total_points: 3, depends_on_clusters: ["C1"], shared_seams: ["b"], required_skills: ["y"], rationale: "dependent" },
  ] };
  assert.deepEqual(validateAllocations(clusters, stories, new Map([["S1", 2], ["S2", 3]]), dag), []);
  clusters.clusters[1].depends_on_clusters = [];
  assert.match(validateAllocations(clusters, stories, new Map([["S1", 2], ["S2", 3]]), dag).join("\n"), /must depend on/);
});

test("cross-epic dependency requires rationale", () => {
  const stories = [{ id: "S1", derived_from: ["E1"] }, { id: "S2", derived_from: ["E2"] }];
  const result = analyzeDag(stories, { nodes: [{ story_id: "S1" }, { story_id: "S2" }], edges: [{ from: "S1", to: "S2" }] }, new Map([["S1", 1], ["S2", 1]]));
  assert.match(result.errors.join("\n"), /Cross-epic dependency/);
});

test("G4 story contracts must match the approved G1 DAG", () => {
  const records = [
    { id: "D1", package: "dependencies", status: "approved", body: { content: { nodes: [{ story_id: "S1" }, { story_id: "S2" }], edges: [{ from: "S1", to: "S2" }] } } },
    { id: "P1", package: "plans", status: "draft", body: { content: { story_id: "S1", dependency_story_ids: [] } } },
    { id: "P2", package: "plans", status: "draft", body: { content: { story_id: "S2", dependency_story_ids: [] } } },
  ];
  const errors = validateG4DependencyConsistency(records, (record) => record.body);
  assert.match(errors.join("\n"), /P2.*S1/);
  records[2].body.content.dependency_story_ids = ["S1"];
  assert.deepEqual(validateG4DependencyConsistency(records, (record) => record.body), []);
});
