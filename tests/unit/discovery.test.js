const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { discover, renderDiscovery } = require("../../.claude/lib/discovery");

test("discovers source signals and candidate seams only in the requested scope", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-discovery-"));
  fs.mkdirSync(path.join(root, "app", "services"), { recursive: true });
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  fs.writeFileSync(path.join(root, "pyproject.toml"), "[project]\nname='demo'\n");
  fs.writeFileSync(path.join(root, "app", "services", "capital_call_service.py"), "pass\n");
  fs.writeFileSync(path.join(root, "tests", "test_capital_call.py"), "def test_example(): pass\n");

  const result = discover(root, ["app"]);
  assert.deepEqual(result.sourceFiles, ["app/services/capital_call_service.py"]);
  assert.deepEqual(result.roles.application, ["app/services/capital_call_service.py"]);
  assert.ok(result.signals.includes("Python source"));
  assert.ok(result.signals.includes("pyproject.toml"));
});

test("renders a concise, actionable discovery report", () => {
  const report = renderDiscovery({
    id: "PE-001-discovery",
    config: { technologyProfiles: ["python-fastapi"], domainPack: "private-equity" },
    scopedPaths: ["app/services"],
    result: {
      files: ["app/services/capital_call_service.py"],
      skipped: [],
      sourceFiles: ["app/services/capital_call_service.py"],
      signals: ["Python source"],
      roles: { application: ["app/services/capital_call_service.py"] },
    },
  });

  assert.match(report, /Brownfield discovery: PE-001-discovery/);
  assert.match(report, /canonical existing pattern/);
});

test("does not duplicate files from overlapping scopes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-discovery-"));
  fs.mkdirSync(path.join(root, "src", "feature"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "feature", "one.js"), "module.exports = {};\n");
  fs.writeFileSync(path.join(root, "src", "feature", "two.js"), "module.exports = {};\n");

  const result = discover(root, ["src", "src/feature"]);
  assert.deepEqual(result.sourceFiles, ["src/feature/one.js", "src/feature/two.js"]);
});

test("ignores generated and vendored trees during fallback discovery", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-discovery-"));
  for (const directory of ["src", "vendor", "generated"]) fs.mkdirSync(path.join(root, directory));
  fs.writeFileSync(path.join(root, "src", "app.ts"), "export const app = true;\n");
  fs.writeFileSync(path.join(root, "vendor", "sdk.ts"), "export const sdk = true;\n");
  fs.writeFileSync(path.join(root, "generated", "schema.ts"), "export const schema = true;\n");

  assert.deepEqual(discover(root, ["."]).sourceFiles, ["src/app.ts"]);
});
