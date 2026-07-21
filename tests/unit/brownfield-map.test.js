const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  buildCodeMap,
  validateAdapterExport,
} = require("../../.claude/lib/brownfield-map");

test("builds a bounded provenance-labelled code map from an explicit scope", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brownfield-map-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "service.py"), "from src.repository import Repo\n\nclass Service:\n    pass\n");
  fs.writeFileSync(path.join(root, "src", "repository.py"), "class Repo:\n    pass\n");
  fs.writeFileSync(path.join(root, "tests", "test_service.py"), "from src.service import Service\n");
  const map = buildCodeMap(root, ["src", "tests"], undefined, ["Service"]);
  assert.equal(map.inventory.source_files, 3);
  assert.ok(map.graph.nodes.some((node) => node.kind === "class" && node.name === "Service"));
  assert.ok(map.graph.edges.some((edge) => edge.type === "imports" && edge.provenance.method === "static-source-extraction"));
  assert.deepEqual(map.maps.tests, ["tests/test_service.py"]);
  assert.ok(map.maps.impact.some((item) => item.path === "src/service.py"));
});

test("refuses an implicit repository-wide scan", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brownfield-map-"));
  assert.throws(() => buildCodeMap(root, [], undefined, ["app"]), /explicit --path scope/);
});

test("maps scopes containing more than 500 source files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brownfield-map-"));
  fs.mkdirSync(path.join(root, "src"));
  for (let index = 0; index < 501; index += 1) {
    fs.writeFileSync(path.join(root, "src", `module-${index}.js`), "module.exports = {};\n");
  }
  const map = buildCodeMap(root, ["src"], undefined, ["module-500"]);
  assert.equal(map.inventory.source_files, 501);
  assert.ok(map.maps.impact.some((item) => item.path === "src/module-500.js"));
});

test("rejects graph adapter edges without provenance", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brownfield-map-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "app.py"), "pass\n");
  fs.writeFileSync(path.join(root, "graph.json"), JSON.stringify({ provider: "graphify", nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }] }));
  assert.throws(() => buildCodeMap(root, ["src"], "graph.json", ["app"]), /requires provenance/);
});

test("imports a valid Graphify-shaped adapter and records provider", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brownfield-map-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "app.js"), "function run() {}\nmodule.exports = { run };\n");
  fs.writeFileSync(path.join(root, "adapter.json"), JSON.stringify({
    provider: "graphify",
    nodes: [
      { id: "file:src/app.js", kind: "file", path: "src/app.js" },
      { id: "symbol:run", kind: "function", name: "run", path: "src/app.js" },
    ],
    edges: [{
      from: "file:src/app.js",
      to: "symbol:run",
      type: "declares",
      provenance: { method: "graphify-ast", confidence: "extracted" },
    }],
  }));
  const map = buildCodeMap(root, ["src"], "adapter.json", ["run"]);
  assert.equal(map.adapter.provider, "graphify");
  assert.ok(map.adapter.sha256);
  assert.ok(map.graph.edges.some((edge) => edge.provenance?.method === "graphify-ast"));
});

test("validateAdapterExport rejects invalid confidence and missing endpoints", () => {
  const errors = validateAdapterExport({
    provider: "cce",
    nodes: [{ id: "a" }],
    edges: [{ from: "a", to: "missing", provenance: { method: "x", confidence: "maybe" } }],
  });
  assert.match(errors.join("\n"), /missing endpoint|confidence/);
});
