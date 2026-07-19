const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assertStrategyPrefersReuse,
  proposeChangeStrategy,
} = require("../lib/brownfield-strategy");

test("proposeChangeStrategy prefers nominated reuse and lists impact", () => {
  const strategy = proposeChangeStrategy({
    goal: "Wire createTodo to normalizeTitle",
    focus: ["createTodo"],
    preferredReuse: [{ path: "src/normalize.js", symbol: "normalizeTitle", reason: "existing helper" }],
    codeMap: {
      maps: {
        impact: [{ id: "file:src/todo.js", path: "src/todo.js", kind: "file", reason: "focus-match" }],
        duplicate_candidates: [{ symbol: "createTodo", paths: ["src/todo.js", "src/legacy.js"], status: "candidate-needs-behavioral-verification" }],
        canonical_reuse_candidates: [{ role: "application", path: "src/normalize.js", status: "candidate" }],
        tests: ["tests/todo.test.js", "tests/normalize.test.js"],
        hotspots: [{ path: "src/todo.js", graph_degree: 3 }],
      },
      adapter: { provider: "graphify" },
      cautions: ["Open source first."],
    },
  });
  assert.equal(strategy.artifact_type, "change-strategy");
  assert.equal(strategy.second_slice_decision, "reuse-existing");
  assert.ok(strategy.reuse.some((item) => item.symbol === "normalizeTitle"));
  assert.ok(strategy.duplication_risks.some((item) => item.symbol === "createTodo"));
  assert.deepEqual(assertStrategyPrefersReuse(strategy, ["src/normalize.js"]), []);
});

test("assertStrategyPrefersReuse rejects strategies without reuse", () => {
  const errors = assertStrategyPrefersReuse({
    artifact_type: "change-strategy",
    reuse: [],
  }, ["src/normalize.js"]);
  assert.match(errors.join("\n"), /at least one reuse/);
  assert.match(errors.join("\n"), /must reuse/);
});
