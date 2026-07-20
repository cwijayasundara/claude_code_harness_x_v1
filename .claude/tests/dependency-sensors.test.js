const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const { buildDependencyGraph, checkCouplingImpact, checkDependencyCycles } = require("../lib/dependency-sensors");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dependency-sensors-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, ".claude", "project"), { recursive: true });
  return root;
}

test("dependency graph detects a cycle intersecting changed code", () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "src", "a.js"), "const b = require('./b');\nmodule.exports = b;\n");
  fs.writeFileSync(path.join(root, "src", "b.js"), "import a from './a.js';\nexport default a;\n");
  const result = checkDependencyCycles(root, ["src/a.js"]);
  assert.equal(result.status, "warn");
  assert.equal(result.metrics.cycle_count, 1);
  assert.ok(result.affectedPaths.includes("src/b.js"));
});

test("coupling sensor reports fan-in for a changed shared module", () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, ".claude", "project", "dependency-sensors.json"), JSON.stringify({ version: 1, coupling: { warn_fan_in: 2, warn_fan_out: 10 } }));
  fs.writeFileSync(path.join(root, "src", "shared.js"), "export const shared = 1;\n");
  for (const name of ["a", "b", "c"]) fs.writeFileSync(path.join(root, "src", `${name}.js`), `import { shared } from './shared.js';\nexport const value = shared;\n`);
  const result = checkCouplingImpact(root, ["src/shared.js"]);
  assert.equal(result.status, "warn");
  assert.equal(result.metrics.risky_modules[0].fan_in, 3);
});

test("dependency graph captures static and dynamic local imports", () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "src", "entry.js"), "const one = require('./one');\nconst two = import('./two.js');\n");
  fs.writeFileSync(path.join(root, "src", "one.js"), "module.exports = 1;\n");
  fs.writeFileSync(path.join(root, "src", "two.js"), "export default 2;\n");
  const graph = buildDependencyGraph(root);
  assert.deepEqual([...graph.edges.get("src/entry.js")].sort(), ["src/one.js", "src/two.js"]);
});

test("dependency structure never reports calibrated pass without approved roots", () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "src", "clean.js"), "export const clean = true;\n");
  const result = checkDependencyCycles(root, ["src/clean.js"]);
  assert.equal(result.status, "warn");
  assert.equal(result.metrics.roots_configured, 0);
});

test("dependency structure reports changed files outside approved roots", () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, ".claude", "project", "dependency-sensors.json"), JSON.stringify({ version: 1, approved_roots: ["src/domain"] }));
  fs.mkdirSync(path.join(root, "src", "misc"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "misc", "generated.js"), "export const generated = true;\n");
  const result = checkDependencyCycles(root, ["src/misc/generated.js"]);
  assert.equal(result.status, "warn");
  assert.equal(result.metrics.outside_approved_roots, 1);
});

test("dependency suppressions require governance and expire", () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "src", "a.js"), "import './b.js';\n");
  fs.writeFileSync(path.join(root, "src", "b.js"), "import './a.js';\n");
  fs.writeFileSync(path.join(root, ".claude", "project", "dependency-sensors.json"), JSON.stringify({ version: 1, approved_roots: ["src"], suppressions: [{ sensor_id: "dependency-cycles", affected_paths: ["src/a.js", "src/b.js"], owner: "Architecture", reason: "Migration cycle", expires_on: "2099-01-01" }] }));
  const result = checkDependencyCycles(root, ["src/a.js"]);
  assert.equal(result.status, "pass");
  assert.equal(result.metrics.suppressed_count, 1);
});

test("coupling metrics identify dependency edges added since HEAD", () => {
  const root = fixture();
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Harness Test"]);
  fs.writeFileSync(path.join(root, "src", "shared.js"), "export const shared = 1;\n");
  fs.writeFileSync(path.join(root, "src", "entry.js"), "export const entry = 1;\n");
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-qm", "baseline"]);
  fs.writeFileSync(path.join(root, "src", "entry.js"), "import { shared } from './shared.js';\nexport const entry = shared;\n");
  const result = checkCouplingImpact(root, ["src/entry.js"]);
  assert.equal(result.metrics.new_edge_count, 1);
  assert.deepEqual(result.metrics.new_edges[0], { from: "src/entry.js", to: "src/shared.js" });
});
